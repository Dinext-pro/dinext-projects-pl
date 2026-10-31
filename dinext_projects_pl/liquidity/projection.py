"""Settings-driven expected flows over normalized, authorized financial documents."""

from collections import defaultdict
from dataclasses import replace
from datetime import datetime
from zoneinfo import ZoneInfo

from .fifo import coverage, warn
from .model import (
	ZERO,
	Flow,
	Link,
	Obligation,
	allocate,
	allocate_matrix,
	as_date,
	money,
	native_outstanding,
	remaining_stages,
)


def raw_date(doc, field, timezone="UTC"):
	value = doc.get(field)
	if not value:
		return None
	if len(str(value)) > 10:
		parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
		if parsed.tzinfo:
			return parsed.astimezone(ZoneInfo(timezone)).date()
	return as_date(str(value)[:10])


def expected_date(policy, doc, previous=None, scheduled=None, timezone="UTC"):
	value = (
		scheduled if policy.date_field == "payment_schedule" else raw_date(doc, policy.date_field, timezone)
	)
	if value:
		return value, True
	if policy.fallback == "previous":
		return previous, False
	if policy.fallback == "undated":
		return None, True
	return raw_date(doc, policy.fallback, timezone), True


def selected(snapshot, metric, source):
	policy = snapshot.policy.source(metric, source.doctype)
	return policy if policy and policy.accepts(snapshot.documents.get(source, {"docstatus": 1})) else None


def stages_for(snapshot, obligation, policy):
	stages = remaining_stages(
		obligation.stages,
		obligation.total,
		obligation.outstanding,
		obligation.paid_by_term,
		snapshot.precision,
	)
	if not stages and obligation.outstanding > 0:
		return []
	doc = snapshot.documents.get(obligation.source, {})
	return [
		(
			stage,
			expected_date(
				policy,
				doc,
				scheduled=stage.due if stage.key != "document" else None,
				timezone=snapshot.timezone,
			)[0],
		)
		for stage in stages
	]


def make_flow(
	snapshot,
	metric,
	obligation,
	share,
	amount,
	due,
	original,
	key,
	request=None,
	basis="",
	covered=ZERO,
	uncovered=ZERO,
	date_source=None,
	amount_source=None,
):
	amount = money(amount, snapshot.precision)
	links = (obligation.source,)
	if request:
		links = tuple(dict.fromkeys((*links, request.source, *request.links)))
	weight = share.weight / sum(s.weight for s in obligation.shares)
	return Flow(
		id=f"{metric}:{obligation.source.doctype}:{obligation.source.name}:{key}:{share.key}",
		metric=metric,
		direction=obligation.direction,
		amount=amount,
		date=max(snapshot.today, due) if due else None,
		original_date=original,
		source=obligation.source,
		analytic=share.analytic,
		currency=obligation.currency,
		original_amount=amount / obligation.rate,
		paid=money(max(ZERO, obligation.total - obligation.outstanding) * weight, snapshot.precision),
		outstanding=money(obligation.outstanding * weight, snapshot.precision),
		payment=request.source if request else None,
		links=links,
		status=request.status if request else "",
		overdue=bool(due and due < snapshot.today),
		contract_overdue=bool(original and original < snapshot.today and due and due >= snapshot.today),
		date_source=date_source or obligation.source,
		amount_source=amount_source or obligation.source,
		match_basis=basis,
		covered=money(covered, snapshot.precision),
		uncovered=money(uncovered, snapshot.precision),
	)


def invoice_flows(snapshot, metric, invoices, requests, parts):
	result = []
	by_invoice_share = defaultdict(list)
	requests_by_link = {r.source: r for r in requests}
	for part in parts:
		by_invoice_share[(part.invoice, part.invoice_share)].append(part)
	for invoice in invoices:
		base = selected(snapshot, metric, invoice.source)
		shares = sorted(invoice.shares, key=lambda s: s.key)
		# Physical contractual stages remain available even when invoice is only
		# accounting evidence for a participating request.
		stages = remaining_stages(
			invoice.stages, invoice.total, invoice.outstanding, invoice.paid_by_term, snapshot.precision
		)
		stage_amounts = allocate_matrix(
			[stage.amount for stage in stages], [s.weight for s in shares], snapshot.precision
		)
		for share_idx, share in enumerate(shares):
			amounts = [row[share_idx] for row in stage_amounts]
			for part in by_invoice_share[(invoice.source, share.key)]:
				request = requests_by_link[part.request]
				refiner = selected(snapshot, metric, request.source)
				if not refiner and not base:
					continue
				budget = part.company_remaining
				apply = refiner and (
					not base
					or snapshot.policy.refines(metric, invoice.source.doctype, request.source.doctype)
				)
				indices = list(range(len(stages)))
				if request.term:
					indices.sort(key=lambda i: stages[i].term != request.term)
				part_flows = []
				for i in indices:
					amount = min(budget, amounts[i])
					if amount <= 0:
						continue
					stage = stages[i]
					due = (
						expected_date(
							base,
							snapshot.documents.get(invoice.source, {}),
							scheduled=stage.due if stage.key != "document" else None,
							timezone=snapshot.timezone,
						)[0]
						if base
						else stage.due
					)
					source = invoice.source
					if apply:
						due, own_date = expected_date(
							refiner,
							snapshot.documents.get(request.source, {}),
							due,
							timezone=snapshot.timezone,
						)
						if own_date:
							source = request.source
					flow = make_flow(
						snapshot,
						metric,
						invoice,
						share,
						amount,
						due,
						stage.due,
						f"{stage.key}:request:{request.source.name}:{part.request_share}",
						request,
						part.basis,
						part.original * invoice.rate * amount / (part.remaining * invoice.rate)
						if part.remaining
						else ZERO,
						date_source=source,
						amount_source=request.source if apply else invoice.source,
					)
					part_flows.append(flow)
					amounts[i] -= amount
					budget -= amount
				if part_flows:
					originals = allocate(part.remaining, [f.amount for f in part_flows], snapshot.precision)
					result.extend(
						f if f.original_amount == original else f.with_changes(original_amount=original)
						for f, original in zip(part_flows, originals, strict=True)
					)
			if base:
				original_shares = allocate(
					native_outstanding(snapshot, invoice), [s.weight for s in shares], snapshot.precision
				)
				free_original = max(
					ZERO,
					original_shares[share_idx]
					- sum((part.remaining for part in by_invoice_share[(invoice.source, share.key)]), ZERO),
				)
				originals = (
					allocate(free_original, amounts, snapshot.precision)
					if sum(amounts, ZERO)
					else [ZERO] * len(amounts)
				)
				for i, stage in enumerate(stages):
					if amounts[i] > 0:
						due = expected_date(
							base,
							snapshot.documents.get(invoice.source, {}),
							scheduled=stage.due if stage.key != "document" else None,
							timezone=snapshot.timezone,
						)[0]
						result.append(
							make_flow(
								snapshot, metric, invoice, share, amounts[i], due, stage.due, stage.key
							).with_changes(
								original_amount=originals[i],
							)
						)

	return result


def request_flows(snapshot, metric, requests, parts):
	by_request_share = defaultdict(list)
	for part in parts:
		by_request_share[(part.request, part.request_share)].append(part)
	result = []
	for req in requests:
		policy = selected(snapshot, metric, req.source)
		if not policy or req.invoice_only:
			continue
		shares = sorted(req.shares, key=lambda s: s.key)
		gross = allocate(req.total, [s.weight for s in shares], snapshot.precision)
		paid = allocate(
			max(ZERO, req.total - req.outstanding), [s.weight for s in shares], snapshot.precision
		)
		for share, total, settled in zip(shares, gross, paid, strict=True):
			allocations = by_request_share[(req.source, share.key)]
			covered = sum((p.request_original * req.rate for p in allocations), ZERO)
			# Only settlement explicitly present on both sides is overlapping. A
			# separate request advance still consumes its own uncovered amount.
			shared = defaultdict(lambda: ZERO)
			for p in allocations:
				consumed = (
					(p.original - p.remaining) * p.request_original / p.original * req.rate
					if p.original
					else ZERO
				)
				shared[p.invoice] += consumed
			overlap = sum(
				(min(value, req.paid_by_invoice.get(inv, ZERO)) for inv, value in shared.items()), ZERO
			)
			uncovered = max(ZERO, total - covered - max(ZERO, settled - overlap))
			if uncovered <= 0:
				continue
			obligation = Obligation(
				req.source, req.direction, req.total, req.outstanding, req.currency, req.rate, [], req.shares
			)
			due = expected_date(policy, snapshot.documents.get(req.source, {}), timezone=snapshot.timezone)[0]
			result.append(
				make_flow(
					snapshot,
					metric,
					obligation,
					share,
					uncovered,
					due,
					req.date,
					"standalone",
					req,
					"FIFO"
					if any(p.basis == "FIFO" for p in allocations)
					else "explicit"
					if allocations
					else "",
					covered,
					uncovered,
					req.source,
				)
			)
	return result


def merge_order_flows(snapshot, metric, flows):
	orders = []
	for order in snapshot.orders:
		policy = selected(snapshot, metric, order.source)
		if not policy:
			continue
		shares = sorted(order.shares, key=lambda s: s.key)
		for stage, due in stages_for(snapshot, order, policy):
			for share, amount in zip(
				shares, allocate(stage.amount, [s.weight for s in shares], snapshot.precision), strict=True
			):
				if amount:
					orders.append(
						make_flow(snapshot, metric, order, share, amount, due, stage.due, stage.key)
					)
	by_order = defaultdict(list)
	for i, flow in enumerate(orders):
		a = flow.analytic
		by_order[(a.order, a.project, a.contract)].append(i)
	result = []
	for flow in flows:
		budget = flow.amount
		a = flow.analytic
		for i in by_order[(a.order, a.project, a.contract)]:
			parent = orders[i]
			amount = min(parent.amount, budget)
			if amount <= 0:
				continue
			winner = flow.date_source or flow.source
			refines = snapshot.policy.refines(metric, parent.source.doctype, winner.doctype)
			result.append(
				flow.with_changes(
					id=f"{flow.id}:order:{i}",
					amount=amount,
					original_amount=amount / (flow.amount / flow.original_amount)
					if flow.original_amount
					else ZERO,
					date=flow.date if refines else parent.date,
					date_source=winner if refines else parent.date_source,
					links=tuple(dict.fromkeys((*parent.links, *flow.links))),
				)
			)
			orders[i] = parent.with_changes(
				amount=parent.amount - amount,
				original_amount=parent.original_amount * (parent.amount - amount) / parent.amount,
			)
			budget -= amount
		if budget > 0:
			result.append(
				flow.with_changes(amount=budget, original_amount=flow.original_amount * budget / flow.amount)
			)
	return [*result, *(f for f in orders if f.amount > 0)]


def references(flow):
	return {*flow.links, flow.source, flow.payment, flow.analytic.order, flow.analytic.invoice}


def apply_instructions(snapshot, metric, flows):
	# Index explicit document aliases once. Each instruction visits its own
	# financial slices, not every document in the company.
	active = {}
	by_reference = defaultdict(set)
	by_order = defaultdict(set)
	next_slot = 0
	valuations = {o.source: o for o in (*snapshot.orders, *snapshot.invoices, *snapshot.requests)}

	def order_key(analytic):
		return (analytic.order, analytic.project, analytic.party_type, analytic.party, analytic.contract)

	def add(flow):
		nonlocal next_slot
		slot = next_slot
		next_slot += 1
		active[slot] = flow
		for ref in references(flow) - {None}:
			by_reference[ref].add(slot)
		if flow.source.doctype in ("Sales Order", "Purchase Order") and not flow.analytic.invoice:
			by_order[order_key(flow.analytic)].add(slot)
		return slot

	def remove(slot):
		flow = active.pop(slot)
		for ref in references(flow) - {None}:
			by_reference[ref].discard(slot)
		by_order[order_key(flow.analytic)].discard(slot)

	for flow in flows:
		add(flow)
	instructions = [
		i for i in snapshot.instructions if selected(snapshot, metric, i.source) and i.remaining > 0
	]
	instructions.sort(
		key=lambda i: (snapshot.policy.source(metric, i.source.doctype).priority, i.source, i.key)
	)
	grouped = defaultdict(list)
	for instruction in instructions:
		for share, amount in zip(
			instruction.shares,
			allocate(
				instruction.claim_remaining
				if instruction.claim_remaining is not None
				else instruction.remaining,
				[s.weight for s in instruction.shares],
				snapshot.precision,
			),
			strict=True,
		):
			grouped[(instruction.source.doctype, instruction.target, share.analytic)].append(
				(instruction, amount)
			)
	ambiguous = set()
	for (_doctype, target, analytic), candidates in grouped.items():
		if target is None or len({i.source for i, _amount in candidates}) < 2:
			continue
		limit = snapshot.claim_limits.get((target, analytic))
		if limit is None:
			limit = sum(
				(active[slot].amount for slot in by_reference[target] if active[slot].analytic == analytic),
				ZERO,
			)
		if sum((amount for _i, amount in candidates), ZERO) > limit:
			ambiguous.update((i.source, i.key) for i, _amount in candidates)
	if ambiguous:
		warn(snapshot, "Overlapping payment instructions: previous source retained")

	for instruction in instructions:
		if (instruction.source, instruction.key) in ambiguous:
			continue
		policy = snapshot.policy.source(metric, instruction.source.doctype)
		budget = (
			instruction.claim_remaining if instruction.claim_remaining is not None else instruction.remaining
		)
		cash_budget = instruction.remaining
		original_budget = money(cash_budget / instruction.rate, snapshot.precision)
		share_budgets = (
			[budget]
			if len(instruction.shares) == 1
			else allocate(budget, [s.weight for s in instruction.shares], snapshot.precision)
		)
		candidates = set(by_reference[instruction.source])
		if instruction.target:
			candidates.update(by_reference[instruction.target])
		for share in instruction.shares:
			if share.analytic.order:
				candidates.update(by_order[order_key(share.analytic)])
		matched = False
		for slot in sorted(candidates):
			if budget <= 0:
				break
			flow = active[slot]
			matched_shares = [
				index
				for index, share in enumerate(instruction.shares)
				if share.analytic == flow.analytic
				or (
					flow.source.doctype in ("Sales Order", "Purchase Order")
					and replace(share.analytic, invoice=None) == flow.analytic
				)
				or (
					instruction.target is not None
					and instruction.target == flow.analytic.order
					and replace(share.analytic, invoice=flow.analytic.invoice) == flow.analytic
				)
			]
			if not matched_shares or flow.direction != instruction.direction or flow.amount <= 0:
				continue
			previous = flow.amount_source or flow.date_source or flow.source
			previous_policy = snapshot.policy.source(metric, previous.doctype)
			# Equal-priority instructions consume disjoint free slices. Already
			# refined slices neither consume this row's budget nor receive a new date.
			if (
				previous_policy
				and previous_policy.priority == policy.priority
				and previous.doctype == instruction.source.doctype
			):
				continue
			matched = True
			refs = references(flow)
			can_refine = snapshot.policy.refines(metric, previous.doctype, instruction.source.doctype)
			can_refine = can_refine or any(
				snapshot.policy.refines(metric, ref.doctype, instruction.source.doctype)
				for ref in refs
				if ref and selected(snapshot, metric, ref)
			)
			if previous_policy and previous_policy.priority > policy.priority:
				can_refine = False
			stored_capacity = flow.obligation_amount if flow.obligation_amount is not None else flow.amount
			capacity = stored_capacity
			target = valuations.get(instruction.target)
			origin = valuations.get(flow.source)
			if (
				target
				and target.source.doctype in ("Sales Order", "Purchase Order")
				and origin
				and target.currency == origin.currency
			):
				capacity *= target.rate / origin.rate
			amount = min(budget, capacity, sum((share_budgets[i] for i in matched_shares), ZERO))
			if amount <= 0:
				continue
			book_amount = (
				stored_capacity
				if amount == capacity
				else money(stored_capacity * amount / capacity, snapshot.precision)
			)
			cash_amount = (
				cash_budget if amount == budget else money(cash_budget * amount / budget, snapshot.precision)
			)
			original_amount = (
				original_budget
				if amount == budget
				else money(original_budget * amount / budget, snapshot.precision)
			)
			budget -= amount
			cash_budget -= cash_amount
			original_budget -= original_amount
			share_amount = amount
			for index in matched_shares:
				used = min(share_amount, share_budgets[index])
				share_budgets[index] -= used
				share_amount -= used
			if not can_refine:
				continue
			due, own = expected_date(
				policy, snapshot.documents.get(instruction.source, {}), flow.date, timezone=snapshot.timezone
			)
			remove(slot)
			add(
				flow.with_changes(
					id=f"{flow.id}:{instruction.key}",
					amount=cash_amount,
					obligation_amount=book_amount,
					currency=instruction.currency,
					original_amount=original_amount,
					date=max(snapshot.today, due) if due else None,
					date_source=instruction.source if own else flow.date_source,
					amount_source=instruction.source,
					payment=instruction.source,
					links=tuple(dict.fromkeys((*flow.links, instruction.source, *instruction.links))),
					match_basis=flow.match_basis or "explicit",
					covered=amount,
					overdue=bool(due and due < snapshot.today) if own else flow.overdue,
					contract_overdue=bool(
						flow.original_date
						and flow.original_date < snapshot.today
						and due
						and due >= snapshot.today
					)
					if own
					else flow.contract_overdue,
				)
			)
			if capacity > amount:
				add(
					flow.with_changes(
						id=flow.id + ":remainder",
						amount=money(flow.amount * (capacity - amount) / capacity, snapshot.precision),
						obligation_amount=stored_capacity - book_amount,
						original_amount=flow.original_amount * (capacity - amount) / capacity,
					)
				)
		if (
			budget > 0
			and instruction.shares
			and (
				not matched
				or (instruction.target and instruction.target.doctype in ("Sales Order", "Purchase Order"))
			)
		):
			due = expected_date(
				policy, snapshot.documents.get(instruction.source, {}), timezone=snapshot.timezone
			)[0]
			obligation = Obligation(
				instruction.source,
				instruction.direction,
				instruction.total,
				instruction.remaining,
				instruction.currency,
				instruction.rate,
				[],
				instruction.shares,
			)
			for share, amount in zip(
				instruction.shares,
				allocate(cash_budget, share_budgets, snapshot.precision),
				strict=True,
			):
				if amount > 0:
					flow = make_flow(
						snapshot,
						metric,
						obligation,
						share,
						amount,
						due,
						due,
						instruction.key,
						basis="explicit",
					)
					add(
						flow.with_changes(
							payment=instruction.source,
							links=tuple(
								dict.fromkeys(
									(
										instruction.source,
										*instruction.links,
										*((instruction.target,) if instruction.target else ()),
									)
								)
							),
						)
					)
	return list(active.values())


def calculate_expected(snapshot, include_zero=False, expected_metrics=None):
	actual = [f for f in snapshot.actual if f.date and f.date <= snapshot.today]
	result = list(actual)
	snapshot.allocations = []
	metrics = ("plan", "forecast") if expected_metrics is None else expected_metrics
	if not metrics:
		snapshot.coverage_parts = None
		return result
	invoice_currencies = {i.source: i.currency for i in snapshot.invoices}
	physical_parts = snapshot.coverage_parts
	snapshot.coverage_parts = None
	if physical_parts is None:
		physical_parts = coverage(snapshot, snapshot.requests, snapshot.invoices)
	for metric in metrics:
		request_policy = snapshot.policy.source(metric, "Payment Request")
		requests = [
			r
			for r in snapshot.requests
			if r.outstanding <= 0
			or not request_policy
			or not request_policy.enabled
			or request_policy.accepts(snapshot.documents.get(r.source, {}))
		]
		# The comprehension only removes requests: equal length proves equal input.
		# Different status scopes require a separate allocation for that metric.
		parts = (
			physical_parts
			if len(requests) == len(snapshot.requests)
			else coverage(snapshot, requests, snapshot.invoices)
		)
		for part in parts:
			snapshot.allocations.append(
				{
					"metric": metric,
					"request": part.request,
					"invoice": part.invoice,
					"basis": part.basis,
					"invoice_share": part.invoice_share,
					"request_share": part.request_share,
					"currency": invoice_currencies[part.invoice],
					"covered_original": part.original,
					"remaining_original": part.remaining,
					"covered_company": part.company_gross,
					"remaining_company": part.company_remaining,
				}
			)
		flows = invoice_flows(snapshot, metric, snapshot.invoices, requests, parts)
		flows.extend(request_flows(snapshot, metric, requests, parts))
		flows = merge_order_flows(snapshot, metric, flows)
		flows = apply_instructions(snapshot, metric, flows)
		if include_zero:
			for doc in [*snapshot.orders, *snapshot.invoices]:
				if doc.outstanding <= 0 and selected(snapshot, metric, doc.source):
					for share in doc.shares:
						result.append(make_flow(snapshot, metric, doc, share, ZERO, None, None, "zero"))
		result.extend(f for f in flows if f.amount)
	ids = [f.id for f in result]
	if len(ids) != len(set(ids)):
		raise ValueError("Duplicate liquidity component")
	return result
