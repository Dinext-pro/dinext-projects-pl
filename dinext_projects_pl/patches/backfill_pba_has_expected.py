import frappe


def execute():
	"""Mark existing non-zero pba_expected as explicit own forecast."""
	if not frappe.db.has_column("Project Budget Amount", "pba_has_expected"):
		return
	frappe.db.sql(
		"""
		UPDATE `tabProject Budget Amount`
		SET pba_has_expected = 1
		WHERE IFNULL(pba_expected, 0) != 0
		"""
	)
