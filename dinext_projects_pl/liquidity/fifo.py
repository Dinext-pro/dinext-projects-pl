"""Fixed gross-obligation coverage. No configuration, database or period filtering."""

from collections import defaultdict, deque
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from .model import ZERO, Link, allocate, as_date, native_outstanding, native_total


@dataclass
class Coverage:
	request: Link
	invoice: Link
	request_share: str
	invoice_share: str
	original: Decimal
	request_original: Decimal
	basis: str
	remaining: Decimal = ZERO
	company_remaining: Decimal = ZERO
	company_gross: Decimal = ZERO


def warn(snapshot, text):
	snapshot.complete = False
	if text not in snapshot.warnings:
		snapshot.warnings.append(text)


def _date(value):
	return as_date(str(value)[:10]) if value else date.max


def _queue_key(snapshot, source, field):
	doc = snapshot.documents.get(source, {})
	return (_date(doc.get(field)), str(doc.get("creation") or ""), source.name)


def _key(document, share):
	a = share.analytic
	return (document.direction, a.party_type, a.party, a.project, a.contract, document.currency)


def coverage(snapshot, requests, invoices):
	"""Allocate explicit full capacities first, then compatible original-currency FIFO."""
	invoice_by_link = {i.source: i for i in invoices}
	request_by_link = {r.source: r for r in requests}
	icaps, rcaps, invoice_parts, request_parts = {}, {}, {}, {}
	for docs, caps, parts in ((invoices, icaps, invoice_parts), (requests, rcaps, request_parts)):
		for doc in docs:
			shares = sorted(doc.shares, key=lambda s: s.key)
			amounts = allocate(native_total(snapshot, doc), [s.weight for s in shares], snapshot.precision)
			for share, amount in zip(shares, amounts, strict=True):
				key = (doc.source, share.key)
				caps[key] = max(ZERO, amount)
				parts[key] = (doc, share)
	result = []

	def take(rkey, ikey, limit, basis):
		req, _rshare = request_parts[rkey]
		inv, _ishare = invoice_parts[ikey]
		ratio = 1 if req.currency == inv.currency else inv.rate / req.rate
		amount = min(icaps[ikey], rcaps[rkey] / ratio, limit)
		if amount <= 0:
			return ZERO
		requested = amount * ratio
		icaps[ikey] -= amount
		rcaps[rkey] -= requested
		result.append(Coverage(req.source, inv.source, rkey[1], ikey[1], amount, requested, basis))
		return amount

	# Overlapping explicit instructions retain invoice debt rather than arbitrarily
	# selecting a request. FIFO has deterministic allocation and is not ambiguous.
	explicit_totals = defaultdict(lambda: ZERO)
	for req in requests:
		for link, amount in req.gross_coverage.items():
			inv = invoice_by_link.get(link)
			if inv:
				explicit_totals[link] += (
					amount / req.rate if req.currency == inv.currency else amount / inv.rate
				)
	ambiguous = {
		link
		for link, amount in explicit_totals.items()
		if amount > invoice_by_link[link].total / invoice_by_link[link].rate
	}
	if ambiguous:
		warn(snapshot, "Overlapping payment requests: invoice schedule retained")
	for req in sorted(requests, key=lambda r: r.source):
		for link, amount in sorted(req.gross_coverage.items()):
			inv = invoice_by_link.get(link)
			if not inv or link in ambiguous:
				continue
			limit = amount / req.rate if req.currency == inv.currency else amount / inv.rate
			for rshare in sorted(req.shares, key=lambda s: s.key):
				for ishare in sorted(inv.shares, key=lambda s: s.key):
					# Explicit source links authorize allocation across currencies; keep
					# matching analytical slices when the request inherited invoice shares.
					if len(req.shares) > 1 and (
						rshare.analytic.project,
						rshare.analytic.contract,
						rshare.analytic.order,
					) != (ishare.analytic.project, ishare.analytic.contract, ishare.analytic.order):
						continue
					limit -= take((req.source, rshare.key), (inv.source, ishare.key), limit, "explicit")

	# Per-analytic queues, also indexed by explicit order. An orderless request
	# uses the global queue; an ordered request considers only its order and None.
	buckets = defaultdict(list)
	for key, (inv, share) in invoice_parts.items():
		if inv.source not in ambiguous:
			buckets[_key(inv, share)].append(key)
	queues = {}
	order_queues = {}
	for group, keys in buckets.items():
		keys.sort(key=lambda k: (*_queue_key(snapshot, k[0], "posting_date"), k[1]))
		queues[group] = deque(keys)
		by_order = defaultdict(deque)
		for key in keys:
			by_order[invoice_parts[key][1].analytic.order].append(key)
		order_queues[group] = by_order
	ambiguous_requests = {r.source for r in requests if set(r.gross_coverage) & ambiguous}
	for req in sorted(requests, key=lambda r: _queue_key(snapshot, r.source, "transaction_date")):
		if req.invoice_only or req.source in ambiguous_requests:
			continue
		for share in sorted(req.shares, key=lambda s: s.key):
			rkey = (req.source, share.key)
			group = _key(req, share)
			if group not in queues:
				continue
			order = share.analytic.order
			candidates = (
				[queues[group]] if not order else [order_queues[group][None], order_queues[group][order]]
			)
			while rcaps[rkey] > 0:
				for queue in candidates:
					while queue and icaps[queue[0]] <= 0:
						queue.popleft()
				heads = [q[0] for q in candidates if q]
				if not heads:
					break
				ikey = min(heads, key=lambda k: (*_queue_key(snapshot, k[0], "posting_date"), k[1]))
				take(rkey, ikey, icaps[ikey], "FIFO")

	# Settlement allocation follows gross coverage. Explicit payments attributed
	# to a request win; other payments consume free invoice capacity first.
	by_invoice_share = defaultdict(list)
	for part in result:
		by_invoice_share[(part.invoice, part.invoice_share)].append(part)
	for ikey, (inv, share) in invoice_parts.items():
		parts = by_invoice_share[ikey]
		shares = sorted(inv.shares, key=lambda s: s.key)
		paid = allocate(
			max(ZERO, native_total(snapshot, inv) - native_outstanding(snapshot, inv)),
			[s.weight for s in shares],
			snapshot.precision,
		)[next(i for i, s in enumerate(shares) if s.key == share.key)]
		for part in parts:
			part.remaining = part.original
		explicit_paid = {}
		for part in parts:
			req = request_by_link[part.request]
			key = (part.request, part.invoice)
			if key not in explicit_paid:
				# Divide across invoice analytics, never count a parent payment on each share.
				explicit_paid[key] = (
					req.paid_by_invoice.get(inv.source, ZERO)
					/ (req.rate if req.currency == inv.currency else inv.rate)
					* share.weight
					/ sum(s.weight for s in shares)
				)
			use = min(part.remaining, paid, explicit_paid[key])
			part.remaining -= use
			paid -= use
			explicit_paid[key] -= use
		free_remaining = max(ZERO, icaps[ikey] - paid)
		paid = max(ZERO, paid - icaps[ikey])
		for part in parts:
			use = min(part.remaining, paid)
			part.remaining -= use
			paid -= use
		share_idx = next(i for i, item in enumerate(shares) if item.key == share.key)
		company_remaining = allocate(inv.outstanding, [item.weight for item in shares], snapshot.precision)[
			share_idx
		]
		company_gross = allocate(inv.total, [item.weight for item in shares], snapshot.precision)[share_idx]
		remaining_weights = [part.remaining for part in parts] + [free_remaining]
		if not sum(remaining_weights, ZERO) and company_remaining:
			remaining_weights[-1] = 1
		pending_parts = allocate(company_remaining, remaining_weights, snapshot.precision)
		gross_parts = allocate(
			company_gross, [part.original for part in parts] + [icaps[ikey]], snapshot.precision
		)
		for part, pending, full in zip(parts, pending_parts[:-1], gross_parts[:-1], strict=True):
			part.company_remaining = pending
			part.company_gross = full
	return result
