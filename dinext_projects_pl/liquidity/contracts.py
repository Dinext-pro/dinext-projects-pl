"""Public calendar request and response contracts; runtime validation remains explicit."""

from typing import Literal, TypedDict

from .model import FilterInput, Metric

OptionKind = Literal["company", "project", "portfolio", "account", "party"]
CellMetric = Literal[
	"plan",
	"forecast",
	"actual",
	"adjustment",
	"transfer",
	"combined",
	"combined_transfer",
	"combined_adjustment",
	"actual_opening",
	"actual_closing",
	"projected_opening",
	"projected_closing",
]


class CalendarFormInput(TypedDict, total=False):
	filters: FilterInput | str | None
	depth: int | str
	expected_settings_version: str | None


class ChildrenFormInput(TypedDict):
	filters: FilterInput | str
	node_key: str
	expected_settings_version: str | None


class CellDetailsFormInput(ChildrenFormInput):
	period_key: str
	metric: CellMetric
	start: int | str
	page_length: int | str


class ExportFormInput(TypedDict):
	filters: FilterInput | str
	expected_settings_version: str | None


class OptionsFormInput(TypedDict):
	kind: OptionKind
	company: str | None
	txt: str
	party_type: Literal["", "Customer", "Supplier", "Employee"] | None


class OptionResponse(TypedDict):
	value: str
	description: str


class DocumentLinkResponse(TypedDict):
	doctype: str
	name: str


class CalendarRowNavigation(TypedDict, total=False):
	children: list["CalendarRowResponse"]
	document: DocumentLinkResponse
	icon: str


class CalendarRowResponse(CalendarRowNavigation):
	"""Tree metadata; period/metric amounts are additional dynamic numeric keys."""

	id: str
	label: str
	level: str
	depth: int
	parent: str
	hasChildren: bool
	path: list[str | list[str]]


class PeriodResponse(TypedDict):
	key: str
	start: str
	end: str


class BalancePeriodResponse(TypedDict):
	key: str
	actual_opening: float | None
	actual_closing: float | None
	projected_opening: float | None
	projected_closing: float | None


class BalanceDayResponse(TypedDict):
	date: str
	opening: float
	closing: float


class BalancesResponse(TypedDict):
	current_cash: float
	minimum: float | None
	first_gap_date: str | None
	periods: list[BalancePeriodResponse]
	daily: list[BalanceDayResponse]


class KpisResponse(TypedDict):
	expected_receipts: float
	expected_payments: float


class ChildrenResponse(TypedDict):
	rows: list[CalendarRowResponse]
	settings_version: str


class SettingsDateOption(TypedDict):
	value: str
	label: str


class SettingsSourceCatalog(TypedDict):
	dates: list[SettingsDateOption]
	statuses: list[str]


class SettingsCatalogResponse(TypedDict):
	sources: dict[str, SettingsSourceCatalog]


class CalendarResponse(TypedDict):
	settings_version: str
	filters: FilterInput
	as_of: str
	calculated_at: str
	currency: str
	precision: int
	periods: list[PeriodResponse]
	rows: list[CalendarRowResponse]
	directions: dict[str, dict[str, float]]
	net: dict[str, float]
	balances: BalancesResponse | None
	complete: bool
	warnings: list[str]
	kpis: KpisResponse
	account_filter_note: str


class BalanceDetailsFields(TypedDict, total=False):
	anchor: float
	movement: float


class AnalyticResponse(TypedDict):
	project: str
	party_type: str
	party: str
	contract: str
	order: DocumentLinkResponse | None
	invoice: DocumentLinkResponse | None


class PaymentStageResponse(DocumentLinkResponse):
	docstatus: int
	status: str
	currency: str
	scope: Literal["analytical_share", "component"]
	non_additive: Literal[True]
	requested: float | None
	ordered: float | None
	settled: float | None
	executed: float | None
	remaining: float | None
	amounts_reason: Literal["", "ambiguous_allocation"]


class PaymentStageFields(TypedDict, total=False):
	payment_stages: list[PaymentStageResponse]


class FlowResponse(PaymentStageFields):
	id: str
	metric: Metric
	direction: Literal["in", "out"]
	amount: float
	date: str | None
	original_date: str | None
	source: DocumentLinkResponse
	analytic: AnalyticResponse
	currency: str
	original_amount: float
	paid: float
	outstanding: float
	payment: DocumentLinkResponse | None
	links: list[DocumentLinkResponse]
	status: str
	account: str
	overdue: bool
	contract_overdue: bool
	date_source: DocumentLinkResponse | None
	amount_source: DocumentLinkResponse | None
	match_basis: str
	covered: float
	uncovered: float
	obligation_amount: float | None


class CellDetailsResponse(BalanceDetailsFields):
	settings_version: str
	rows: list[FlowResponse]
	total: float
	signed: bool
	count: int
	start: int
	page_length: int
	as_of: str
	calculated_at: str


class SettingsConflictResponse(TypedDict):
	error: Literal["calendar_settings_changed"]
	message: str
