app_name = "dinext_projects_pl"
app_title = "Dinext Projects Pl"
app_publisher = "Dinext"
app_description = "Dinext Projects P&L"
app_email = "info@dinext.ru"
app_license = "mit"

fixtures = [
    {
        "doctype": "Accounting Dimension",
        "filters": [
            ["disabled", "=", 0]
        ]
    },
    {
        "doctype": "Custom Field",
        "filters": [
            ["module", "in", ["Dinext Projects Pl"]]
        ]
    },
    {
        "doctype": "Client Script",
        "filters": [
            ["module", "in", ["Dinext Projects Pl"]],
            ["enabled", "=", 1]
        ]
    },
    {
        "doctype": "Server Script",
        "filters": [
            ["module", "in", ["Dinext Projects Pl"]],
            ["disabled", "=", 0]
        ]
    },
    {
        "doctype": "Role",
        "filters": [
            ["name", "in", ["Dinext_Budget_Approver"]],
            ["disabled", "=", 0],
        ]
    },
    {
        "doctype": "Workflow",
        "filters": [
            ["name", "in", ["Dinext Budget Approval"]],
        ]
    },
    {
        "doctype": "Workflow State",
        "filters": [
            ["workflow_state_name", "in", ["Draft", "Pending Approval", "Approved", "Cancelled Draft", "Cancelled Approved"]],
        ]
    },
    {
        "doctype": "Workflow Action Master",
        "filters": [
            ["workflow_action_name", "in", ["Submit for Approval", "Approve", "Cancel"]],
        ]
    }
]

# Apps
# ------------------

# required_apps = []

# Each item in the list will be shown as an app in the apps page
# add_to_apps_screen = [
# 	{
# 		"name": "dinext_projects_pl",
# 		"logo": "/assets/dinext_projects_pl/logo.png",
# 		"title": "Dinext Projects Pl",
# 		"route": "/dinext_projects_pl",
# 		"has_permission": "dinext_projects_pl.api.permission.has_app_permission"
# 	}
# ]

# Includes in <head>
# ------------------

# include js, css files in header of desk.html
# app_include_css = "/assets/dinext_projects_pl/css/dinext_projects_pl.css"
# app_include_js: budget_report JS files are loaded lazily in the report JS
# via frappe.require() — only when the user opens the report, not on every page.

# include js, css files in header of web template
# web_include_css = "/assets/dinext_projects_pl/css/dinext_projects_pl.css"
# web_include_js = "/assets/dinext_projects_pl/js/dinext_projects_pl.js"

# include custom scss in every website theme (without file extension ".scss")
# website_theme_scss = "dinext_projects_pl/public/scss/website"

# include js, css files in header of web form
# webform_include_js = {"doctype": "public/js/doctype.js"}
# webform_include_css = {"doctype": "public/css/doctype.css"}

# include js in page
# page_js = {"page" : "public/js/file.js"}

# include js in doctype views
doctype_js = {"Project":
    [
        "public/js/project_budget_navigation.js",
        "public/js/project_budget/boot.js",
        "public/js/project_budget_tab.js",
        "public/js/project_budget_chart.js",
        "public/js/project_budget_metrics.js",
        "public/js/project_budget_dashboard.js",
    ]
}

doctype_css = {
	"Project": [
		"public/css/project_budget.css",
	],
}
# doctype_js = {"doctype" : "public/js/doctype.js"}
# doctype_list_js = {"doctype" : "public/js/doctype_list.js"}
# doctype_tree_js = {"doctype" : "public/js/doctype_tree.js"}
# doctype_calendar_js = {"doctype" : "public/js/doctype_calendar.js"}

# Svg Icons
# ------------------
# include app icons in desk
# app_include_icons = "dinext_projects_pl/public/icons.svg"

# Home Pages
# ----------

# application home page (will override Website Settings)
# home_page = "login"

# website user home page (by Role)
# role_home_page = {
# 	"Role": "home_page"
# }

# Generators
# ----------

# automatically create page for each record of this doctype
# website_generators = ["Web Page"]

# Jinja
# ----------

# add methods and filters to jinja environment
# jinja = {
# 	"methods": "dinext_projects_pl.utils.jinja_methods",
# 	"filters": "dinext_projects_pl.utils.jinja_filters"
# }

# Installation
# ------------

# before_install = "dinext_projects_pl.install.before_install"

# Uninstallation
# ------------

# before_uninstall = "dinext_projects_pl.uninstall.before_uninstall"
# after_uninstall = "dinext_projects_pl.uninstall.after_uninstall"

# Integration Setup
# ------------------
# To set up dependencies/integrations with other apps
# Name of the app being installed is passed as an argument

# before_app_install = "dinext_projects_pl.utils.before_app_install"
# after_app_install = "dinext_projects_pl.utils.after_app_install"

# Integration Cleanup
# -------------------
# To clean up dependencies/integrations with other apps
# Name of the app being uninstalled is passed as an argument

# before_app_uninstall = "dinext_projects_pl.utils.before_app_uninstall"
# after_app_uninstall = "dinext_projects_pl.utils.after_app_uninstall"

# Desk Notifications
# ------------------
# See frappe.core.notifications.get_notification_config

# notification_config = "dinext_projects_pl.notifications.get_notification_config"

# Permissions
# -----------
# Permissions evaluated in scripted ways

# permission_query_conditions = {
# 	"Event": "frappe.desk.doctype.event.event.get_permission_query_conditions",
# }
#
# has_permission = {
# 	"Event": "frappe.desk.doctype.event.event.has_permission",
# }

# DocType Class
# ---------------
# Override standard doctype classes

override_doctype_class = {
    "Budget": "dinext_projects_pl.dinext_projects_pl.overrides.budget.Budget"
}

# Document Events
# ---------------
# Hook on document methods and events

doc_events = {
    "Budget": {
        "on_submit": "dinext_projects_pl.dinext_projects_pl.budget_approval.service.on_budget_submit",
        "on_cancel": "dinext_projects_pl.dinext_projects_pl.budget_approval.service.on_budget_cancel",
    }
}

# Scheduled Tasks
# ---------------

# scheduler_events = {
# 	"all": [
# 		"dinext_projects_pl.tasks.all"
# 	],
# 	"daily": [
# 		"dinext_projects_pl.tasks.daily"
# 	],
# 	"hourly": [
# 		"dinext_projects_pl.tasks.hourly"
# 	],
# 	"weekly": [
# 		"dinext_projects_pl.tasks.weekly"
# 	],
# 	"monthly": [
# 		"dinext_projects_pl.tasks.monthly"
# 	],
# }

# Testing
# -------

# Overriding Methods
# ------------------------------
#
# override_whitelisted_methods = {
# 	"frappe.desk.doctype.event.event.get_events": "dinext_projects_pl.event.get_events"
# }
#
# each overriding function accepts a `data` argument;
# generated from the base implementation of the doctype dashboard,
# along with any modifications made in other Frappe apps
# override_doctype_dashboards = {
# 	"Task": "dinext_projects_pl.task.get_dashboard_data"
# }

# exempt linked doctypes from being automatically cancelled
#
# auto_cancel_exempted_doctypes = ["Auto Repeat"]

# Ignore links to specified DocTypes when deleting documents
# -----------------------------------------------------------

# ignore_links_on_delete = ["Communication", "ToDo"]

# Request Events
# ----------------
# before_request = ["dinext_projects_pl.utils.before_request"]
# after_request = ["dinext_projects_pl.utils.after_request"]

# Job Events
# ----------
# before_job = ["dinext_projects_pl.utils.before_job"]
# after_job = ["dinext_projects_pl.utils.after_job"]

# User Data Protection
# --------------------

# user_data_fields = [
# 	{
# 		"doctype": "{doctype_1}",
# 		"filter_by": "{filter_by}",
# 		"redact_fields": ["{field_1}", "{field_2}"],
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_2}",
# 		"filter_by": "{filter_by}",
# 		"partial": 1,
# 	},
# 	{
# 		"doctype": "{doctype_3}",
# 		"strict": False,
# 	},
# 	{
# 		"doctype": "{doctype_4}"
# 	}
# ]

# Authentication and authorization
# --------------------------------

# auth_hooks = [
# 	"dinext_projects_pl.auth.validate"
# ]

# Automatically update python controller files with type annotations for this app.
# export_python_type_annotations = True

# default_log_clearing_doctypes = {
# 	"Logging DocType Name": 30  # days to retain logs
# }

# Translation
# ------------
# List of apps whose translatable strings should be excluded from this app's translations.
# ignore_translatable_strings_from = []

