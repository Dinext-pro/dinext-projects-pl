# Copyright (c) 2026, Dinext and Contributors
# See license.txt

import json

import frappe
from frappe.model.workflow import apply_workflow
from frappe.tests.utils import FrappeTestCase
from frappe.utils import getdate

from dinext_projects_pl.dinext_projects_pl.budget_approval.bootstrap import (
    ACTION_APPROVE,
    BUDGET_MONTHLY_AMOUNTS_FIELD,
    BUDGET_WORKFLOW_NAME,
    STATE_CANCELLED_APPROVED,
    STATE_CANCELLED_DRAFT,
    STATE_PENDING_APPROVAL,
)
from dinext_projects_pl.dinext_projects_pl.budget_approval.service import (
    find_approved_budget_for_period,
    save_budget_plan_for_approval,
)


class TestProjectBudget(FrappeTestCase):
    PLAN_APPROVAL_SITE_CONFIG_KEY = "dinext_projects_pl_enable_plan_approval"

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        if not frappe.db.exists("Workflow", BUDGET_WORKFLOW_NAME):
            raise AssertionError("Dinext Budget Approval workflow fixture must be installed for tests")
        cls.company = "_Test Company"
        cls.expense_account = cls._get_expense_account(cls.company)

    def setUp(self):
        self.project = self._make_project()
        self.task = self._make_task(self.project.name)

    def tearDown(self):
        frappe.set_user("Administrator")
        self._cleanup_project_data(self.project.name)

    def test_save_plan_creates_pending_budget_and_monthly_distribution(self):
        period_a = self._current_period()
        period_b = self._next_period(period_a)

        response = save_budget_plan_for_approval(
            self.project.name,
            [
                {
                    "account": self.expense_account,
                    "dimensions": [{"doc": "Task", "docname": self.task.name}],
                    "amounts": [
                        {"year": period_a.year, "month": period_a.month, "plan_value": 100},
                        {"year": period_b.year, "month": period_b.month, "plan_value": 200},
                    ],
                }
            ],
        )

        self.assertEqual(response["mode"], "approval")
        self.assertEqual(response["created_count"], 1)
        self.assertEqual(response["cancelled_pending_count"], 0)

        budget = frappe.get_doc("Budget", response["budgets"][0]["budget"])
        self.assertEqual(budget.workflow_state, STATE_PENDING_APPROVAL)
        self.assertEqual(budget.docstatus, 0)
        self.assertEqual(budget.budget_against, "Task")
        self.assertEqual(budget.task, self.task.name)
        self.assertEqual(budget.project, self.project.name)
        self.assertEqual(budget.accounts[0].account, self.expense_account)
        self.assertEqual(budget.accounts[0].budget_amount, 300)
        self.assertTrue(budget.monthly_distribution)

        distribution = frappe.get_doc("Monthly Distribution", budget.monthly_distribution)
        allocations = {row.month: row.percentage_allocation for row in distribution.percentages}
        self.assertAlmostEqual(sum(allocations.values()), 100.0, places=2)
        self.assertGreater(allocations[getdate(f"{period_a.year}-{period_a.month:02d}-01").strftime("%B")], 0)
        self.assertGreater(allocations[getdate(f"{period_b.year}-{period_b.month:02d}-01").strftime("%B")], 0)

        self.assertFalse(
            frappe.db.exists(
                "Project Budget",
                {"pb_project": self.project.name, "pb_account": self.expense_account},
            )
        )

    def test_resave_replaces_pending_budget_without_duplicate_error(self):
        period = self._current_period()

        first = save_budget_plan_for_approval(
            self.project.name,
            [
                {
                    "account": self.expense_account,
                    "dimensions": [{"doc": "Task", "docname": self.task.name}],
                    "amounts": [{"year": period.year, "month": period.month, "plan_value": 150}],
                }
            ],
        )
        second = save_budget_plan_for_approval(
            self.project.name,
            [
                {
                    "account": self.expense_account,
                    "dimensions": [{"doc": "Task", "docname": self.task.name}],
                    "amounts": [{"year": period.year, "month": period.month, "plan_value": 250}],
                }
            ],
        )

        first_budget = frappe.get_doc("Budget", first["budgets"][0]["budget"])
        second_budget = frappe.get_doc("Budget", second["budgets"][0]["budget"])

        self.assertEqual(first_budget.workflow_state, STATE_CANCELLED_DRAFT)
        self.assertEqual(first_budget.docstatus, 0)
        self.assertEqual(second_budget.workflow_state, STATE_PENDING_APPROVAL)
        self.assertEqual(second_budget.docstatus, 0)
        self.assertEqual(second_budget.accounts[0].budget_amount, 250)

    def test_approve_budget_syncs_project_budget_and_replaces_previous_approved(self):
        period = self._current_period()

        first = save_budget_plan_for_approval(
            self.project.name,
            [
                {
                    "account": self.expense_account,
                    "dimensions": [],
                    "amounts": [{"year": period.year, "month": period.month, "plan_value": 300}],
                }
            ],
        )
        approved_budget = frappe.get_doc("Budget", first["budgets"][0]["budget"])
        approved_budget = apply_workflow(approved_budget, ACTION_APPROVE)

        project_budget = self._get_project_budget([])
        self.assertEqual(project_budget.project_budget_amount[0].pba_plan, 300)

        second = save_budget_plan_for_approval(
            self.project.name,
            [
                {
                    "account": self.expense_account,
                    "dimensions": [],
                    "amounts": [{"year": period.year, "month": period.month, "plan_value": 450}],
                }
            ],
        )
        replacement_budget = frappe.get_doc("Budget", second["budgets"][0]["budget"])
        replacement_budget = apply_workflow(replacement_budget, ACTION_APPROVE)

        approved_budget.reload()
        replacement_budget.reload()
        project_budget.reload()

        self.assertEqual(approved_budget.workflow_state, STATE_CANCELLED_APPROVED)
        self.assertEqual(approved_budget.docstatus, 2)
        self.assertEqual(replacement_budget.docstatus, 1)
        self.assertEqual(project_budget.project_budget_amount[0].pba_plan, 450)
        self.assertEqual(
            find_approved_budget_for_period(
                self.project.name,
                self.expense_account,
                period.year,
                period.month,
                [],
            ),
            replacement_budget.name,
        )

    def test_approve_budget_uses_exact_monthly_amounts_and_keeps_forecast(self):
        period_a = self._current_period()
        period_b = self._next_period(period_a)
        dimensions = [{"doc": "Task", "docname": self.task.name}]
        forecast_amounts = {
            (period_a.year, period_a.month): 1700000,
            (period_b.year, period_b.month): 200000,
        }
        source_plan_amounts = {
            (period_a.year, period_a.month): 1699929,
            (period_b.year, period_b.month): 200071,
        }

        self._seed_project_budget_forecast(dimensions, forecast_amounts)

        response = save_budget_plan_for_approval(
            self.project.name,
            [
                {
                    "account": self.expense_account,
                    "dimensions": dimensions,
                    "amounts": [
                        {"year": period_a.year, "month": period_a.month, "plan_value": 1699929},
                        {"year": period_b.year, "month": period_b.month, "plan_value": 200071},
                    ],
                }
            ],
        )

        budget = frappe.get_doc("Budget", response["budgets"][0]["budget"])
        budget = apply_workflow(budget, ACTION_APPROVE)
        budget.reload()

        stored_monthly_amounts = budget.get(BUDGET_MONTHLY_AMOUNTS_FIELD)
        if isinstance(stored_monthly_amounts, str):
            stored_monthly_amounts = json.loads(stored_monthly_amounts)
        self.assertEqual(
            stored_monthly_amounts,
            {
                f"{period_a.year}-{period_a.month:02d}": "1699929.00",
                f"{period_b.year}-{period_b.month:02d}": "200071.00",
            },
        )

        project_budget = self._get_project_budget(dimensions)
        actual_plan_amounts = {
            (row.pba_year, row.pba_month): row.pba_plan
            for row in project_budget.project_budget_amount
            if (row.pba_year, row.pba_month) in source_plan_amounts
        }
        actual_forecast_amounts = {
            (row.pba_year, row.pba_month): row.pba_expected
            for row in project_budget.project_budget_amount
            if (row.pba_year, row.pba_month) in forecast_amounts
        }

        self.assertEqual(actual_plan_amounts, source_plan_amounts)
        self.assertEqual(actual_forecast_amounts, forecast_amounts)

    def test_save_plan_directly_updates_project_budget_when_approval_disabled(self):
        period = self._current_period()
        next_period = self._next_period(period)
        dimensions = [{"doc": "Task", "docname": self.task.name}]
        forecast_amounts = {
            (period.year, period.month): 1200,
            (next_period.year, next_period.month): 1800,
        }
        self._seed_project_budget_forecast(dimensions, forecast_amounts)

        old_config_value = getattr(frappe.conf, self.PLAN_APPROVAL_SITE_CONFIG_KEY, None)
        had_config_value = hasattr(frappe.conf, self.PLAN_APPROVAL_SITE_CONFIG_KEY)
        setattr(frappe.conf, self.PLAN_APPROVAL_SITE_CONFIG_KEY, 0)

        try:
            first_response = save_budget_plan_for_approval(
                self.project.name,
                [
                    {
                        "account": self.expense_account,
                        "dimensions": dimensions,
                        "amounts": [
                            {"year": period.year, "month": period.month, "plan_value": 300},
                            {"year": next_period.year, "month": next_period.month, "plan_value": 450},
                        ],
                    }
                ],
            )

            second_response = save_budget_plan_for_approval(
                self.project.name,
                [
                    {
                        "account": self.expense_account,
                        "dimensions": dimensions,
                        "amounts": [
                            {"year": period.year, "month": period.month, "plan_value": 700},
                        ],
                    }
                ],
            )
        finally:
            if had_config_value:
                setattr(frappe.conf, self.PLAN_APPROVAL_SITE_CONFIG_KEY, old_config_value)
            else:
                delattr(frappe.conf, self.PLAN_APPROVAL_SITE_CONFIG_KEY)

        self.assertEqual(first_response["mode"], "direct")
        self.assertEqual(first_response["created_count"], 1)
        self.assertEqual(first_response["cancelled_pending_count"], 0)
        self.assertEqual(second_response["mode"], "direct")
        self.assertEqual(second_response["created_count"], 1)
        self.assertEqual(second_response["cancelled_pending_count"], 0)

        self.assertEqual(
            frappe.get_all("Budget", filters={"project": self.project.name}, pluck="name"),
            [],
        )

        project_budget = self._get_project_budget(dimensions)
        actual_plan_amounts = {
            (row.pba_year, row.pba_month): row.pba_plan
            for row in project_budget.project_budget_amount
            if (row.pba_year, row.pba_month) in forecast_amounts
        }
        actual_forecast_amounts = {
            (row.pba_year, row.pba_month): row.pba_expected
            for row in project_budget.project_budget_amount
            if (row.pba_year, row.pba_month) in forecast_amounts
        }

        self.assertEqual(
            actual_plan_amounts,
            {
                (period.year, period.month): 700,
                (next_period.year, next_period.month): 450,
            },
        )
        self.assertEqual(actual_forecast_amounts, forecast_amounts)

    @classmethod
    def _make_project(cls):
        project = frappe.get_doc(
            {
                "doctype": "Project",
                "name": f"TEST-BUDGET-PROJ-{frappe.generate_hash(length=6)}",
                "project_name": f"Budget Approval {frappe.generate_hash(length=6)}",
                "company": cls.company,
            }
        )
        project.insert(ignore_permissions=True, ignore_mandatory=True)
        return project

    @classmethod
    def _make_task(cls, project_name):
        task = frappe.get_doc(
            {
                "doctype": "Task",
                "subject": f"Budget Approval Task {frappe.generate_hash(length=6)}",
                "project": project_name,
            }
        )
        task.insert(ignore_permissions=True)
        return task

    @staticmethod
    def _get_expense_account(company):
        account = frappe.db.get_value(
            "Account",
            {"company": company, "is_group": 0, "report_type": "Profit and Loss", "root_type": "Expense"},
            "name",
        )
        if not account:
            raise AssertionError("No expense Profit and Loss account found for test company")
        return account

    @staticmethod
    def _cleanup_project_data(project_name):
        budget_names = frappe.get_all("Budget", filters={"project": project_name}, fields=["name"])
        for row in budget_names:
            budget = frappe.get_doc("Budget", row.name)
            if budget.docstatus == 1 and budget.workflow_state == STATE_CANCELLED_APPROVED:
                pass
            elif budget.docstatus == 1:
                budget = apply_workflow(budget, "Cancel")
            elif budget.docstatus == 0 and budget.workflow_state in {"Draft", STATE_PENDING_APPROVAL}:
                budget = apply_workflow(budget, "Cancel")

            distribution_name = budget.monthly_distribution
            if frappe.db.exists("Budget", budget.name):
                frappe.delete_doc("Budget", budget.name, ignore_permissions=True, force=1)
            if distribution_name and frappe.db.exists("Monthly Distribution", distribution_name):
                frappe.delete_doc("Monthly Distribution", distribution_name, ignore_permissions=True, force=1)

        project_budget_names = frappe.get_all(
            "Project Budget",
            filters={"pb_project": project_name},
            fields=["name"],
        )
        for row in project_budget_names:
            frappe.delete_doc("Project Budget", row.name, ignore_permissions=True, force=1)

        task_names = frappe.get_all("Task", filters={"project": project_name}, fields=["name"])
        for row in task_names:
            frappe.delete_doc("Task", row.name, ignore_permissions=True, force=1)

        if frappe.db.exists("Project", project_name):
            frappe.delete_doc("Project", project_name, ignore_permissions=True, force=1)

    def _get_project_budget(self, dimensions):
        project_budgets = frappe.get_all(
            "Project Budget",
            filters={"pb_project": self.project.name, "pb_account": self.expense_account},
            fields=["name"],
        )
        target = sorted(f"{d.get('doc')}:{d.get('docname')}" for d in dimensions)
        for row in project_budgets:
            doc = frappe.get_doc("Project Budget", row.name)
            current = sorted(
                f"{d.doc}:{d.docname}" for d in (doc.project_budget_dimension or []) if d.doc and d.docname
            )
            if current == target:
                return doc
        raise AssertionError("Matching Project Budget not found")

    def _seed_project_budget_forecast(self, dimensions, forecast_amounts):
        project_budget = frappe.new_doc("Project Budget")
        project_budget.pb_project = self.project.name
        project_budget.pb_account = self.expense_account
        for dimension in dimensions:
            project_budget.append("project_budget_dimension", dimension)
        for (year, month), amount in sorted(forecast_amounts.items()):
            project_budget.append(
                "project_budget_amount",
                {
                    "pba_year": year,
                    "pba_month": month,
                    "pba_expected": amount,
                },
            )
        project_budget.save(ignore_permissions=True)
        return project_budget

    def _current_period(self):
        today = getdate()
        return frappe._dict(year=today.year, month=today.month)

    def _next_period(self, period):
        month = period.month + 1
        year = period.year
        if month > 12:
            month = 1
            year += 1
        return frappe._dict(year=year, month=month)
