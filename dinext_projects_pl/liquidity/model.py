"""Financial primitives. No database, session, floating point arithmetic or wall clock."""

from __future__ import annotations

import calendar
import json
from copy import copy
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal
from typing import TYPE_CHECKING, Literal, TypedDict

if TYPE_CHECKING:
	from .fifo import Coverage
	from .settings import Policy

Metric = Literal["plan", "forecast", "actual", "adjustment", "transfer"]
METRICS = ("plan", "forecast", "actual")
ZERO = Decimal("0")


def decimal(value=0) -> Decimal:
	result = value if isinstance(value, Decimal) else Decimal(str(value or 0))
	if not result.is_finite():
		raise ValueError("Invalid monetary value")
	return result


def money(value, precision=2) -> Decimal:
	return decimal(value).quantize(Decimal(1).scaleb(-precision), rounding=ROUND_HALF_UP)


def allocate(amount: Decimal, weights: list[Decimal], precision=2) -> list[Decimal]:
	"""Conserve the rounded amount, assigning the remainder to the last positive weight."""
	if len(weights) == 1 and weights[0] > 0:
		return [money(amount, precision)]
	if any(w < 0 for w in weights):
		raise ValueError("Negative allocation weight")
	result = [ZERO] * len(weights)
	total = sum(weights, ZERO)
	if not total:
		if amount:
			raise ValueError("Missing allocation weights")
		return result
	amount = money(amount, precision)
	indices = [i for i, w in enumerate(weights) if w]
	for i in indices[:-1]:
		result[i] = (amount * weights[i] / total).quantize(Decimal(1).scaleb(-precision), rounding=ROUND_DOWN)
	result[indices[-1]] = amount - sum(result, ZERO)
	return result


def allocate_matrix(amounts: list[Decimal], weights: list[Decimal], precision=2) -> list[list[Decimal]]:
	"""Conserve both stage totals and document-level analytical shares in minor units."""
	if not amounts:
		return []
	amounts = [money(amount, precision) for amount in amounts]
	if any(amount < 0 for amount in amounts):
		raise ValueError("Negative allocation amount")
	if len(weights) == 1 and decimal(weights[0]) > ZERO:
		return [[amount] for amount in amounts]
	remaining = allocate(sum(amounts, ZERO), weights, precision)
	rows = []
	for amount in amounts:
		proposed = allocate(amount, weights, precision)
		row = [min(part, available) for part, available in zip(proposed, remaining, strict=True)]
		left = amount - sum(row, ZERO)
		for index in range(len(weights) - 1, -1, -1):
			part = min(left, remaining[index] - row[index])
			row[index] += part
			left -= part
		remaining = [available - part for available, part in zip(remaining, row, strict=True)]
		rows.append(row)
	return rows


def native_total(snapshot, obligation):
	doc = snapshot.documents.get(obligation.source, {})
	value = (
		doc.get("grand_total")
		if doc.get("disable_rounded_total")
		else doc.get("rounded_total") or doc.get("grand_total")
	)
	return (
		abs(decimal(value))
		if value is not None
		else money(obligation.total / obligation.rate, snapshot.precision)
	)


def native_outstanding(snapshot, obligation):
	return (
		native_total(snapshot, obligation)
		if obligation.outstanding == obligation.total
		else money(obligation.outstanding / obligation.rate, snapshot.precision)
	)


def as_date(value) -> date | None:
	if value in (None, ""):
		return None
	if isinstance(value, date):
		return value if type(value) is date else date.fromisoformat(value.isoformat()[:10])
	return date.fromisoformat(str(value))


class FilterInput(TypedDict, total=False):
	company: str
	from_date: str
	to_date: str
	grain: Literal["day", "week", "month"]
	projects: list[str]
	portfolios: list[str]
	party_type: Literal["", "Customer", "Supplier", "Employee"]
	parties: list[str]
	accounts: list[str]
	direction: Literal["", "in", "out"]
	grouping: Literal["project_party", "party_project", "party_only"]
	metrics: list[Literal["plan", "forecast", "actual"]]
	show_zero: bool | Literal[0, 1, "0", "1"]


@dataclass(frozen=True)
class Filters:
	company: str
	from_date: date
	to_date: date
	grain: str = "week"
	projects: tuple[str, ...] = ()
	portfolios: tuple[str, ...] = ()
	party_type: str = ""
	parties: tuple[str, ...] = ()
	accounts: tuple[str, ...] = ()
	direction: str = ""
	grouping: str = "project_party"
	metrics: tuple[str, ...] = METRICS
	show_zero: bool = False

	@property
	def analytical(self):
		return bool(self.projects or self.portfolios or self.party_type or self.parties or self.direction)

	@classmethod
	def parse(cls, raw: FilterInput | str | None, today: date) -> Filters:
		if isinstance(raw, str):
			raw = json.loads(raw)
		if not isinstance(raw, dict):
			raise ValueError("Company is required")
		unknown = set(raw) - set(FilterInput.__annotations__)
		if unknown:
			raise ValueError("Unknown calendar filter")
		company = raw.get("company")
		if not isinstance(company, str) or not company.strip():
			raise ValueError("Company is required")
		start = as_date(raw.get("from_date")) or today - timedelta(days=today.weekday())
		end = as_date(raw.get("to_date")) or start + timedelta(days=90)
		if end < start or (end - start).days > 1095:
			raise ValueError("Select a valid date range of up to three years")
		values = {"company": company, "from_date": start, "to_date": end}
		for name, allowed, default in (
			("grain", ("day", "week", "month"), "week"),
			("grouping", ("project_party", "party_project", "party_only"), "project_party"),
			("direction", ("", "in", "out"), ""),
			("party_type", ("", "Customer", "Supplier", "Employee"), ""),
		):
			value = raw.get(name) or default
			if not isinstance(raw.get(name, ""), str) or value not in allowed:
				raise ValueError("Invalid calendar filter")
			values[name] = value
		for name in ("projects", "portfolios", "parties", "accounts", "metrics"):
			value = raw.get(name, list(METRICS) if name == "metrics" else [])
			if not isinstance(value, list | tuple) or len(value) > 500:
				raise ValueError("Invalid calendar selection")
			if any(not isinstance(v, str) or not v or len(v) > 200 for v in value):
				raise ValueError("Invalid calendar selection")
			values[name] = tuple(dict.fromkeys(value))
		if not values["metrics"] or set(values["metrics"]) - set(METRICS):
			raise ValueError("Select at least one valid metric")
		flag = raw.get("show_zero", False)
		if flag not in (False, True, 0, 1, "0", "1"):
			raise ValueError("Invalid zero rows flag")
		values["show_zero"] = flag in (True, 1, "1")
		return cls(**values)


@dataclass(frozen=True)
class Period:
	key: str
	start: date
	end: date


def periods(filters: Filters) -> list[Period]:
	result = []
	start = filters.from_date
	while start <= filters.to_date:
		if filters.grain == "day":
			end = start
		elif filters.grain == "week":
			end = start + timedelta(days=6 - start.weekday())
		else:
			end = start.replace(day=calendar.monthrange(start.year, start.month)[1])
		end = min(end, filters.to_date)
		result.append(Period(start.isoformat(), start, end))
		start = end + timedelta(days=1)
	return result


@dataclass(frozen=True, order=True, slots=True)
class Link:
	doctype: str
	name: str


@dataclass(frozen=True, slots=True)
class Analytic:
	project: str = ""
	party_type: str = ""
	party: str = ""
	contract: str = ""
	order: Link | None = None
	invoice: Link | None = None


@dataclass(frozen=True, slots=True)
class Share:
	key: str
	weight: Decimal
	analytic: Analytic


@dataclass(frozen=True, slots=True)
class Stage:
	key: str
	due: date | None
	amount: Decimal
	term: str = ""


def remaining_stages(
	stages: list[Stage],
	total: Decimal,
	outstanding: Decimal,
	paid_by_term: dict[str, Decimal] | None = None,
	precision=2,
) -> list[Stage]:
	"""Explicit term settlement first, then chronological FIFO; reconcile to document balance."""
	outstanding = money(max(ZERO, min(total, outstanding)), precision)
	if not outstanding:
		return []
	stages = sorted(stages or [Stage("undated", None, total)], key=lambda s: (s.due or date.max, s.key))
	if len(stages) == 1:
		stage = stages[0]
		return [Stage(stage.key, stage.due, outstanding, stage.term)]
	weights = [max(s.amount, ZERO) for s in stages]
	if not sum(weights, ZERO):
		weights = [Decimal(1)] * len(stages)
	amounts = allocate(total, weights, precision)
	paid = max(ZERO, money(total, precision) - outstanding)
	explicit = dict(paid_by_term or {})
	for i, stage in enumerate(stages):
		use = min(amounts[i], paid, max(ZERO, explicit.get(stage.term, ZERO)))
		amounts[i] -= use
		paid -= use
		explicit[stage.term] = explicit.get(stage.term, ZERO) - use
	for i in range(len(stages)):
		use = min(amounts[i], paid)
		amounts[i] -= use
		paid -= use
	return [Stage(s.key, s.due, a, s.term) for s, a in zip(stages, amounts, strict=True) if a]


@dataclass(slots=True)
class Obligation:
	source: Link
	direction: str
	total: Decimal
	outstanding: Decimal
	currency: str
	rate: Decimal
	stages: list[Stage]
	shares: list[Share]
	paid_by_term: dict[str, Decimal] = field(default_factory=dict)


@dataclass(slots=True)
class Request:
	source: Link
	direction: str
	outstanding: Decimal
	total: Decimal
	currency: str
	rate: Decimal
	date: date | None
	shares: list[Share]
	# Outstanding, explicitly evidenced coverage in COMPANY currency.
	coverage: dict[Link, Decimal] = field(default_factory=dict)
	invoice_only: bool = False
	links: tuple[Link, ...] = ()
	status: str = ""
	term: str = ""
	gross_coverage: dict[Link, Decimal] = field(default_factory=dict)
	paid_by_invoice: dict[Link, Decimal] = field(default_factory=dict)


@dataclass(frozen=True)
class Flow:
	id: str
	metric: Metric
	direction: str
	amount: Decimal
	date: date | None
	original_date: date | None
	source: Link
	analytic: Analytic
	currency: str
	original_amount: Decimal
	paid: Decimal = ZERO
	outstanding: Decimal = ZERO
	payment: Link | None = None
	links: tuple[Link, ...] = ()
	status: str = ""
	account: str = ""
	overdue: bool = False
	contract_overdue: bool = False
	date_source: Link | None = None
	amount_source: Link | None = None
	match_basis: str = ""
	covered: Decimal = ZERO
	uncovered: Decimal = ZERO
	# Preserve the obligation's book basis when an expected cash source has another rate.
	obligation_amount: Decimal | None = None

	def with_changes(self, **changes):
		"""Copy immutable financial data without repeating per-field construction."""
		if changes.keys() - self.__dict__.keys():
			raise TypeError("Unknown liquidity component field")
		cloned = copy(self)
		for name, value in changes.items():
			object.__setattr__(cloned, name, value)
		return cloned

	@property
	def signed(self):
		return self.amount if self.direction == "in" else -self.amount


@dataclass
class Snapshot:
	today: date
	currency: str
	precision: int = 2
	orders: list[Obligation] = field(default_factory=list)
	invoices: list[Obligation] = field(default_factory=list)
	requests: list[Request] = field(default_factory=list)
	actual: list[Flow] = field(default_factory=list)
	# GL balances/movements have already been restricted to the selected cash accounts.
	opening: Decimal = ZERO
	cash_daily: dict[date, Decimal] = field(default_factory=dict)
	current_cash: Decimal = ZERO
	can_balance: bool = False
	complete: bool = True
	warnings: list[str] = field(default_factory=list)
	policy: Policy | None = None
	documents: dict[Link, dict] = field(default_factory=dict)
	instructions: list = field(default_factory=list)
	allocations: list[dict] = field(default_factory=list)
	timezone: str = "UTC"
	claim_limits: dict[tuple[Link, Analytic], Decimal] = field(default_factory=dict)
	# One-use allocations prepared by the adapter, never shared across requests.
	coverage_parts: list[Coverage] | None = None
