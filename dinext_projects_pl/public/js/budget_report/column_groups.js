frappe.provide("dinext_projects_pl.budget_plan_vs_forecast.column_groups");

var cg = dinext_projects_pl.budget_plan_vs_forecast.column_groups;
var br = dinext_projects_pl.budget_plan_vs_forecast;

br.column_groups = cg;

cg.TOTAL_GROUP_KEY = "total";

cg.get_column_fieldname = function (col) {
	return (col && (col.fieldname || col.id)) || "";
};

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
		return br.__("Forecast/Fact");
	}
	return type;
};

cg.period_role_label = function (col) {
	var fieldname = cg.get_column_fieldname(col);
	if (fieldname.indexOf("total_") === 0) {
		return cg.total_column_role_label(col);
	}
	var role = col.period_role;
	if (!role || role === "display") {
		role = fieldname.split("_")[0];
	}
	return cg.subcolumn_label(role);
};

cg.total_column_role_label = function (col) {
	var fieldname = cg.get_column_fieldname(col);
	if (fieldname === "total_plan") {
		return cg.subcolumn_label("plan");
	}
	if (fieldname === "total_fct") {
		return cg.subcolumn_label("actual");
	}
	if (fieldname === "total_exp") {
		return cg.subcolumn_label("forecast");
	}
	if (fieldname === "total_exp_fct") {
		return cg.subcolumn_label("display");
	}
	if (col.period_role) {
		return cg.subcolumn_label(col.period_role);
	}
	var label = br.__(col.label || "");
	return label
		.replace(/^Итого\s+/i, "")
		.replace(/^Total\s+/i, "")
		.trim();
};

cg.enrich_column_group_metadata = function (col) {
	if (!col) {
		return col;
	}

	var fieldname = cg.get_column_fieldname(col);
	if (!fieldname || fieldname.indexOf("total_") !== 0) {
		return col;
	}

	var enriched = Object.assign({}, col);
	if (!enriched.period_group) {
		enriched.period_group = cg.TOTAL_GROUP_KEY;
	}
	if (!enriched.period_group_label) {
		enriched.period_group_label = "Total";
	}

	var role_by_fieldname = {
		total_plan: "plan",
		total_fct: "display",
		total_exp: "forecast",
		total_exp_fct: "display",
	};
	if (!enriched.period_role && role_by_fieldname[fieldname]) {
		enriched.period_role = role_by_fieldname[fieldname];
	}

	return enriched;
};

cg.get_column_group_key = function (col) {
	if (col && col.period_group) {
		return col.period_group;
	}
	var fieldname = cg.get_column_fieldname(col);
	if (fieldname.indexOf("total_") === 0) {
		return cg.TOTAL_GROUP_KEY;
	}
	var parsed = cg.parse_period_fieldname(fieldname);
	return parsed ? parsed.period_key : null;
};

cg.get_column_group_label = function (col, groupKey) {
	if (col && col.period_group_label) {
		return br.__(col.period_group_label);
	}
	if (groupKey === cg.TOTAL_GROUP_KEY) {
		return br.__("Total");
	}
	return cg.format_period_label(groupKey);
};

cg.is_current_period_group = function (groupKey) {
	if (!groupKey || groupKey === cg.TOTAL_GROUP_KEY) {
		return false;
	}
	if (!frappe.datetime || !frappe.datetime.get_today || !frappe.datetime.str_to_obj) {
		return false;
	}

	var today = frappe.datetime.str_to_obj(frappe.datetime.get_today());
	var year = today.getFullYear();
	var month = today.getMonth() + 1;
	var parts = String(groupKey).split("_");

	if (parts.length === 1 && /^\d{4}$/.test(parts[0])) {
		return parseInt(parts[0], 10) === year;
	}

	if (parts.length === 2 && /^Q[1-4]$/i.test(parts[1])) {
		if (parseInt(parts[0], 10) !== year) {
			return false;
		}
		var quarter = parseInt(parts[1].slice(1), 10);
		var currentQuarter = Math.floor((month - 1) / 3) + 1;
		return quarter === currentQuarter;
	}

	if (parts.length === 2 && /^\d{2}$/.test(parts[1])) {
		return parseInt(parts[0], 10) === year && parseInt(parts[1], 10) === month;
	}

	return false;
};

cg.get_column_dom_offset = function () {
	var report = frappe.query_report;
	if (!report || !report.datatable || !report.datatable.datamanager) {
		return 0;
	}
	return cint(report.datatable.datamanager.getStandardColumnCount()) || 0;
};

cg.get_report_columns_with_groups = function (report) {
	var source_columns = br.get_budget_report_columns
		? br.get_budget_report_columns(report)
		: [];
	var visible_columns = (report && report.columns ? report.columns : []).filter(function (col) {
		return !col.hidden;
	});

	if (!visible_columns.length) {
		return [];
	}

	if (!source_columns.length) {
		return visible_columns;
	}

	var visible_fieldnames = {};
	visible_columns.forEach(function (col) {
		var fieldname = cg.get_column_fieldname(col);
		if (fieldname) {
			visible_fieldnames[fieldname] = true;
		}
	});

	var grouped_columns = source_columns.filter(function (col) {
		var fieldname = cg.get_column_fieldname(col);
		return fieldname && visible_fieldnames[fieldname];
	}).map(cg.enrich_column_group_metadata);

	if (grouped_columns.length) {
		return grouped_columns;
	}

	var metadata_by_field = {};
	source_columns.forEach(function (col) {
		var fieldname = cg.get_column_fieldname(col);
		if (fieldname) {
			metadata_by_field[fieldname] = cg.enrich_column_group_metadata(col);
		}
	});

	return visible_columns.map(function (col) {
		var fieldname = cg.get_column_fieldname(col);
		var meta = metadata_by_field[fieldname];
		if (!meta) {
			return cg.enrich_column_group_metadata(col);
		}
		return cg.enrich_column_group_metadata(Object.assign({}, meta, col));
	});
};

cg.schedule_budget_grouped_headers = function (report) {
	report = report || frappe.query_report;

	var apply = function () {
		if (!report || !report.$report || !report.$report.is(":visible")) {
			return;
		}
		if (br.is_budget_report_view && !br.is_budget_report_view(report)) {
			return;
		}

		cg.apply_grouped_headers();

		if (typeof br.apply_table_header_translations === "function") {
			br.apply_table_header_translations();
		}
		if (typeof br.fix_table_horizontal_layout === "function") {
			br.fix_table_horizontal_layout();
		}
	};

	apply();
	setTimeout(apply, 0);
	setTimeout(apply, 50);
	setTimeout(apply, 150);
	setTimeout(apply, 350);
	setTimeout(apply, 600);
	setTimeout(apply, 1000);
	setTimeout(apply, 1500);
};

cg.ensure_grouped_headers = function (report, attempt) {
	report = report || frappe.query_report;
	attempt = cint(attempt);

	if (!report || !report.$report) {
		return;
	}

	if (cg.apply_grouped_headers()) {
		if (typeof br.apply_table_header_translations === "function") {
			br.apply_table_header_translations();
		}
		if (typeof br.fix_table_horizontal_layout === "function") {
			br.fix_table_horizontal_layout();
		}
		return;
	}

	if (attempt >= 50) {
		return;
	}

	setTimeout(function () {
		cg.ensure_grouped_headers(report, attempt + 1);
	}, 100);
};

cg.apply_grouped_headers = function () {
	var report = frappe.query_report;
	var columns = cg.get_report_columns_with_groups(report);
	var $wrapper = report && report.$report ? report.$report : $();
	var $header = $wrapper.find(".dt-header .dt-row-header:not(.budget-period-group-row)").first();

	if (!$header.length) {
		$header = $wrapper.find(".dt-row-header:not(.budget-period-group-row)").first();
	}

	if (!$header.length || !columns.length) {
		return false;
	}

	var domOffset = cg.get_column_dom_offset();

	$wrapper.find(".budget-period-group-row").remove();

	var $groupRow = $('<div class="dt-row dt-row-header budget-period-group-row"></div>');
	var index = 0;

	while (index < columns.length) {
		var col = columns[index];
		var groupKey = cg.get_column_group_key(col);
		var domIndex = index + domOffset;
		var $headerCell = $header.find(".dt-cell--col-" + domIndex).first();
		var cellWidth = $headerCell.outerWidth() || parseInt(col.width, 10) || 80;

		if (!groupKey) {
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
			if (cg.get_column_group_key(nextCol) !== groupKey) {
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
			(function () {
				var groupCellClasses =
					"dt-cell budget-report-header-cell budget-period-group-cell";
				if (cg.is_current_period_group(groupKey)) {
					groupCellClasses += " budget-period-group-cell--current-period";
				}
				return $('<div class="' + groupCellClasses + '"></div>')
					.attr("data-colspan", groupCols.length)
					.css({
						width: groupWidth,
						minWidth: groupWidth,
						flex: "0 0 " + groupWidth + "px",
					})
					.append(
						$('<div class="dt-cell__content budget-period-group-label"></div>').text(
							cg.get_column_group_label(col, groupKey)
						)
					);
			})()
		);
	}

	$header.before($groupRow);
	cg.apply_period_boundary_classes(columns, report);

	return $groupRow.find(".budget-period-group-label").filter(function () {
		return $(this).text().trim();
	}).length > 0;
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
		var groupKey = cg.get_column_group_key(col);
		if (!groupKey || groupKey === cg.TOTAL_GROUP_KEY) {
			if (groupKey === cg.TOTAL_GROUP_KEY && previous_period_key !== null) {
				boundaries.push(index + domOffset);
			}
			previous_period_key = groupKey === cg.TOTAL_GROUP_KEY ? cg.TOTAL_GROUP_KEY : null;
			return;
		}

		if (previous_period_key !== null && previous_period_key !== groupKey) {
			boundaries.push(index + domOffset);
		}
		previous_period_key = groupKey;
	});

	for (var i = 0; i < columns.length; i++) {
		if (cg.get_column_fieldname(columns[i]).indexOf("total_") === 0) {
			boundaries.push(i + domOffset);
			break;
		}
	}

	return boundaries;
};
