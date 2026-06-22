frappe.provide("dinext_projects_pl.budget_plan_vs_forecast.column_groups");

var cg = dinext_projects_pl.budget_plan_vs_forecast.column_groups;
var br = dinext_projects_pl.budget_plan_vs_forecast;

br.column_groups = cg;

cg.parse_period_fieldname = function (fieldname) {
	var match = /^(plan|actual|forecast|delta)_(\d{4})_(\d{2})$/.exec(fieldname || "");
	if (!match) {
		return null;
	}
	return {
		type: match[1],
		year: cint(match[2]),
		month: cint(match[3]),
		period_key: match[2] + "_" + match[3],
	};
};

cg.format_period_label = function (period_key) {
	var parts = (period_key || "").split("_");
	if (parts.length !== 2) {
		return period_key;
	}
	var month_date = parts[0] + "-" + parts[1] + "-01";
	return formatdate(month_date, "MMM yyyy");
};

cg.subcolumn_label = function (type) {
	if (type === "plan") {
		return __("Plan");
	}
	if (type === "actual") {
		return __("Fact");
	}
	if (type === "forecast") {
		return __("Forecast");
	}
	if (type === "display") {
		return __("Fact");
	}
	if (type === "delta") {
		return "Δ";
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
};
