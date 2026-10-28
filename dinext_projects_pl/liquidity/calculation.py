"""Combine obligations and payment requests into disjoint cash flow components."""

from collections import defaultdict
from dataclasses import replace

from .model import ZERO, Flow, Link, Obligation, Request, Snapshot, allocate, remaining_stages


def _flows(snapshot, obligation, amount, due, original_due, key, metric, request=None, include_zero=False):
	shares = sorted(obligation.shares, key=lambda s: s.key)
	amounts = allocate(amount, [s.weight for s in shares], snapshot.precision)
	paid_parts = allocate(
		max(ZERO, obligation.total - obligation.outstanding), [s.weight for s in shares], snapshot.precision
	)
	remaining_parts = allocate(obligation.outstanding, [s.weight for s in shares], snapshot.precision)
	links = tuple(dict.fromkeys((obligation.source,) + (request.links if request else ())))
	if request:
		links = tuple(dict.fromkeys((*links, request.source)))
		payment = next((v for v in request.links if v.doctype == "Payment Order"), request.source)
	else:
		payment = None
	for share, part, paid, remaining in zip(shares, amounts, paid_parts, remaining_parts, strict=True):
		if not part and not include_zero:
			continue
		yield Flow(
			id=f"{metric}:{obligation.source.doctype}:{obligation.source.name}:{key}:{share.key}",
			metric=metric,
			direction=obligation.direction,
			amount=part,
			date=max(snapshot.today, due) if due else None,
			original_date=original_due,
			source=obligation.source,
			analytic=share.analytic,
			currency=obligation.currency,
			original_amount=part / obligation.rate,
			paid=paid,
			outstanding=remaining,
			payment=payment,
			links=links,
			status=request.status if request else "",
			overdue=bool(due and due < snapshot.today),
			contract_overdue=bool(
				original_due and original_due < snapshot.today and due and due >= snapshot.today
			),
			date_source=request.source if request and request.date else obligation.source,
		)


def calculate(snapshot: Snapshot, include_zero=False) -> list[Flow]:
	flows = [f for f in snapshot.actual if f.date and f.date <= snapshot.today]
	for order in snapshot.orders:
		if include_zero and order.outstanding <= 0:
			due = order.stages[0].due if order.stages else None
			flows.extend(_flows(snapshot, order, ZERO, due, due, "zero", "plan", include_zero=True))
		for stage in remaining_stages(
			order.stages, order.total, order.outstanding, order.paid_by_term, snapshot.precision
		):
			flows.extend(_flows(snapshot, order, stage.amount, stage.due, stage.due, stage.key, "plan"))

	requests_by_invoice = defaultdict(list)
	for request in snapshot.requests:
		for invoice, covered in request.coverage.items():
			if covered > 0:
				requests_by_invoice[invoice].append((request, covered))
	consumed = defaultdict(lambda: ZERO)
	for invoice in snapshot.invoices:
		if include_zero and invoice.outstanding <= 0:
			due = invoice.stages[0].due if invoice.stages else None
			flows.extend(_flows(snapshot, invoice, ZERO, due, due, "zero", "forecast", include_zero=True))
		stages = remaining_stages(
			invoice.stages, invoice.total, invoice.outstanding, invoice.paid_by_term, snapshot.precision
		)
		remaining = [s.amount for s in stages]
		candidates = sorted(requests_by_invoice[invoice.source], key=lambda v: v[0].source)
		# Multiple overlapping instructions do not authorize picking an arbitrary latest request.
		ambiguous = len(candidates) > 1 and sum((a for _, a in candidates), ZERO) > sum(remaining, ZERO)
		if ambiguous:
			snapshot.warnings.append("Overlapping payment requests: invoice schedule retained")
			snapshot.complete = False
		for request, covered in candidates:
			if ambiguous:
				# A request exclusively referencing this invoice is informational, never extra debt.
				if not request.invoice_only:
					snapshot.warnings.append("Unreconciled request coverage")
				continue
			budget = min(
				covered, max(ZERO, request.outstanding - consumed[request.source]), sum(remaining, ZERO)
			)
			indices = list(range(len(stages)))
			if request.term:
				indices.sort(key=lambda i: stages[i].term != request.term)
			for i in indices:
				part = min(budget, remaining[i])
				if not part:
					continue
				flows.extend(
					_flows(
						snapshot,
						invoice,
						part,
						request.date or stages[i].due,
						stages[i].due,
						f"{stages[i].key}:request:{request.source.name}",
						"forecast",
						request,
					)
				)
				remaining[i] -= part
				budget -= part
				consumed[request.source] += part
		for stage, amount in zip(stages, remaining, strict=True):
			if amount:
				flows.extend(_flows(snapshot, invoice, amount, stage.due, stage.due, stage.key, "forecast"))
	for request in snapshot.requests:
		if request.invoice_only:
			if (
				request.outstanding > consumed[request.source]
				and len(requests_by_invoice)
				and not request.coverage
			):
				snapshot.warnings.append("Payment request has no accessible invoice coverage")
			continue
		amount = max(ZERO, request.outstanding - consumed[request.source])
		if amount:
			obligation = Obligation(
				request.source,
				request.direction,
				request.total,
				request.outstanding,
				request.currency,
				request.rate,
				[],
				request.shares,
			)
			flows.extend(
				_flows(
					snapshot,
					obligation,
					amount,
					request.date,
					request.date,
					"standalone",
					"forecast",
					request,
				)
			)
	ids = [f.id for f in flows]
	if len(ids) != len(set(ids)):
		raise ValueError("Duplicate liquidity component")
	return flows
