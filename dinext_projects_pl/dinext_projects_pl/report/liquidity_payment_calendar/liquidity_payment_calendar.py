from frappe import _

from dinext_projects_pl.liquidity.api import calendar


def execute(filters=None):
	result = calendar(filters)
	payload = result.payload()
	columns = [{"fieldname": "label", "label": _("Name"), "fieldtype": "Data", "width": 300}]
	period_labels = {p.key: f"{p.start} — {p.end}" for p in result.periods}
	period_labels.update(total=_("Selected period total"), undated=_("Without date"))
	for period in period_labels:
		for metric in result.filters.metrics:
			columns.append(
				{
					"fieldname": period + "__" + metric,
					"label": f"{period_labels[period]} / {_(metric.title())}",
					"fieldtype": "Currency",
					"options": result.snapshot.currency,
					"width": 140,
				}
			)
	# The scoped client renders ECharts from get_calendar. Standard Script Report
	# consumers still receive the same combined cash series and KPI totals.
	chart = {
		"type": "bar",
		"data": {
			"labels": [period_labels[p.key] for p in result.periods],
			"datasets": [
				{
					"name": _(label),
					"values": [
						sign
						* sum(
							payload["directions"][direction].get(p.key + "__" + metric, 0)
							for metric in ("actual", "forecast")
						)
						for p in result.periods
					],
				}
				for direction, label, sign in (("in", "Receipts", 1), ("out", "Payments", -1))
			],
		},
	}
	summary = [
		{
			"label": _(label),
			"value": payload["kpis"][key],
			"datatype": "Currency",
			"currency": payload["currency"],
		}
		for label, key in (
			("Expected receipts", "expected_receipts"),
			("Expected payments", "expected_payments"),
		)
	]
	return columns, result.children(), None, chart, summary, True
