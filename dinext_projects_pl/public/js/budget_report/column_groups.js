frappe.provide("dinext_projects_pl.budget_plan_vs_forecast.column_groups");

var cg = dinext_projects_pl.budget_plan_vs_forecast.column_groups;
var br = dinext_projects_pl.budget_plan_vs_forecast;

br.column_groups = cg;

cg.parse_period_fieldname = function (fieldname) {
	var match = /^(plan|actual|forecast)_(\d{4})(?:_(\d{2}|Q[1-4]))?$/.exec(fieldname || "");
	if (!match) {
		return null;
	}
	var period_key = match[2] + (match[3] ? "_" + match[3] : "");
	return {
		type: match[1],
		year: cint(match[2]),
		month: match[3] && /^\d+$/.test(match[3]) ? cint(match[3]) : null,
		quarter: match[3] && match[3].indexOf("Q") === 0 ? cint(match[3].slice(1)) : null,
		period_key: period_key,
	};
};

cg.format_period_label = function (period_key) {
	var parts = (period_key || "").split("_");
	if (parts.length === 1 && /^\d{4}$/.test(parts[0])) {
		return parts[0];
	}
	if (parts.length === 2 && parts[1].indexOf("Q") === 0) {
		return parts[1] + " " + parts[0];
	}
	if (parts.length !== 2) {
		return period_key;
	}
	var month_date = parts[0] + "-" + parts[1] + "-01";
	return formatdate(month_date, "MMM yyyy");
};

cg.subcolumn_label = function (type) {
	if (type === "plan") {
		return br.__("Plan");
	}
	if (type === "actual") {
		return br.__("Fact");
	}
	if (type === "forecast") {
		return br.__("Forecast");
	}
	if (type === "display") {
		return br.__("Fact");
	}
	return type;
};

cg.period_role_label = function (col) {
	var role = col.period_role;
	if (!role || role === "display") {
		role = (col.fieldname || "").split("_")[0];
	}
	return cg.subcolumn_label(role);
};

cg.get_column_dom_offset = function () {
	var report = frappe.query_report;
	if (!report || !report.datatable || !report.datatable.datamanager) {
		return 0;
	}
	return cint(report.datatable.datamanager.getStandardColumnCount()) || 0;
};

cg.apply_grouped_headers = function () {
	var report = frappe.query_report;
	var columns = (report && report.columns ? report.columns : []).filter(function (col) {
		return !col.hidden;
	});
	var $wrapper = report && report.$report ? report.$report : $();
	var $header = $wrapper.find(".dt-header .dt-row-header").first();

	if (!$header.length) {
		$header = $wrapper.find(".dt-row-header").first();
	}

	if (!$header.length || !columns.length) {
		return;
	}

	var domOffset = cg.get_column_dom_offset();

	$wrapper.find(".budget-period-group-row").remove();

	var $groupRow = $('<div class="dt-row dt-row-header budget-period-group-row"></div>');
	var index = 0;

	while (index < columns.length) {
		var col = columns[index];
		var parsed = cg.parse_period_fieldname(col.fieldname);
		var domIndex = index + domOffset;
		var $headerCell = $header.find(".dt-cell--col-" + domIndex).first();
		var cellWidth = $headerCell.outerWidth() || parseInt(col.width, 10) || 80;

		if (!parsed) {
			var spacerClasses = "dt-cell budget-report-header-cell budget-period-group-spacer";
			if (index === 0) {
				spacerClasses += " budget-sticky-first-column";
			}

			$groupRow.append(
				$('<div class="' + spacerClasses + '"></div>').css({
					width: cellWidth,
					minWidth: cellWidth,
					flex: "0 0 " + cellWidth + "px",
				})
			);
			index++;
			continue;
		}

		var groupStart = index;
		var groupCols = [];
		while (index < columns.length) {
			var nextCol = columns[index];
			var nextParsed = cg.parse_period_fieldname(nextCol.fieldname);
			if (!nextParsed || nextParsed.period_key !== parsed.period_key) {
				break;
			}
			groupCols.push(nextCol);
			index++;
		}

		var groupWidth = 0;
		groupCols.forEach(function (groupCol, groupIndex) {
			var colIndex = groupStart + groupIndex + domOffset;
			var $colCell = $header.find(".dt-cell--col-" + colIndex).first();
			groupWidth += $colCell.outerWidth() || parseInt(groupCol.width, 10) || 76;
			$colCell.find(".dt-cell__content").text(cg.period_role_label(groupCol));
		});

		$groupRow.append(
			$('<div class="dt-cell budget-report-header-cell budget-period-group-cell"></div>')
				.attr("data-colspan", groupCols.length)
				.css({
					width: groupWidth,
					minWidth: groupWidth,
					flex: "0 0 " + groupWidth + "px",
				})
				.append(
					$('<div class="dt-cell__content budget-period-group-label"></div>').text(
						col.period_group_label || cg.format_period_label(parsed.period_key)
					)
				)
		);
	}

	$header.before($groupRow);
	cg.apply_period_boundary_classes(columns, report);
};

	cg.apply_period_boundary_classes = function (columns, report) {
	if (!report || !report.$report || !columns || !columns.length) {
		return;
	}

	var domOffset = cg.get_column_dom_offset();
	var boundaries = cg.get_period_boundary_dom_indices(columns, domOffset);

	report.$report.find(".budget-period-boundary").removeClass("budget-period-boundary");

	boundaries.forEach(function (domIndex) {
		cg.mark_body_period_boundary(report, domIndex);
	});
};

cg.mark_body_period_boundary = function (report, domIndex) {
	if (!report || !report.$report || domIndex == null) {
		return;
	}

	var selector =
		".dt-scrollable .dt-row:not(.dt-row-header):not(.budget-period-group-row) .dt-cell--col-" +
		domIndex +
		", .dt-scrollable .dt-row:not(.dt-row-header):not(.budget-period-group-row) .dt-cell[data-col-index=\"" +
		domIndex +
		"\"]" +
		", .dt-row-totalRow .dt-cell--col-" +
		domIndex +
		", .dt-row-totalRow .dt-cell[data-col-index=\"" +
		domIndex +
		"\"]";

	report.$report.find(selector).addClass("budget-period-boundary");
};

cg.get_period_boundary_dom_indices = function (columns, domOffset) {
	var boundaries = [];
	var previous_period_key = null;

	columns.forEach(function (col, index) {
		var parsed = cg.parse_period_fieldname(col.fieldname);
		if (!parsed) {
			previous_period_key = null;
			return;
		}

		if (previous_period_key !== null && previous_period_key !== parsed.period_key) {
			boundaries.push(index + domOffset);
		}
		previous_period_key = parsed.period_key;
	});

	for (var i = 0; i < columns.length; i++) {
		if ((columns[i].fieldname || "").indexOf("total_") === 0) {
			boundaries.push(i + domOffset);
			break;
		}
	}

	return boundaries;
};
