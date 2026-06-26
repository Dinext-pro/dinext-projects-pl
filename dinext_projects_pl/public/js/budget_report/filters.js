frappe.provide("dinext_projects_pl.budget_plan_vs_forecast");

var br = dinext_projects_pl.budget_plan_vs_forecast;

br.ru_fallback_translations = {
	"Account": "Счет",
	"Accumulated Values": "Накопленные значения",
	"Apply Cost Center Allocation": "Применять распределение МВЗ",
	"Business Area": "Бизнес-сфера",
	"Company": "Компания",
	"Controls": "Управление",
	"Cost Center": "МВЗ",
	"Disabled": "отключена",
	"Deviation": "Отклонение",
	"Enable Drill Down": "Включить детализацию",
	"Enabled": "включена",
	"Exp and Fact": "Прогноз и факт",
	"Exp Only": "Только прогноз",
	"Fact": "Факт",
	"Fact Only": "Только факт",
	"Forecast": "Прогноз",
	"From Period": "Период с",
	"Gross Profit": "Валовая прибыль",
	"Month": "Месяц",
	"Period Granularity": "Детализация периода",
	"Plan": "План",
	"pp": "п.п.",
	"Profitability": "Рентабельность",
	"Profitability (%)": "Рентабельность (%)",
	"Project": "Проект",
	"Project Budget Plan vs Forecast": "План-Факт-Прогноз Бюджета",
	"Project Portfolio": "Портфель проекта",
	"Show Future Fact": "Показывать будущий факт",
	"Show Plan": "Показывать план",
	"Show Zero Columns": "Показывать нулевые колонки",
	"Show Zero Rows": "Показывать нулевые строки",
	"Total Expense": "Всего расходов",
	"Total Income": "Суммарный доход",
	"Net Profit": "Чистая прибыль",
	"To Period": "Период по",
	"To view GL entries, select Fact Only and disable Show Plan.": "Для просмотра проводок выберите режим «Только факт» и отключите «Показывать план».",
	"Quarter": "Квартал",
	"Toggle Drill Down": "Переключить детализацию",
	"Toggle Plan": "Переключить план",
	"Total Fact": "Итого факт",
	"Total Forecast": "Итого прогноз",
	"Total Forecast/Fact": "Итого прогноз/факт",
	"Total Plan": "Итого план",
	"View Type": "Режим отображения",
	"Year": "Год",
};

br.__ = function (text) {
	var translated = __(text);
	if (translated !== text) {
		return translated;
	}
	return br.ru_fallback_translations[text] || text;
};

function budget_report_link_options(doctype, txt, extra_filters) {
	var company = frappe.query_report.get_filter_value("company");
	var filters = Object.assign({ company: company }, extra_filters || {});
	return frappe.db.get_link_options(doctype, txt, filters);
}

dinext_projects_pl.budget_plan_vs_forecast.filters = [
	{
		fieldname: "project",
		label: br.__("Project"),
		fieldtype: "MultiSelectList",
		get_data: function (txt) {
			return budget_report_link_options("Project", txt);
		},
		options: "Project",
	},
	{
		fieldname: "project_portfolio",
		label: br.__("Project Portfolio"),
		fieldtype: "MultiSelectList",
		get_data: function (txt) {
			return frappe.db.get_link_options("Project Portfolio", txt);
		},
		options: "Project Portfolio",
	},
	{
		fieldname: "cost_center",
		label: br.__("Cost Center"),
		fieldtype: "MultiSelectList",
		get_data: function (txt) {
			return budget_report_link_options("Cost Center", txt);
		},
		options: "Cost Center",
	},
	{
		fieldname: "business_area",
		label: br.__("Business Area"),
		fieldtype: "MultiSelectList",
		get_data: function (txt) {
			return frappe.db.get_link_options("Business Area", txt);
		},
		options: "Business Area",
	},
	{
		fieldname: "company",
		label: br.__("Company"),
		fieldtype: "Link",
		options: "Company",
		default: frappe.defaults.get_user_default("Company"),
		reqd: 1,
	},
	{
		fieldname: "from_period",
		label: br.__("From Period"),
		fieldtype: "Date",
		default: frappe.datetime.year_start(),
		reqd: 1,
		options: {
			minView: "months",
			view: "months",
		},
	},
	{
		fieldname: "to_period",
		label: br.__("To Period"),
		fieldtype: "Date",
		default: frappe.datetime.year_end(),
		reqd: 1,
		options: {
			minView: "months",
			view: "months",
		},
	},
	{
		fieldname: "period_granularity",
		label: br.__("Period Granularity"),
		fieldtype: "Select",
		options: [
			{ value: "month", label: br.__("Month") },
			{ value: "quarter", label: br.__("Quarter") },
			{ value: "year", label: br.__("Year") },
		],
		default: "month",
	},
	{
		fieldname: "show_plan",
		label: br.__("Show Plan"),
		fieldtype: "Check",
		default: 1,
	},
	{
		fieldname: "view_type",
		label: br.__("View Type"),
		fieldtype: "Select",
		options: [
			{ value: "forecast_actual", label: br.__("Exp and Fact") },
			{ value: "forecast_only", label: br.__("Exp Only") },
			{ value: "actual_only", label: br.__("Fact Only") },
		],
		default: "forecast_actual",
	},
	{
		fieldname: "show_zero_columns",
		label: br.__("Show Zero Columns"),
		fieldtype: "Check",
		default: 1,
	},
	{
		fieldname: "show_zero_rows",
		label: br.__("Show Zero Rows"),
		fieldtype: "Check",
		default: 0,
	},
	{
		fieldname: "accumulated_values",
		label: br.__("Accumulated Values"),
		fieldtype: "Check",
		default: 0,
	},
	{
		fieldname: "enable_drill_down",
		label: br.__("Enable Drill Down"),
		fieldtype: "Check",
		default: 0,
		hidden: 1,
	},
	{
		fieldname: "include_future_actual",
		label: br.__("Show Future Fact"),
		fieldtype: "Check",
		default: 0,
	},
	{
		fieldname: "apply_cc_allocation",
		label: br.__("Apply Cost Center Allocation"),
		fieldtype: "Check",
		default: 1,
	},
];

var MONTH_PERIOD_PICKER_OPTIONS = {
	minView: "months",
	view: "months",
	dateFormat: "mm-yyyy",
};

var YEAR_PERIOD_PICKER_OPTIONS = {
	minView: "years",
	view: "years",
	dateFormat: "yyyy",
};

var MONTH_PERIOD_DISPLAY_FORMAT = "MM-YYYY";
var YEAR_PERIOD_DISPLAY_FORMAT = "YYYY";
var MONTH_PERIOD_INPUT_FORMATS = ["MM-YYYY", "MM-YY", "M-YYYY", "M-YY"];
var YEAR_PERIOD_INPUT_FORMATS = ["YYYY", "YY"];

br.get_period_granularity = function (report) {
	if (report && report.get_filter_value) {
		return report.get_filter_value("period_granularity") || "month";
	}
	var filters = frappe.query_report && frappe.query_report.get_filter_values();
	return (filters && filters.period_granularity) || "month";
};

br.is_year_only_period_granularity = function (report) {
	var granularity = br.get_period_granularity(report);
	return granularity === "quarter" || granularity === "year";
};

function budget_report_format_month_period(value) {
	if (!value) {
		return "";
	}
	var date_obj = moment(value, frappe.defaultDateFormat, true);
	if (!date_obj.isValid()) {
		date_obj = moment(value);
	}
	return date_obj.isValid() ? date_obj.format(MONTH_PERIOD_DISPLAY_FORMAT) : "";
}

function budget_report_parse_month_period(value) {
	if (!value) {
		return "";
	}

	var month_value = moment(value, MONTH_PERIOD_INPUT_FORMATS, true);
	if (month_value.isValid()) {
		return month_value.startOf("month").format(frappe.defaultDateFormat);
	}

	return frappe.datetime.user_to_str(value, false, true);
}

function budget_report_format_year_period(value) {
	if (!value) {
		return "";
	}
	var date_obj = moment(value, frappe.defaultDateFormat, true);
	if (!date_obj.isValid()) {
		date_obj = moment(value, YEAR_PERIOD_INPUT_FORMATS, true);
	}
	return date_obj.isValid() ? date_obj.format(YEAR_PERIOD_DISPLAY_FORMAT) : "";
}

function budget_report_parse_year_period(value, is_end) {
	if (!value) {
		return "";
	}

	var year_value = moment(value, YEAR_PERIOD_INPUT_FORMATS, true);
	if (year_value.isValid()) {
		return year_value
			.month(is_end ? 11 : 0)
			.startOf("month")
			.format(frappe.defaultDateFormat);
	}

	var parsed = frappe.datetime.user_to_str(value, false, true);
	if (!parsed) {
		return "";
	}

	var date_obj = moment(parsed, frappe.defaultDateFormat, true);
	if (!date_obj.isValid()) {
		return parsed;
	}

	return date_obj
		.month(is_end ? 11 : 0)
		.startOf("month")
		.format(frappe.defaultDateFormat);
}

function budget_report_format_period_input(value, is_year_only) {
	return is_year_only
		? budget_report_format_year_period(value)
		: budget_report_format_month_period(value);
}

function budget_report_parse_period_input(value, is_year_only, is_end) {
	return is_year_only
		? budget_report_parse_year_period(value, is_end)
		: budget_report_parse_month_period(value);
}

function budget_report_get_period_picker_options(is_year_only) {
	return is_year_only ? YEAR_PERIOD_PICKER_OPTIONS : MONTH_PERIOD_PICKER_OPTIONS;
}

dinext_projects_pl.budget_plan_vs_forecast.setup_period_month_pickers = function (report) {
	var is_year_only = br.is_year_only_period_granularity(report);
	var picker_options = budget_report_get_period_picker_options(is_year_only);

	["from_period", "to_period"].forEach(function (fieldname) {
		var control = report.get_filter(fieldname);
		if (!control) {
			return;
		}

		var is_end = fieldname === "to_period";

		if (!control._budget_month_period_patched) {
			control._budget_month_period_patched = true;

			control.format_for_input = function (value) {
				return budget_report_format_period_input(
					value,
					br.is_year_only_period_granularity(report)
				);
			};

			control.parse = function (value) {
				return budget_report_parse_period_input(
					value,
					br.is_year_only_period_granularity(report),
					this.df.fieldname === "to_period"
				);
			};

			control.validate = function (value) {
				if (!value || value === "Invalid date") {
					return "";
				}
				var year_only = br.is_year_only_period_granularity(report);
				var input_formats = year_only ? YEAR_PERIOD_INPUT_FORMATS : MONTH_PERIOD_INPUT_FORMATS;
				if (moment(value, input_formats, true).isValid()) {
					return value;
				}
				return frappe.ui.form.ControlDate.prototype.validate.call(this, value);
			};

			control.set_formatted_input = function (value) {
				if (value === "Today") {
					value = this.get_now_date();
				}
				if (!value) {
					if (this.$input) {
						this.$input.val("");
					}
					if (this.datepicker) {
						this.datepicker.clear();
					}
					this.last_value = "";
					return;
				}
				if (value === "Invalid date") {
					return;
				}

				var year_only = br.is_year_only_period_granularity(report);
				var input_formats = year_only ? YEAR_PERIOD_INPUT_FORMATS : MONTH_PERIOD_INPUT_FORMATS;
				var system_value = value;
				if (moment(value, input_formats, true).isValid()) {
					system_value = budget_report_parse_period_input(
						value,
						year_only,
						this.df.fieldname === "to_period"
					);
				}

				var display_value = budget_report_format_period_input(system_value, year_only);
				if (this.$input) {
					if (this.$input.val() !== display_value) {
						this.$input.val(display_value);
					}
				}
				this.last_value = system_value;
			};
		}

		if (control.datepicker) {
			control.datepicker.update(picker_options);
		}

		var current_value = control.get_value();
		if (current_value) {
			control.set_formatted_input(current_value);
		} else if (is_year_only) {
			control.set_value(
				is_end ? frappe.datetime.year_end() : frappe.datetime.year_start()
			);
		}
	});
};

br.setup_period_granularity_handler = function (report) {
	if (!report || report._budget_period_granularity_handler_installed) {
		return;
	}
	report._budget_period_granularity_handler_installed = true;

	var granularity_filter = report.get_filter("period_granularity");
	if (!granularity_filter || !granularity_filter.$input) {
		return;
	}

	granularity_filter.$input.on("change", function () {
		br.setup_period_month_pickers(report);
	});
};

var BUDGET_REPORT_WIDE_FILTER_FIELDS = [
	"project",
	"project_portfolio",
	"cost_center",
	"business_area",
];

dinext_projects_pl.budget_plan_vs_forecast.setup_filter_layout = function (report) {
	br.apply_report_translations(report);

	var $page = report.page.wrapper.closest("#page-query-report");
	$page.addClass("budget-plan-vs-forecast-page");

	var $form = report.page.page_form && report.page.page_form.length
		? report.page.page_form
		: report.page.wrapper.find(".page-form");

	$form.addClass("budget-report-filters-form");

	$form.children(".form-group, .frappe-control").each(function () {
		var $field = $(this);
		var fieldtype = $field.attr("data-fieldtype");
		var fieldname = $field.attr("data-fieldname");

		$field.removeClass(
			"col-md-1 col-md-2 col-md-3 col-md-4 col-md-5 col-md-6 input-max-width"
		);

		if (BUDGET_REPORT_WIDE_FILTER_FIELDS.indexOf(fieldname) !== -1) {
			$field.addClass("budget-report-filter-wide");
		} else if (fieldtype === "Check") {
			$field.addClass("budget-report-filter-check");
		} else if (fieldname === "company") {
			$field.addClass("budget-report-filter-company");
		} else if (fieldname === "from_period" || fieldname === "to_period") {
			$field.addClass("budget-report-filter-period");
		} else if (fieldname === "period_granularity") {
			$field.addClass("budget-report-filter-select");
		} else if (fieldtype === "Select") {
			$field.addClass("budget-report-filter-select");
		}
	});

	setTimeout(function () {
		br.apply_report_translations(report);
		br.render_budget_summary(report);
	}, 0);
};

br.apply_table_header_translations = function () {
	var report = frappe.query_report;
	if (!report || !report.$report) {
		return;
	}

	report.$report.find(".dt-header .dt-cell__content").each(function () {
		var $el = $(this);
		var text = $el.text().trim();
		if (!text) {
			return;
		}
		var translated = br.__(text);
		if (translated !== text) {
			$el.text(translated);
		}
	});
};

br.fix_table_horizontal_layout = function () {
	var report = frappe.query_report;
	if (!report || !report.$report) {
		return;
	}

	var $scrollable = report.$report.find(".dt-scrollable").first();
	if (!$scrollable.length) {
		return;
	}

	var scrollWidth = $scrollable[0].offsetWidth - $scrollable[0].clientWidth;
	var $rows = report.$report.find(".dt-row-header, .budget-period-group-row, .dt-row-totalRow");

	if (scrollWidth <= 0) {
		$rows.css("padding-right", 0);
		return;
	}

	$rows.css("padding-right", scrollWidth + "px");
};

br.apply_report_translations = function (report) {
	if (!report) {
		return;
	}

	var report_title = br.__("Project Budget Plan vs Forecast");
	if (report.page && report.page.set_title) {
		report.page.set_title(report_title);
	}
	document.title = report_title;

	(report.filters || []).forEach(function (filter) {
		var df = filter && filter.df;
		if (!df || !df.label) {
			return;
		}
		df.label = br.__(df.label);
		if (filter.refresh_label) {
			filter.refresh_label();
		}
	});

	var $form = report.page && report.page.page_form && report.page.page_form.length
		? report.page.page_form
		: report.page.wrapper.find(".page-form");

	Object.keys(br.ru_fallback_translations).forEach(function (source) {
		$form.find(".label-area").each(function () {
			var $label = $(this);
			if ($label.text().trim() === source) {
				$label.text(br.__(source));
			}
		});
	});

	var view_type_filter = report.get_filter && report.get_filter("view_type");
	var view_type_options = {
		forecast_actual: br.__("Exp and Fact"),
		forecast_only: br.__("Exp Only"),
		actual_only: br.__("Fact Only"),
	};

	var granularity_filter = report.get_filter && report.get_filter("period_granularity");
	var granularity_options = {
		month: br.__("Month"),
		quarter: br.__("Quarter"),
		year: br.__("Year"),
	};

	if (view_type_filter && view_type_filter.$input) {
		view_type_filter.$input.find("option").each(function () {
			var $option = $(this);
			var value = $option.attr("value");
			if (view_type_options[value]) {
				$option.text(view_type_options[value]);
			}
		});
	}

	if (granularity_filter && granularity_filter.$input) {
		granularity_filter.$input.find("option").each(function () {
			var $option = $(this);
			var value = $option.attr("value");
			if (granularity_options[value]) {
				$option.text(granularity_options[value]);
			}
		});
	}
};

br.get_filter_values_for_url = function (report) {
	var values = Object.assign({}, report.get_filter_values());

	(report.filters || []).forEach(function (f) {
		if (!f.df || f.df.fieldtype !== "Check") {
			return;
		}

		var fieldname = f.df.fieldname;
		var value = cint(f.df.hidden ? f.value : f.get_value());
		var default_value = cint(f.df.default);

		if (value !== default_value) {
			values[fieldname] = value;
			return;
		}

		if (!value) {
			delete values[fieldname];
		}
	});

	return values;
};

br.setup_url_filter_persistence = function (report) {
	if (!report || report._budget_url_filter_persistence_installed) {
		return;
	}
	report._budget_url_filter_persistence_installed = true;

	report.get_url_with_filters = function () {
		var query_params = new URLSearchParams();
		if (this.prepared_report_name) {
			query_params.append("prepared_report_name", this.prepared_report_name);
		} else {
			Object.entries(br.get_filter_values_for_url(this)).forEach(function (entry) {
				var field = entry[0];
				var value = entry[1];
				if (Array.isArray(value)) {
					if (!value.length) {
						return;
					}
					value = JSON.stringify(value);
				}
				query_params.append(field, value);
			});
		}

		var full_url = window.location.href.replace(window.location.search, "");
		if (query_params.toString()) {
			full_url += "?" + query_params.toString();
		}
		return full_url;
	};
};
