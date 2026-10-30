# Copyright (c) 2026, Dinext and contributors
# For license information, please see license.txt

import frappe
from frappe import _
from frappe.model.document import Document

from dinext_projects_pl.liquidity.settings import compile_policy


class PaymentCalendarSettings(Document):
	def validate(self):
		try:
			compile_policy(self)
		except ValueError as exc:
			frappe.throw(_(str(exc)))
