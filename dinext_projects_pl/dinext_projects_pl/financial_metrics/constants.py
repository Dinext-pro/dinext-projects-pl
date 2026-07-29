"""Metadata for EVM financial metric groups shown on Project P&L."""

from frappe import _


def get_evm_metric_groups():
	"""Return metric group metadata mirroring the client-side EVM panel contract."""
	return [
		{
			"key": "base",
			"label": _("Baseline"),
			"metrics": [
				{
					"key": "BAC",
					"label": "BAC",
					"kind": "currency",
					"shortName": _("Budget at Completion"),
					"formula": _("We sum all approved plan amounts for this stream over the entire project duration."),
					"interpretation": _("This is the entire approved project budget for the selected stream through completion."),
				},
				{
					"key": "PV",
					"label": "PV",
					"kind": "currency",
					"shortName": _("Planned Value"),
					"formula": _("We take the plan as of the report date: past months are counted in full, the current month — only for days already elapsed."),
					"interpretation": _("Shows how much should have been completed and earned by the selected date according to the plan."),
				},
				{
					"key": "EV",
					"label": "EV",
					"kind": "currency",
					"shortName": _("Earned Value"),
					"formula": _("We take the total budget and multiply it by the current project completion percentage."),
					"interpretation": _("Shows the value of the result the project should already have delivered by this date."),
				},
				{
					"key": "AC",
					"label": "AC",
					"kind": "currency",
					"shortName": _("Actual Cost"),
					"formula": _("We sum all actual amounts as of the report date: past months in full, the current month — for days already elapsed."),
					"interpretation": _("Shows how much money has already been spent or recorded as actuals by this date."),
				},
			],
		},
		{
			"key": "variance",
			"label": _("Variances"),
			"metrics": [
				{
					"key": "CV",
					"label": "CV",
					"kind": "currency",
					"shortName": _("Cost Variance"),
					"formula": _("We subtract actual costs from the value of completed work."),
					"interpretation": _("If the value is less than zero, more money was spent than the value of the result. If greater than zero, there is a saving."),
				},
				{
					"key": "SV",
					"label": "SV",
					"kind": "currency",
					"shortName": _("Schedule Variance"),
					"formula": _("We subtract what should have been done by this date according to the plan from the value of completed work."),
					"interpretation": _("If the value is less than zero, the project is behind schedule. If greater than zero, the project is ahead of schedule."),
				},
			],
		},
		{
			"key": "indices",
			"label": _("Indices"),
			"metrics": [
				{
					"key": "CPI",
					"label": "CPI",
					"kind": "ratio",
					"shortName": _("Cost Performance Index"),
					"formula": _("We divide the value of completed work by actual costs."),
					"interpretation": _("Shows how much value the project gets for each monetary unit spent. A value greater than one is considered good."),
				},
				{
					"key": "SPI",
					"label": "SPI",
					"kind": "ratio",
					"shortName": _("Schedule Performance Index"),
					"formula": _("We divide the value of completed work by what should have been done by this date according to the plan."),
					"interpretation": _("Shows how well actual progress matches the plan. A value greater than one is considered good."),
				},
			],
		},
		{
			"key": "forecast",
			"label": _("Forecast"),
			"metrics": [
				{
					"key": "EAC",
					"label": "EAC",
					"kind": "currency",
					"shortName": _("Estimate at Completion"),
					"formula": _("We take the accumulated actuals and add the remaining budget adjusted for current cost and schedule performance."),
					"interpretation": _("Shows how much this project stream will cost at completion if the current trend continues."),
				},
				{
					"key": "ETC",
					"label": "ETC",
					"kind": "currency",
					"shortName": _("To Complete"),
					"formula": _("We subtract what has already been accumulated as actuals from the estimate at completion."),
					"interpretation": _("Shows how much more money is needed to complete under the current forecast."),
				},
				{
					"key": "VAC",
					"label": "VAC",
					"kind": "currency",
					"shortName": _("Variance at Completion"),
					"formula": _("We subtract the forecast final amount from the total approved budget."),
					"interpretation": _("If the value is less than zero, a cost overrun is expected at completion. If greater than zero, there is remaining budget."),
				},
			],
		},
		{
			"key": "efficiency",
			"label": _("To-Complete Performance Index"),
			"metrics": [
				{
					"key": "TCPI",
					"label": "TCPI",
					"kind": "ratio",
					"shortName": _("To-Complete Performance Index"),
					"formula": _("We compare the remaining budgeted work with how much can still be spent without exceeding the total budget."),
					"interpretation": _("Shows how efficiently you need to work going forward to stay within the total budget. A value less than or equal to one is considered achievable."),
				},
			],
		},
	]
