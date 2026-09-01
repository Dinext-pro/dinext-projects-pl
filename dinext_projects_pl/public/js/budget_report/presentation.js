frappe.provide("dinext_projects_pl.budget_plan_vs_forecast");

var br = dinext_projects_pl.budget_plan_vs_forecast;

function deepCloneData(data) {
	return JSON.parse(JSON.stringify(data || []));
}

function stripProfitRows(data) {
	return (data || []).filter(function (row) {
		return row && !row.is_profit_row && !row.is_profitability_row && !row.is_report_meta;
	});
}

br.extractReportPayload = function (data) {
	var riskTotals = null;
	var rows = [];

	(data || []).forEach(function (row) {
		if (row && row.is_report_meta) {
			riskTotals = row.risk_totals || riskTotals;
			return;
		}
		rows.push(row);
	});

	return {
		rows: rows,
		riskTotals: riskTotals,
	};
};

br.parseReportPeriodMeta = function (periodKey) {
	if (!periodKey || periodKey === "total") {
		return {};
	}

	var parts = String(periodKey).split("_");
	if (parts.length === 2 && /^\d{1,2}$/.test(parts[1])) {
		return {
			year: parseInt(parts[0], 10),
			month: parseInt(parts[1], 10),
		};
	}
	return {};
};

br.expandPeriodKeyToMonthlyKeys = function (periodKey) {
	if (!periodKey || periodKey === "total") {
		return [];
	}

	var parts = String(periodKey).split("_");
	if (parts.length === 2 && /^\d{1,2}$/.test(parts[1])) {
		var month = parseInt(parts[1], 10);
		if (month < 1 || month > 12) {
			return [];
		}
		return [parts[0] + "_" + (month < 10 ? "0" : "") + month];
	}
	if (parts.length === 1 && /^\d+$/.test(parts[0])) {
		var yearKeys = [];
		var year = parseInt(parts[0], 10);
		for (var monthNo = 1; monthNo <= 12; monthNo++) {
			yearKeys.push(year + "_" + (monthNo < 10 ? "0" : "") + monthNo);
		}
		return yearKeys;
	}
	if (parts.length === 2 && /^Q[1-4]$/i.test(parts[1])) {
		var quarterYear = parseInt(parts[0], 10);
		var quarter = parseInt(parts[1].slice(1), 10);
		var startMonth = (quarter - 1) * 3 + 1;
		return [0, 1, 2].map(function (offset) {
			var monthValue = startMonth + offset;
			return quarterYear + "_" + (monthValue < 10 ? "0" : "") + monthValue;
		});
	}
	return [];
};

br.sumRiskTotalsForPeriod = function (riskTotals, periodKey, valueKey, includeMonth) {
	if (!riskTotals || !periodKey) {
		return 0;
	}

	var monthlyKeys = br.expandPeriodKeyToMonthlyKeys(periodKey);
	if (!monthlyKeys.length) {
		monthlyKeys = [periodKey];
	}

	var total = 0;
	monthlyKeys.forEach(function (monthlyKey) {
		var bucket = riskTotals[monthlyKey];
		if (!bucket) {
			return;
		}
		if (includeMonth) {
			var meta = br.parseReportPeriodMeta(monthlyKey);
			if (!includeMonth(meta.year, meta.month)) {
				return;
			}
		}
		total += flt(bucket[valueKey]);
	});
	return total;
};

br.isPastReportPeriod = function (year, month) {
	var today = frappe.datetime.get_today();
	var parts = String(today).split("-");
	var currentYear = parseInt(parts[0], 10);
	var currentMonth = parseInt(parts[1], 10);
	return year < currentYear || (year === currentYear && month < currentMonth);
};

br.shouldApplyRiskForecast = function (filters, year, month) {
	if (!year || !month) {
		return false;
	}
	var viewType = (filters && filters.view_type) || "forecast_actual";
	if (viewType === "forecast_only") {
		return true;
	}
	if (viewType === "forecast_actual") {
		return !br.isPastReportPeriod(year, month);
	}
	return false;
};

br.getRiskAmountForSummaryGroup = function (riskTotals, group, filters) {
	if (!riskTotals || !group || !group.key) {
		return { plan: 0, display: 0 };
	}

	return {
		plan: br.sumRiskTotalsForPeriod(riskTotals, group.key, "plan"),
		display: br.sumRiskTotalsForPeriod(
			riskTotals,
			group.key,
			"forecast",
			function (year, month) {
				return br.shouldApplyRiskForecast(filters, year, month);
			}
		),
	};
};

br.applyRiskReservesToExpenseByColumn = function (
	expenseByColumn,
	monthlyColumns,
	riskTotals,
	filters
) {
	if (!riskTotals) {
		return;
	}

	var accumulated = cint(filters && filters.accumulated_values);
	var runningPlan = 0;
	var runningForecast = 0;

	monthlyColumns.forEach(function (col) {
		if (col.indexOf("plan_") === 0) {
			var planPeriodKey = col.slice("plan_".length);
			var planAmount = br.sumRiskTotalsForPeriod(riskTotals, planPeriodKey, "plan");
			if (!planAmount) {
				return;
			}
			if (accumulated) {
				runningPlan += planAmount;
				expenseByColumn[col] = flt(expenseByColumn[col]) + runningPlan;
			} else {
				expenseByColumn[col] = flt(expenseByColumn[col]) + planAmount;
			}
			return;
		}

		if (col.indexOf("forecast_") !== 0) {
			return;
		}

		var forecastPeriodKey = col.slice("forecast_".length);
		var forecastAmount = br.sumRiskTotalsForPeriod(
			riskTotals,
			forecastPeriodKey,
			"forecast",
			function (year, month) {
				return br.shouldApplyRiskForecast(filters, year, month);
			}
		);
		if (!forecastAmount) {
			return;
		}

		if (accumulated) {
			runningForecast += forecastAmount;
			expenseByColumn[col] = flt(expenseByColumn[col]) + runningForecast;
		} else {
			expenseByColumn[col] = flt(expenseByColumn[col]) + forecastAmount;
		}
	});
};

br.sumRiskDisplayExpense = function (riskTotals, periodGroups, filters) {
	if (!riskTotals || !periodGroups || !periodGroups.length) {
		return 0;
	}

	var total = 0;
	periodGroups.forEach(function (group) {
		total += br.getRiskAmountForSummaryGroup(riskTotals, group, filters).display;
	});
	return total;
};

br._periodSortKey = function (fieldname) {
	var parts = (fieldname || "").split("_");
	var prefix = parts[0];
	var periodKey = parts.slice(1).join("_");

	if (!periodKey) {
		return [prefix, 0, 0, 0];
	}

	var periodParts = periodKey.split("_");
	if (periodParts.length === 1 && /^\d+$/.test(periodParts[0])) {
		return [prefix, parseInt(periodParts[0], 10), 0, 0];
	}

	if (periodParts.length === 2) {
		var yearPart = periodParts[0];
		var second = periodParts[1];
		if (/^Q[1-4]$/i.test(second)) {
			return [prefix, parseInt(yearPart, 10), parseInt(second.slice(1), 10), 0];
		}
		var monthNum = parseInt(second, 10);
		if (!isNaN(monthNum)) {
			return [prefix, parseInt(yearPart, 10), monthNum, 0];
		}
	}

	return [prefix, 0, 0, 0];
};

br.getSortedPeriodFieldnames = function (columns, prefix, requirePeriodGroup) {
	var fieldnames = [];

	(columns || []).forEach(function (column) {
		var fieldname = column && column.fieldname;
		if (!fieldname || fieldname.indexOf(prefix) !== 0) {
			return;
		}
		if (requirePeriodGroup && !column.period_group) {
			return;
		}
		fieldnames.push(fieldname);
	});

	fieldnames.sort(function (a, b) {
		var keyA = br._periodSortKey(a);
		var keyB = br._periodSortKey(b);
		for (var i = 0; i < keyA.length; i++) {
			if (keyA[i] !== keyB[i]) {
				return keyA[i] - keyB[i];
			}
		}
		return 0;
	});

	return fieldnames;
};

br.getOrderedDisplayFieldnames = function (columns, filters) {
	filters = filters || {};
	var viewType = filters.view_type || "forecast_actual";
	var fieldnames = [];

	(columns || []).forEach(function (column) {
		var fieldname = column && column.fieldname;
		if (!fieldname || !column.period_group) {
			return;
		}
		if (column.period_role === "display") {
			fieldnames.push(fieldname);
			return;
		}
		if (viewType === "forecast_only" && fieldname.indexOf("forecast_") === 0) {
			fieldnames.push(fieldname);
		} else if (viewType === "actual_only" && fieldname.indexOf("actual_") === 0) {
			fieldnames.push(fieldname);
		}
	});

	return fieldnames;
};

br.applyAccumulatedValues = function (data, columns, filters) {
	if (!cint(filters && filters.accumulated_values) || !data || !data.length) {
		return data;
	}

	filters = filters || {};
	var planColumns = br.getSortedPeriodFieldnames(columns, "plan_");
	var displayColumns = br.getOrderedDisplayFieldnames(columns, filters);

	if (!planColumns.length && !displayColumns.length) {
		return data;
	}

	data.forEach(function (row) {
		if (planColumns.length) {
			var planRunning = 0;
			planColumns.forEach(function (fieldname) {
				planRunning += flt(row[fieldname]);
				row[fieldname] = planRunning;
			});
		}

		if (displayColumns.length) {
			var displayRunning = 0;
			displayColumns.forEach(function (fieldname) {
				displayRunning += flt(row[fieldname]);
				row[fieldname] = displayRunning;
			});
		}
	});

	return data;
};

br.getRootFinancialNodes = function (data) {
	var rootIncomeNodes = [];
	var rootExpenseNodes = [];

	(data || []).forEach(function (row) {
		if (!row || row.is_profit_row || row.is_profitability_row) {
			return;
		}
		if (cint(row.indent, 0) !== 0) {
			return;
		}
		if (row.root_type === "Income") {
			rootIncomeNodes.push(row.account);
		} else if (row.root_type === "Expense") {
			rootExpenseNodes.push(row.account);
		}
	});

	return {
		rootIncomeNodes: rootIncomeNodes,
		rootExpenseNodes: rootExpenseNodes,
	};
};

br.addRowTotals = function (data, filters, columns) {
	if (!data || !data.length) {
		return data;
	}

	filters = filters || {};
	var viewType = filters.view_type || "forecast_actual";
	var showPlan = cint(filters.show_plan);
	var accumulated = cint(filters.accumulated_values);

	var planColumns = br.getSortedPeriodFieldnames(columns, "plan_", true);
	var displayColumns = [];

	(columns || []).forEach(function (col) {
		var fieldname = col && col.fieldname;
		if (!fieldname) {
			return;
		}
		if (
			col.period_group &&
			(fieldname.indexOf("forecast_") === 0 ||
				fieldname.indexOf("actual_") === 0 ||
				col.period_role === "display")
		) {
			displayColumns.push(fieldname);
		}
	});

	displayColumns.sort(function (a, b) {
		var keyA = br._periodSortKey(a);
		var keyB = br._periodSortKey(b);
		for (var i = 0; i < keyA.length; i++) {
			if (keyA[i] !== keyB[i]) {
				return keyA[i] - keyB[i];
			}
		}
		return 0;
	});

	var totalDisplayField = null;
	if (viewType === "forecast_actual") {
		totalDisplayField = "total_exp_fct";
	} else if (viewType === "forecast_only") {
		totalDisplayField = "total_exp";
	} else if (viewType === "actual_only") {
		totalDisplayField = "total_fct";
	}

	data.forEach(function (row) {
		if (accumulated) {
			if (showPlan && planColumns.length) {
				row.total_plan = flt(row[planColumns[planColumns.length - 1]]);
			}
			if (totalDisplayField && displayColumns.length) {
				row[totalDisplayField] = flt(row[displayColumns[displayColumns.length - 1]]);
			}
			return;
		}

		var totalPlan = 0;
		planColumns.forEach(function (fieldname) {
			totalPlan += flt(row[fieldname]);
		});

		var totalExpFct = 0;
		displayColumns.forEach(function (fieldname) {
			totalExpFct += flt(row[fieldname]);
		});

		if (showPlan) {
			row.total_plan = totalPlan;
		}
		if (totalDisplayField) {
			row[totalDisplayField] = totalExpFct;
		}
	});

	return data;
};

br.addProfitRow = function (data, columns, filters, riskTotals) {
	if (!data || !data.length) {
		return data;
	}

	filters = filters || {};
	riskTotals = riskTotals || (filters && filters._report_risk_totals);
	var viewType = filters.view_type || "forecast_actual";
	var showPlan = cint(filters.show_plan);
	var accumulated = cint(filters.accumulated_values);

	var dataByAccount = {};
	data.forEach(function (row) {
		if (row && row.account) {
			dataByAccount[row.account] = row;
		}
	});

	var nodes = br.getRootFinancialNodes(data);
	var rootIncomeNodes = nodes.rootIncomeNodes;
	var rootExpenseNodes = nodes.rootExpenseNodes;

	var monthlyColumns = br.getSortedPeriodFieldnames(columns, "plan_")
		.concat(br.getSortedPeriodFieldnames(columns, "forecast_"))
		.concat(br.getSortedPeriodFieldnames(columns, "actual_"));

	var seenColumns = {};
	monthlyColumns = monthlyColumns.filter(function (fieldname) {
		if (seenColumns[fieldname]) {
			return false;
		}
		seenColumns[fieldname] = true;
		return true;
	});
	monthlyColumns.sort(function (a, b) {
		var keyA = br._periodSortKey(a);
		var keyB = br._periodSortKey(b);
		for (var i = 0; i < keyA.length; i++) {
			if (keyA[i] !== keyB[i]) {
				return keyA[i] - keyB[i];
			}
		}
		return 0;
	});

	var planColumns = br.getSortedPeriodFieldnames(columns, "plan_");
	var displayPeriodColumns = br.getOrderedDisplayFieldnames(columns, filters);

	var incomeByColumn = {};
	var expenseByColumn = {};

	rootIncomeNodes.forEach(function (accountName) {
		var row = dataByAccount[accountName];
		if (!row) {
			return;
		}
		monthlyColumns.forEach(function (col) {
			if (!incomeByColumn[col]) {
				incomeByColumn[col] = 0;
			}
			incomeByColumn[col] += flt(row[col]);
		});
	});

	rootExpenseNodes.forEach(function (accountName) {
		var row = dataByAccount[accountName];
		if (!row) {
			return;
		}
		monthlyColumns.forEach(function (col) {
			if (!expenseByColumn[col]) {
				expenseByColumn[col] = 0;
			}
			expenseByColumn[col] += flt(row[col]);
		});
	});

	br.applyRiskReservesToExpenseByColumn(
		expenseByColumn,
		monthlyColumns,
		riskTotals,
		filters
	);

	var profitRow = {
		account: br.__("Gross Profit"),
		indent: 0,
		is_group: 0,
		parent_account: "",
		has_value: true,
		is_profit_row: true,
		root_type: "Profit",
	};

	var profitabilityRow = {
		account: br.__("Profitability (%)"),
		indent: 1,
		is_group: 0,
		parent_account: "",
		has_value: true,
		is_profitability_row: true,
		root_type: "Profitability",
	};

	monthlyColumns.forEach(function (col) {
		var income = flt(incomeByColumn[col]);
		var expense = flt(expenseByColumn[col]);
		var profit = income - expense;

		profitRow[col] = profit;

		var profitability = 0;
		if (income !== 0) {
			profitability = (profit / income) * 100;
		}
		profitabilityRow[col] = flt(profitability, 1);
	});

	var totalIncomePlan;
	var totalExpensePlan;
	var totalIncomeExpFct;
	var totalExpenseExpFct;

	if (accumulated) {
		totalIncomePlan = planColumns.length ? flt(incomeByColumn[planColumns[planColumns.length - 1]]) : 0;
		totalExpensePlan = planColumns.length
			? flt(expenseByColumn[planColumns[planColumns.length - 1]])
			: 0;
		totalIncomeExpFct = displayPeriodColumns.length
			? flt(incomeByColumn[displayPeriodColumns[displayPeriodColumns.length - 1]])
			: 0;
		totalExpenseExpFct = displayPeriodColumns.length
			? flt(expenseByColumn[displayPeriodColumns[displayPeriodColumns.length - 1]])
			: 0;
	} else {
		totalIncomePlan = 0;
		planColumns.forEach(function (col) {
			totalIncomePlan += flt(incomeByColumn[col]);
		});
		totalExpensePlan = 0;
		planColumns.forEach(function (col) {
			totalExpensePlan += flt(expenseByColumn[col]);
		});
		totalIncomeExpFct = 0;
		displayPeriodColumns.forEach(function (col) {
			totalIncomeExpFct += flt(incomeByColumn[col]);
		});
		totalExpenseExpFct = 0;
		displayPeriodColumns.forEach(function (col) {
			totalExpenseExpFct += flt(expenseByColumn[col]);
		});
	}

	if (showPlan) {
		profitRow.total_plan = totalIncomePlan - totalExpensePlan;
	}

	if (viewType === "forecast_actual") {
		profitRow.total_exp_fct = totalIncomeExpFct - totalExpenseExpFct;
	} else if (viewType === "forecast_only") {
		profitRow.total_exp = totalIncomeExpFct - totalExpenseExpFct;
	} else if (viewType === "actual_only") {
		profitRow.total_fct = totalIncomeExpFct - totalExpenseExpFct;
	}

	if (showPlan) {
		if (totalIncomePlan !== 0) {
			profitabilityRow.total_plan = flt(
				((totalIncomePlan - totalExpensePlan) / totalIncomePlan) * 100,
				1
			);
		} else {
			profitabilityRow.total_plan = 0;
		}
	}

	if (viewType === "forecast_actual") {
		if (totalIncomeExpFct !== 0) {
			profitabilityRow.total_exp_fct = flt(
				((totalIncomeExpFct - totalExpenseExpFct) / totalIncomeExpFct) * 100,
				1
			);
		} else {
			profitabilityRow.total_exp_fct = 0;
		}
	} else if (viewType === "forecast_only") {
		if (totalIncomeExpFct !== 0) {
			profitabilityRow.total_exp = flt(
				((totalIncomeExpFct - totalExpenseExpFct) / totalIncomeExpFct) * 100,
				1
			);
		} else {
			profitabilityRow.total_exp = 0;
		}
	} else if (viewType === "actual_only") {
		if (totalIncomeExpFct !== 0) {
			profitabilityRow.total_fct = flt(
				((totalIncomeExpFct - totalExpenseExpFct) / totalIncomeExpFct) * 100,
				1
			);
		} else {
			profitabilityRow.total_fct = 0;
		}
	}

	data.push(profitRow);
	data.push(profitabilityRow);

	return data;
};

br.store_budget_source_snapshot = function (report) {
	if (!report) {
		return;
	}
	var extracted = br.extractReportPayload(report.data);
	report._budget_risk_totals = extracted.riskTotals;
	report._budget_source_snapshot = deepCloneData(extracted.rows);
};

br.apply_budget_presentation = function (report) {
	if (!report || !report._budget_source_snapshot) {
		return;
	}

	var snapshot = report._budget_source_snapshot;
	var filters = report.get_filter_values ? report.get_filter_values() : {};
	var columns = br.get_budget_report_columns
		? br.get_budget_report_columns(report)
		: report.columns || [];

	if (cint(filters.accumulated_values)) {
		var data = stripProfitRows(deepCloneData(snapshot));
		br.applyAccumulatedValues(data, columns, filters);
		br.addRowTotals(data, filters, columns);
		br.addProfitRow(data, columns, filters, report._budget_risk_totals);
		report.data = data;
	} else {
		report.data = deepCloneData(snapshot);
	}

	if (typeof br.render_budget_summary === "function") {
		br.render_budget_summary(report);
	}
};

br.rerender_budget_presentation = function (report) {
	report = report || frappe.query_report;
	if (!report || typeof report.render_datatable !== "function") {
		return;
	}

	report.render_datatable();

	var cg = br.column_groups;
	if (cg && typeof cg.ensure_grouped_headers === "function") {
		cg.ensure_grouped_headers(report, 0);
	} else if (cg && typeof cg.schedule_budget_grouped_headers === "function") {
		cg.schedule_budget_grouped_headers(report);
	} else if (typeof br.after_datatable_render === "function") {
		br.after_datatable_render();
	}
};

br.install_budget_presentation_hooks = function (report) {
	if (!report || report._budget_presentation_hooks_installed) {
		return;
	}
	report._budget_presentation_hooks_installed = true;

	var originalPrepareReportData = report.prepare_report_data.bind(report);
	report.prepare_report_data = function (data) {
		originalPrepareReportData(data);
		br.store_budget_source_snapshot(report);
		br.apply_budget_presentation(report);
	};
};
