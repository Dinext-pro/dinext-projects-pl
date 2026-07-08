(function () {
    const MONTHLY_DISTRIBUTION_FIELD = "monthly_distribution";
    const EXACT_MONTHLY_AMOUNTS_FIELD = "dinext_budget_monthly_amounts";
    const MONTHLY_AMOUNTS_CSS = "/assets/dinext_projects_pl/css/budget_monthly_amounts.css";
    const MONTHLY_AMOUNTS_SELECTOR = ".dinext-budget-monthly-amounts";

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

        refresh(frm) {
            render_monthly_amounts(frm);
        },

        monthly_distribution(frm) {
            render_monthly_amounts(frm);
        },

        dinext_budget_monthly_amounts(frm) {
            render_monthly_amounts(frm);
        },
    });

    function render_monthly_amounts(frm) {
        const field = frm.get_field(MONTHLY_DISTRIBUTION_FIELD);
        if (!field || !field.$wrapper) {
            return;
        }

        const rows = parse_monthly_amounts(frm.doc[EXACT_MONTHLY_AMOUNTS_FIELD]);
        const $field_wrapper = field.$wrapper;
        const $field_value_area = get_field_value_area(field);

        $field_wrapper.find(MONTHLY_AMOUNTS_SELECTOR).remove();

        if (!rows.length) {
            $field_value_area.show();
            return;
        }

        load_monthly_amounts_css();
        $field_value_area.hide();

        const $table = build_monthly_amounts_table(rows);
        if ($field_value_area.length) {
            $table.insertAfter($field_value_area.last());
        } else {
            $field_wrapper.append($table);
        }
    }

    function get_field_value_area(field) {
        return field.$wrapper.find(".control-input, .control-value");
    }

    function parse_monthly_amounts(raw_value) {
        const monthly_amounts = parse_json_value(raw_value);
        if (!monthly_amounts || Array.isArray(monthly_amounts) || typeof monthly_amounts !== "object") {
            return [];
        }

        return Object.keys(monthly_amounts)
            .map(function (period) {
                const match = /^(\d{4})-(\d{2})$/.exec(period);
                if (!match) {
                    return null;
                }

                const year = Number.parseInt(match[1], 10);
                const month = Number.parseInt(match[2], 10);
                if (month < 1 || month > 12) {
                    return null;
                }

                const amount = to_number(monthly_amounts[period]);
                if (!Number.isFinite(amount)) {
                    return null;
                }

                return {
                    period,
                    year,
                    month,
                    amount,
                };
            })
            .filter(Boolean)
            .sort(function (left, right) {
                if (left.year !== right.year) {
                    return left.year - right.year;
                }
                return left.month - right.month;
            });
    }

    function parse_json_value(raw_value) {
        if (!raw_value) {
            return null;
        }

        if (typeof raw_value === "string") {
            const trimmed_value = raw_value.trim();
            if (!trimmed_value) {
                return null;
            }

            try {
                return JSON.parse(trimmed_value);
            } catch (error) {
                void error;
                return null;
            }
        }

        return raw_value;
    }

    function build_monthly_amounts_table(rows) {
        const total = rows.reduce(function (sum, row) {
            return sum + row.amount;
        }, 0);

        const $container = $('<div class="dinext-budget-monthly-amounts"></div>');
        $('<div class="dinext-budget-monthly-amounts__title"></div>')
            .text(__("Exact Monthly Amounts"))
            .appendTo($container);

        const $table = $('<table class="table table-bordered dinext-budget-monthly-amounts__table"></table>');
        const $thead = $("<thead></thead>").appendTo($table);
        const $header_row = $("<tr></tr>").appendTo($thead);
        $('<th scope="col"></th>').text(__("Month")).appendTo($header_row);
        $('<th scope="col" class="text-right"></th>').text(__("Amount")).appendTo($header_row);

        const $tbody = $("<tbody></tbody>").appendTo($table);
        rows.forEach(function (row) {
            const $row = $("<tr></tr>").appendTo($tbody);
            $("<td></td>").text(row.period).appendTo($row);
            $('<td class="text-right"></td>').text(format_amount(row.amount)).appendTo($row);
        });

        const $tfoot = $("<tfoot></tfoot>").appendTo($table);
        const $total_row = $("<tr></tr>").appendTo($tfoot);
        $("<th></th>").text(__("Total")).appendTo($total_row);
        $('<th class="text-right"></th>').text(format_amount(total)).appendTo($total_row);

        $table.appendTo($container);
        return $container;
    }

    function format_amount(amount) {
        if (frappe.format) {
            return html_to_text(frappe.format(amount, { fieldtype: "Currency" }));
        }

        return amount.toFixed(2);
    }

    function html_to_text(value) {
        return $("<div></div>").html(value || "").text();
    }

    function to_number(value) {
        if (value === null || value === undefined || value === "") {
            return NaN;
        }

        const value_as_number = Number(value);
        return Number.isFinite(value_as_number) ? value_as_number : NaN;
    }

    function load_monthly_amounts_css() {
        if (frappe.require) {
            frappe.require([MONTHLY_AMOUNTS_CSS]);
        }
    }
})();
