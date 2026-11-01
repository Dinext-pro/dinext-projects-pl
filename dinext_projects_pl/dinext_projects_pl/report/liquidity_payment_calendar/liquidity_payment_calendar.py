from frappe import _

from dinext_projects_pl.liquidity.api import calendar


def execute(filters=None):
	result = calendar(filters)
	payload = result.payload()
	selected = result.filters.metrics
	cash_metric = (
		"combined"
		if {"actual", "forecast"}.issubset(selected)
		else next((metric for metric in ("actual", "forecast") if metric in selected), None)
	)
	metrics = (["plan"] if "plan" in selected else []) + ([cash_metric] if cash_metric else [])
	keys = (["undated"] if result.has_undated else []) + [period.key for period in result.periods] + ["total"]
	metric_labels = {
		"plan": _("Plan"),
		"actual": _("Actual"),
		"forecast": _("Forecast"),
		"combined": _("Cash movement"),
	}
	period_labels = {"undated": _("Without date"), "total": _("Total")}
	for period in result.periods:
		if result.filters.grain == "week":
			year, week, _weekday = period.start.isocalendar()
			period_labels[period.key] = f"{week:02d} · {year}"
		elif result.filters.grain == "month":
			period_labels[period.key] = period.start.strftime("%m.%Y")
		else:
			period_labels[period.key] = period.start.strftime("%d.%m.%Y")

	def column_label(key, metric):
		if metric == "combined":
			kinds = (
				{result.period_metric(period.key) for period in result.periods}
				if key == "total"
				else {result.period_metric(key)}
			)
			if len(kinds) == 1:
				metric = kinds.pop()
		return metric_labels[metric]

	columns = [{"fieldname": "label", "label": _("Name"), "fieldtype": "Data", "width": 300}]
	for key in keys:
		for metric in metrics:
			columns.append(
				{
					"fieldname": key + "__" + metric,
					"label": f"{period_labels[key]} / {column_label(key, metric)}",
					"fieldtype": "Currency",
					"options": result.snapshot.currency,
					"width": 140,
				}
			)
	rows = [
		{
			**row,
			**{
				key + "__" + metric: result.display_value(row, key, metric)
				for key in keys
				for metric in metrics
			},
		}
		for row in result.children()
	]
	# Standard Script Report consumers follow the same period-dependent choice
	# as the scoped ECharts client and XLSX; plan remains a separate series.
	chart = {
		"type": "bar",
		"data": {
			"labels": [period_labels[period.key] for period in result.periods],
			"datasets": [
				{
					"name": f"{_(label)} / {column_label('total', metric)}",
					"values": [
						sign * result.display_value(payload["directions"][direction], period.key, metric)
						for period in result.periods
					],
				}
				for metric in metrics
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
	return columns, rows, None, chart, summary, True
