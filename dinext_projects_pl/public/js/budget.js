frappe.ui.form.on("Budget", {
    onload(frm) {
        frm.set_query("account", "accounts", function () {
            return {
                filters: {
                    company: frm.doc.company,
                    report_type: "Profit and Loss",
                    custom_not_plan_exp: 0,
                },
            };
        });
    },
});
