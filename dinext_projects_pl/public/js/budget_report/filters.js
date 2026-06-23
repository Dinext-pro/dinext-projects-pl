frappe.provide("dinext_projects_pl.budget_plan_vs_forecast");

var br = dinext_projects_pl.budget_plan_vs_forecast;

br.ru_fallback_translations = {
	"Accumulated Values": "Накопленные значения",
	"Apply Cost Center Allocation": "Применять распределение МВЗ",
	"Business Area": "Бизнес-сфера",
	"Company": "Компания",
	"Controls": "Управление",
	"Cost Center": "МВЗ",
	"Disabled": "отключена",
	"Enable Drill Down": "Включить детализацию",
	"Enabled": "включена",
	"Exp and Fact": "Прогноз и факт",
	"Exp Only": "Только прогноз",
	"Fact Only": "Только факт",
	"From Period": "Период с",
	"Gross Profit": "Валовая прибыль",
	"Profitability": "Рентабельность",
	"Profitability (%)": "Рентабельность (%)",
	"Project": "Проект",
	"Project Budget Plan vs Forecast": "План-Факт-Прогноз Бюджета",
	"Project Portfolio": "Портфель проекта",
	"Show Future Fact": "Показывать будущий факт",
	"Show Plan": "Показывать план",
	"Show Zero Columns": "Показывать нулевые колонки",
	"Show Zero Rows": "Показывать нулевые строки",
	"To Period": "Период по",
	"Toggle Drill Down": "Переключить детализацию",
	"Toggle Plan": "Переключить план",
	"View Type": "Режим отображения",
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

var MONTH_PERIOD_DISPLAY_FORMAT = "MM-YYYY";
var MONTH_PERIOD_INPUT_FORMATS = ["MM-YYYY", "MM-YY", "M-YYYY", "M-YY"];

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

dinext_projects_pl.budget_plan_vs_forecast.setup_period_month_pickers = function (report) {
	["from_period", "to_period"].forEach(function (fieldname) {
		var control = report.get_filter(fieldname);
		if (!control) {
			return;
		}

		if (!control._budget_month_period_patched) {
			control._budget_month_period_patched = true;

			control.format_for_input = function (value) {
				return budget_report_format_month_period(value);
			};

			control.parse = function (value) {
				return budget_report_parse_month_period(value);
			};

			control.validate = function (value) {
				if (!value || value === "Invalid date") {
					return "";
				}
				if (moment(value, MONTH_PERIOD_INPUT_FORMATS, true).isValid()) {
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

				var system_value = value;
				if (moment(value, MONTH_PERIOD_INPUT_FORMATS, true).isValid()) {
					system_value = budget_report_parse_month_period(value);
				}

				var display_value = budget_report_format_month_period(system_value);
				if (this.$input) {
					if (this.$input.val() !== display_value) {
						this.$input.val(display_value);
					}
				}
				this.last_value = system_value;
			};
		}

		if (control.datepicker) {
			control.datepicker.update(MONTH_PERIOD_PICKER_OPTIONS);
		}

		var current_value = control.get_value();
		if (current_value) {
			control.set_formatted_input(current_value);
		}
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

	BUDGET_REPORT_WIDE_FILTER_FIELDS.forEach(function (fieldname) {
		var $field = $form.children('[data-fieldname="' + fieldname + '"]');
		if (!$field.length) {
			$field = $form.find('> .form-group[data-fieldname="' + fieldname + '"]');
		}
		if (!$field.length) {
			return;
		}

		$field
			.removeClass("col-md-1 col-md-2 col-md-3 col-md-4 input-max-width")
			.addClass("budget-report-filter-wide")
			.css({
				width: "260px",
				"min-width": "260px",
				"max-width": "320px",
				flex: "0 0 260px",
				float: "none",
			});

		$field.find("> .multiselect-list, .multiselect-list").first().css({
			width: "100%",
			"min-width": "100%",
		});

		$field.find(".multiselect-list .form-control").css({
			width: "100%",
			"min-width": "100%",
		});
	});

	$form.children('[data-fieldname="company"]').css({
		width: "180px",
		"min-width": "180px",
		flex: "0 0 180px",
		float: "none",
	});

	$form.children('[data-fieldname="from_period"], [data-fieldname="to_period"]').each(function () {
		$(this).css({
			width: "110px",
			"min-width": "110px",
			flex: "0 0 110px",
			float: "none",
		});
	});

	setTimeout(function () {
		br.apply_report_translations(report);
	}, 0);
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

	if (view_type_filter && view_type_filter.$input) {
		view_type_filter.$input.find("option").each(function () {
			var $option = $(this);
			var value = $option.attr("value");
			if (view_type_options[value]) {
				$option.text(view_type_options[value]);
			}
		});
	}
};
