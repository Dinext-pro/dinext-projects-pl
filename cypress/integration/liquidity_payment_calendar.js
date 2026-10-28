const API = "dinext_projects_pl.liquidity.api.";
const testCase = (name, fn) => {
	const pattern = Cypress.env("liquidityTestPattern");
	if (!pattern || new RegExp(pattern).test(name)) it(name, fn);
};
const grid = "[data-testid=liquidity-grid]";

describe("Liquidity Payment Calendar", () => {
	let context;
	beforeEach(function () {
		const title = this.currentTest.title;
		const scenario = title.includes("UI-20") ? "pnl" : title.includes("zero rows") ? "zero" : (title.includes("UI-10") || title.includes("UI-11")) ? "standalone" : title.includes("UI-12") ? "request" : (title.includes("UI-14") || title.includes("BG-04")) ? "outward" : title.includes("without date") ? "undated" : title.includes("future request") ? "overdue_request" : title.includes("overdue") ? "overdue" : title.includes("pagination") || title.includes("UI-04") ? "many" : "base";
		return cy.seedLiquidity(scenario).then((data) => { context = data; });
	});
	after(() => {
		cy.login("operator");
		cy.visit("/app");
		cy.call("dinext_projects_pl.tests.liquidity_ui_helpers.cleanup");
	});

	testCase("BG-01 balances share the period columns without additive totals", () => {
		cy.openLiquidity(context);
		cy.get(".liquidity-balances").should("not.exist");
		cy.get(grid).contains("Начальный остаток").should("be.visible");
		cy.get(grid).contains("Конечный остаток").should("be.visible");
		cy.window().then((win) => {
			const view = win.frappe.query_report.__liquidityView;
			const rows = view.grid.summaryRowData;
			expect(rows.map((r) => r.id)).to.deep.eq(["balance-opening", "net", "balance-closing"]);
			for (const period of view.payload.balances.periods) {
				for (const [metric, prefix] of [["actual", "actual"], ["forecast", "projected"]]) {
					for (const [row, kind] of [[rows[0], "opening"], [rows[2], "closing"]]) {
						expect(row[period.key + "__" + metric]).to.eq(period[prefix + "_" + kind]);
					}
				}
			}
			const key = view.payload.periods[0].key;
			cy.get(grid + ` .liquidity-balance-row [col-id='${key}__actual']`).first().should("have.text", view.format(view.payload.balances.periods[0].actual_opening));
		});
		cy.get(grid + " .liquidity-balance-row [col-id$='__plan']").each(($cell) => expect($cell.text()).to.eq("—"));
		cy.liquidityScrollRight();
		for (const field of ["total__forecast", "undated__forecast"]) {
			cy.get(grid + ` .liquidity-balance-row [col-id='${field}']`).should("have.length", 2).each(($cell) => expect($cell.text()).to.eq("—"));
		}
	});

	testCase("BG-02 balance cells open the exact balance detail and blanks do not request", () => {
		cy.openLiquidity(context);
		cy.intercept("**/api/method/dinext_projects_pl.liquidity.api.get_cell_details*").as("balanceDetail");
		cy.get(grid + " .liquidity-balance-row [col-id$='__actual']").first().click();
		cy.wait("@balanceDetail").then(({ request, response }) => {
			expect(new URLSearchParams(request.body).get("metric")).to.eq("actual_opening");
			expect(response.statusCode).to.eq(200);
		});
		cy.get("[data-testid=liquidity-details]").should("be.visible");
		cy.get(".modal:visible").should(($modal) => expect($modal.data("bs.modal")._isTransitioning).to.eq(false));
		cy.get(".modal:visible .modal-header .btn-modal-close").click();
		cy.get(".modal:visible").should("not.exist");
		cy.get(grid + " .ag-floating-bottom-container .liquidity-balance-row").last().find("[col-id$='__forecast']").first().click();
		cy.wait("@balanceDetail").then(({ request, response }) => {
			expect(new URLSearchParams(request.body).get("metric")).to.eq("projected_closing");
			expect(response.statusCode).to.eq(200);
		});
		cy.get(".modal:visible").should(($modal) => expect($modal.data("bs.modal")._isTransitioning).to.eq(false));
		cy.get(".modal:visible .modal-header .btn-modal-close").click();
		cy.get(".modal:visible").should("not.exist");
		cy.get(grid + " .liquidity-balance-row [col-id$='__plan']").first().click();
		cy.get("@balanceDetail.all").should("have.length", 2);
		cy.get(".modal:visible").should("not.exist");
	});

	testCase("BG-03 balance rows follow visible metrics and period granularity", () => {
		cy.openLiquidity(context);
		cy.liquidityFilter("metrics", ["plan"]);
		cy.get(grid + " .liquidity-balance-row").should("not.exist");
		cy.liquidityFilter("metrics", ["forecast"]);
		for (const grain of ["day", "month", "week"]) {
			cy.liquidityFilter("grain", grain);
			cy.get(grid).contains("Конечный остаток").should("be.visible");
			cy.get(grid + " .liquidity-balance-row [col-id$='__actual']").should("not.exist");
		}
		cy.liquidityFilter("accounts", [context.bank_b]);
		cy.get(grid + " .liquidity-balance-row").should("not.exist");
		cy.liquidityFilter("metrics", ["actual"]);
		cy.get(grid).contains("Конечный остаток").should("be.visible");
	});

	testCase("BG-04 negative balances remain highlighted in Russian in both themes", () => {
		cy.openLiquidity(context);
		cy.liquidityFilter("grain", "month");
		for (const theme of ["dark", "light"]) {
			cy.window().then((win) => win.document.documentElement.setAttribute("data-theme", theme));
			cy.get(grid).scrollIntoView().contains("Конечный остаток").should("be.visible");
			cy.get(grid + " .liquidity-negative-balance").should("be.visible").and("contain", "-100,00");
			cy.get(grid + " .liquidity-negative-balance").first().scrollIntoView().should(($cell) => {
				expect($cell.css("color")).not.to.eq($cell.closest(".liquidity-calendar").css("color"));
			});
			cy.screenshot("liquidity-balances-" + theme, { capture: "viewport" });
		}
	});

	testCase("UI-01 opens the report with the default table, chart and filters", () => {
		cy.openLiquidity(context);
		cy.get("[data-testid=liquidity-chart] svg").should("be.visible");
		cy.get(grid).contains("Поступления").should("be.visible");
		cy.get("[data-fieldname=company] input").should("have.value", context.company);
	});
	for (const workspace of ["Аналитика", "Фин. Контроль"]) {
		testCase(`UI-01 opens the calendar from workspace ${workspace}`, () => {
			// The workspace also contains unrelated operational counters. Use the
			// administrator profile here; finance/project report permissions are
			// exercised separately without granting extra rights for the report.
			cy.login("operator"); cy.visit("/app");
			cy.window().then((win) => win.frappe.set_route("Workspaces", workspace));
			cy.get("a[href*='Liquidity']").filter(":visible").first().click();
			cy.get(grid + " .ag-root").should("be.visible");
			cy.get("[data-fieldname=company] input").should("have.value", context.company);
			cy.get("[data-testid=liquidity-chart] svg").should("be.visible");
			cy.window().then((win) => {
				const start = win.moment(context.from_date).isoWeekday(1);
				expect(win.frappe.query_report.get_filter_value("from_date")).to.eq(start.format("YYYY-MM-DD"));
				expect(win.frappe.query_report.get_filter_value("to_date")).to.eq(start.add(90, "days").format("YYYY-MM-DD"));
			});
		});
	}

	testCase("UI-02 expands seven levels and collapses without changing totals", () => {
		cy.openLiquidity(context);
		cy.get("[data-testid=liquidity-depth]").select("7");
		cy.get(grid).contains(context.payment).should("be.visible");
		cy.get(grid).contains(context.contract).should("be.visible");
		cy.get("[data-testid=liquidity-depth]").select("1");
		cy.get(grid).contains(context.payment).should("not.exist");
		cy.liquidityScrollRight();
		cy.get(grid + " [col-id='total__forecast']").should("exist");
	});

	testCase("UI-03 reorders project and counterparty keeping the contract level", () => {
		cy.openLiquidity(context);
		cy.liquidityFilter("grouping", "party_project");
		cy.get("[data-testid=liquidity-depth]").select("4");
		cy.get(grid).contains(context.contract).should("be.visible");
		cy.get(grid + " .ag-pinned-left-cols-container").contains("_Test Liquidity Customer").should("be.visible");
	});

	testCase("UI-05 changes day, week and month granularity", () => {
		cy.openLiquidity(context);
		for (const grain of ["day", "month", "week"]) {
			cy.liquidityFilter("grain", grain);
			cy.get("[data-testid=liquidity-chart] svg").should("be.visible");
			cy.get(grid).contains("Поступления").should("be.visible");
		}
	});

	testCase("UI-06 analytic filters hide company balances and reset restores them", () => {
		cy.openLiquidity(context);
		cy.get(grid + " .liquidity-balance-row").should("be.visible");
		cy.liquidityFilter("projects", [context.project]);
		cy.get(grid + " .liquidity-balance-row").should("not.exist");
		cy.liquidityFilter("projects", []);
		cy.get(grid + " .liquidity-balance-row").should("be.visible");
	});

	testCase("UI-06 selects a project from its visible dropdown and filters portfolio and party", () => {
		cy.openLiquidity(context);
		cy.get("[data-fieldname=projects] [data-toggle=dropdown]").click();
		cy.get("[data-fieldname=projects] .selectable-item").contains(context.project).click();
		cy.wait("@calendar");
		cy.get("[data-testid=liquidity-kpis]").click();
		cy.get(grid + " .liquidity-balance-row").should("not.exist");
		cy.liquidityFilter("projects", []);
		cy.liquidityFilter("portfolios", [context.portfolio]);
		cy.get("[data-testid=liquidity-kpis]").should("contain", "40,00");
		cy.liquidityFilter("portfolios", []);
		cy.liquidityFilter("party_type", "Customer");
		cy.get("[data-fieldname=parties] [data-toggle=dropdown]").click();
		cy.get("[data-fieldname=parties] .selectable-item").contains("_Test Liquidity Customer").click();
		cy.wait("@calendar");
		cy.get("[data-testid=liquidity-kpis]").click().should("contain", "40,00");
		cy.get(grid + " .liquidity-balance-row").should("not.exist");
	});

	testCase("UI-07 account selection filters actual only and hides projected balances", () => {
		cy.openLiquidity(context);
		cy.liquidityFilter("accounts", [context.bank_b]);
		cy.get(".liquidity-account-note").should("be.visible");
		cy.get(grid + " .liquidity-balance-row [col-id$='__forecast']").each(($cell) => expect($cell.text()).to.eq("—"));
		cy.get("[data-testid=liquidity-kpis]").should("contain", "40,00");
		cy.liquidityFilter("accounts", []);
		cy.get(grid + " .liquidity-balance-row [col-id$='__forecast']").first().should("not.have.text", "—");
	});

	testCase("UI-08 opens a cell's exact source documents", () => {
		cy.openLiquidity(context);
		cy.liquidityScrollRight();
		cy.get(grid + " .ag-center-cols-container [col-id='total__forecast']").first().click();
		cy.get("[data-testid=liquidity-details]").should("be.visible").and("contain", context.invoice);
		cy.get("[data-testid=liquidity-details] a").first().should("have.attr", "href").and("include", "sales-invoice/");
		cy.get("[data-testid=liquidity-details] a").first().click();
		cy.location("pathname").should("contain", "/sales-invoice/");
		cy.window().should((win) => expect(win.cur_frm?.doc?.name).to.eq(context.invoice));
	});

	testCase("UI-09 chart modes retain a rendered interactive chart", () => {
		cy.openLiquidity(context);
		for (const mode of ["plan", "forecast", "actual", "combined"]) {
			cy.get("[data-testid=liquidity-mode]").select(mode);
			cy.get("[data-testid=liquidity-chart] svg").should("be.visible");
		}
		cy.get("[data-testid=liquidity-chart] svg path[fill='#37a077']").then(($paths) => {
			const bar = [...$paths].find((el) => el.getBoundingClientRect().height > 20);
			expect(bar, "actual cash bar").to.exist;
			cy.wrap(bar).trigger("mousemove", "center");
			cy.get(".liquidity-chart-tooltip").should("be.visible").and("contain", "20,00");
			cy.wrap(bar).click();
		});
		cy.get("[data-testid=liquidity-details]").should("contain", context.payment);
	});

	testCase("UI-09 clicks a balance point and reconciles its opening anchor", () => {
		cy.openLiquidity(context);
		cy.get("[data-testid=liquidity-chart] svg path[stroke='#5683c4']").then(($paths) => {
			const points = [...$paths].filter((el) => { const box = el.getBoundingClientRect(); return box.width < 12 && box.height < 12; });
			expect(points.length, "visible balance symbols").to.be.greaterThan(1);
			cy.wrap(points.at(-1)).click();
		});
		cy.get("[data-testid=liquidity-details]").should("contain", context.invoice);
		cy.get(".modal:visible").should("contain", "20,00").and("contain", "60,00");
	});

	testCase("UI-15 a project manager sees permitted analytics without company balances", () => {
		cy.openLiquidity(context, {}, "manager");
		cy.get(grid + " .liquidity-balance-row").should("not.exist");
		cy.call(API + "get_calendar", { filters: { company: context.company } }).its("body.message.balances").should("eq", null);
	});

	testCase("UI-19 switches light and dark theme without reloading", () => {
		cy.openLiquidity(context);
		cy.viewport(1280, 720);
		cy.document().should((doc) => expect(doc.documentElement.scrollWidth).to.be.at.most(doc.documentElement.clientWidth));
		for (const theme of ["dark", "light"]) {
			cy.window().then((win) => win.document.documentElement.setAttribute("data-theme", theme));
			cy.get(grid + " .ag-root").should("be.visible");
			cy.get("[data-testid=liquidity-chart] svg").should("be.visible");
			cy.screenshot("liquidity-" + theme, { capture: "viewport" });
		}
		cy.viewport(1100, 850);
		cy.document().should((doc) => expect(doc.documentElement.scrollWidth).to.be.at.most(doc.documentElement.clientWidth));
		cy.get("[data-testid=liquidity-chart]").should("be.visible");
	});

	testCase("UI-04 scrolls a large tree with a pinned name column and switches metrics", () => {
		cy.openLiquidity(context);
		cy.get("[data-testid=liquidity-depth]").select("5");
		cy.get(grid + " .ag-body-viewport").scrollTo("bottom", { ensureScrollable: false });
		cy.liquidityScrollRight();
		cy.get(grid + " .ag-pinned-left-cols-container").should("be.visible");
		cy.get(grid + " [col-id='undated__forecast']").should("be.visible");
		cy.liquidityFilter("metrics", ["forecast"]);
		cy.get(grid + " [col-id$='__plan']").should("not.exist");
		cy.get(grid + " [col-id$='__forecast']").should("exist");
	});

	testCase("UI-04 explicitly shows zero rows outside the completed payment period", () => {
		cy.openLiquidity(context);
		cy.window().then((win) => {
			const tomorrow = win.moment(context.from_date).add(1, "day").format("YYYY-MM-DD");
			return win.frappe.query_report.set_filter_value("from_date", tomorrow);
		});
		cy.wait("@calendar");
		cy.get("[data-testid=liquidity-empty]").should("be.visible");
		cy.get("[data-fieldname=show_zero] .input-area input[type=checkbox]").check();
		cy.wait("@calendar");
		cy.get(grid).contains("Поступления").should("be.visible");
		cy.get("[data-testid=liquidity-kpis]").should("contain", "0,00");
	});

	testCase("UI-08 pagination keeps the exact total and source links", () => {
		cy.openLiquidity(context);
		cy.liquidityScrollRight();
		cy.get(grid + " .ag-center-cols-container [col-id='total__plan']").first().click();
		cy.get("[data-testid=liquidity-details] tbody tr").should("have.length", 50);
		cy.get(".modal:visible").contains("button", "Далее").click();
		cy.get("[data-testid=liquidity-details] tbody tr").should("have.length", 6);
		cy.get("[data-testid=liquidity-details] a").first().click();
		cy.location("pathname").should("include", "/app/sales-order/");
		cy.get(".form-layout").should("be.visible");
	});

	testCase("UI-10 standalone request becomes forecast 70 and actual 30 after payment", () => {
		cy.openLiquidity(context, {}, "operator");
		cy.get("[data-testid=liquidity-kpis]").should("contain", "100,00");
		cy.get("[data-testid=liquidity-depth]").select("7");
		cy.get(grid).contains("Без инвойса").should("be.visible");
		cy.get(grid).contains(context.request).should("be.visible");
		cy.call("dinext_projects_pl.tests.liquidity_ui_helpers.pay_standalone", { request_name: context.request });
		cy.window().then((win) => win.frappe.query_report.refresh());
		cy.wait("@calendar");
		cy.get("[data-testid=liquidity-kpis]").should("contain", "70,00");
		cy.get(grid + " .ag-center-cols-container [col-id$='__actual']").first().should("contain", "30,00");
	});

	testCase("UI-12 request transaction_date moves its forecast slice on refresh", () => {
		cy.openLiquidity(context, {}, "operator");
		cy.call("dinext_projects_pl.tests.liquidity_ui_helpers.move_request", { request_name: context.request, days: 35 });
		cy.window().then((win) => win.frappe.query_report.refresh());
		cy.wait("@calendar");
		cy.get("[data-testid=liquidity-kpis]").should("contain", "80,00");
		cy.liquidityScrollRight();
		cy.get(grid + " .ag-center-cols-container [col-id='total__forecast']").first().click();
		cy.get("[data-testid=liquidity-details]").should("contain", context.request);
		cy.window().then((win) => {
			const date = win.moment(context.from_date).add(35, "days").format("YYYY-MM-DD");
			cy.get("[data-testid=liquidity-details]").should("contain", date);
		});
	});

	testCase("UI-11 partial then full explicit invoice coverage keeps forecast 100", () => {
		cy.openLiquidity(context, {}, "operator");
		cy.get("[data-testid=liquidity-kpis]").should("contain", "100,00");
		cy.call("dinext_projects_pl.tests.liquidity_ui_helpers.cover_request", { request_name: context.request, amount: 60 });
		cy.window().then((win) => win.frappe.query_report.refresh());
		cy.wait("@calendar");
		cy.get("[data-testid=liquidity-calendar]").should("have.attr", "aria-busy", "false");
		cy.liquidityScrollRight();
		cy.get(grid + " .ag-center-cols-container [col-id='total__forecast']").first().click();
		cy.get("[data-testid=liquidity-details] tbody tr").should("have.length", 2);
		cy.get("[data-testid=liquidity-details]").should("contain", "60,00").and("contain", "40,00");
		cy.call("dinext_projects_pl.tests.liquidity_ui_helpers.cover_request", { request_name: context.request, amount: 40 });
		cy.window().then((win) => win.frappe.query_report.refresh());
		cy.wait("@calendar");
		cy.get("[data-testid=liquidity-calendar]").should("have.attr", "aria-busy", "false");
		cy.get("[data-testid=liquidity-kpis]").should("contain", "100,00");
		cy.liquidityScrollRight();
		cy.get(grid + " .ag-center-cols-container [col-id='total__forecast']").first().click();
		cy.get("[data-testid=liquidity-details] tbody tr td:first-child").should("have.length", 2).each(($cell) => cy.wrap($cell).should("contain", "Sales Invoice"));
	});

	testCase("UI-13 overdue dates remain visible while cash is expected today", () => {
		cy.openLiquidity(context);
		cy.get(grid + " .liquidity-overdue").first().click();
		cy.get("[data-testid=liquidity-details]").should("contain", context.from_date);
		cy.window().then((win) => {
			cy.get("[data-testid=liquidity-details]").should("contain", win.moment(context.from_date).subtract(7, "days").format("YYYY-MM-DD"));
		});
	});

	testCase("UI-13 future request keeps the overdue contractual date in details", () => {
		cy.openLiquidity(context);
		cy.liquidityScrollRight();
		cy.get(grid + " .ag-center-cols-container [col-id='total__forecast']").first().click();
		cy.get("[data-testid=liquidity-details]").should("contain", context.request).and("contain", "40,00");
		cy.window().then((win) => {
			cy.get("[data-testid=liquidity-details]")
				.should("contain", win.moment(context.from_date).subtract(7, "days").format("YYYY-MM-DD"))
				.and("contain", win.moment(context.from_date).add(21, "days").format("YYYY-MM-DD"));
		});
	});

	testCase("UI-13 obligations without date stay outside projected balance", () => {
		cy.openLiquidity(context);
		cy.get("[data-testid=liquidity-kpis]").should("contain", "20,00");
		cy.liquidityScrollRight();
		cy.get(grid + " .ag-center-cols-container [col-id='undated__forecast']").first().should("contain", "40,00").click();
		cy.get("[data-testid=liquidity-details]").should("contain", "Без даты");
	});

	for (const via of ["entry", "journal"]) {
		testCase(`UI-14 executes Payment Order through ${via} without duplicate forecast`, () => {
			cy.openLiquidity(context, {}, "operator");
			cy.get("[data-testid=liquidity-kpis]").should("contain", "100,00");
			cy.call("dinext_projects_pl.tests.liquidity_ui_helpers.execute_order", { order_name: context.payment_order, via });
			cy.window().then((win) => win.frappe.query_report.refresh());
			cy.wait("@calendar");
			cy.get("[data-testid=liquidity-kpis]").should("contain", "70,00");
			cy.get("[data-testid=liquidity-depth]").select("7");
			cy.get(grid).contains(context.payment_order).should("be.visible");
		});
	}

	testCase("UI-16 downloads a complete XLSX while the tree remains collapsed", () => {
		cy.openLiquidity(context);
		cy.get(grid).contains(context.invoice).should("not.exist");
		cy.get("[data-testid=liquidity-export]").click();
		cy.readFile("cypress/downloads/liquidity-payment-calendar.xlsx", "binary").should("have.length.greaterThan", 1000);
		cy.task("readLiquidityWorkbook").then((book) => {
			expect(book.numeric).to.be.greaterThan(10);
			expect(book.rows.map((row) => row[0])).to.include(context.contract).and.include(context.invoice).and.include(context.payment);
			expect(book.sheets).to.eq(4);
		});
	});

	testCase("UI-17 ignores an older delayed filter response", () => {
		cy.openLiquidity(context);
		cy.intercept("**/api/method/" + API + "get_calendar*", (req) => {
			const filters = JSON.parse(new URLSearchParams(req.body).get("filters"));
			if (filters.direction === "out") req.continue((res) => res.setDelay(1800));
		}).as("raced");
		cy.get("[data-fieldname=direction] select").select("out").select("in");
		cy.wait("@raced"); cy.wait("@raced");
		cy.get(grid).contains("Поступления").should("be.visible");
		cy.get("[data-testid=liquidity-kpis]").should("contain", "40,00");
	});

	testCase("UI-18 distinguishes a failed request from an empty result and retries", () => {
		cy.openLiquidity(context);
		Cypress.env("liquidityExpectedConsole", ["Liquidity injected failure"]);
		cy.intercept({ url: "**/api/method/" + API + "get_calendar*", times: 1 }, {
			statusCode: 500, body: { exception: "Liquidity injected failure", exc_type: "ValidationError" },
		}).as("failedCalendar");
		cy.window().then((win) => win.frappe.query_report.refresh());
		cy.wait("@failedCalendar");
		cy.get("[data-testid=liquidity-error]").should("be.visible");
		cy.get(grid + " .ag-root").should("not.exist");
		cy.get("[data-testid=liquidity-calendar]").should("have.attr", "aria-busy", "false");
		cy.get("body").then(($body) => { if ($body.find(".modal:visible .btn-modal-close").length) cy.get(".modal:visible .btn-modal-close").click(); });
		cy.window().then((win) => {
			// Retry is a framework translation (wording differs between pinned
			// Frappe versions); still click the real visible localized button.
			cy.get("[data-testid=liquidity-calendar]").contains("button", win.__("Retry")).click();
		});
		cy.wait("@calendar");
		cy.get(grid + " .ag-root").should("be.visible");
		cy.liquidityFilter("direction", "out");
		cy.get("[data-testid=liquidity-empty]").should("be.visible");
		cy.get("[data-testid=liquidity-error]").should("not.exist");
	});

	testCase("UI-15 denies direct APIs and export to a user without a report role", () => {
		cy.login("denied"); cy.visit("/app");
		cy.call("frappe.desk.query_report.get_script", { report_name: "Liquidity Payment Calendar" }, false).its("status").should("eq", 403);
		for (const method of ["get_calendar", "get_children", "export_liquidity_calendar"]) {
			cy.call(API + method, { filters: { company: context.company } }, false).its("status").should("eq", 403);
		}
		cy.call(API + "get_cell_details", { filters: { company: context.company }, node_key: "root", period_key: "total", metric: "forecast" }, false).its("status").should("eq", 403);
		cy.call(API + "get_options", { kind: "company" }, false).its("status").should("eq", 403);
	});

	testCase("UI-20 navigates P&L and calendar repeatedly without retaining calendar resources", () => {
		cy.openLiquidity(context, {}, "operator");
		for (let i = 0; i < 2; i++) {
			let requested = false;
			cy.intercept({ url: "**/api/method/" + API + "get_calendar*", times: 1 }, (req) => {
				requested = true;
				req.continue((res) => res.setDelay(1800));
			}).as("leavingCalendar");
			cy.get("[data-fieldname=direction] select").select("out");
			cy.wrap(null).should(() => expect(requested, "request started before leaving").to.eq(true));
			cy.intercept("**/api/method/frappe.desk.query_report.run*").as("pnl");
			cy.window().then((win) => {
				win.__previousCalendar = win.frappe.query_report.__liquidityView;
				win.frappe.set_route("query-report", "Project Budget Plan vs Forecast", { company: context.company, ignore_prepared_report: true });
			});
			cy.wait("@leavingCalendar");
			cy.wait("@pnl").then(({ response }) => {
				expect(response.statusCode).to.eq(200);
				expect(response.body.message.result.length, "real P&L rows").to.be.greaterThan(0);
			});
			cy.get("[data-testid=liquidity-calendar]").should("not.exist");
			cy.window().should((win) => {
				expect(win.__previousCalendar.disposed).to.eq(true);
				expect(win.__previousCalendar.chart).to.eq(null);
				expect(win.frappe.query_report.report_name).to.eq("Project Budget Plan vs Forecast");
			});
			cy.get("[data-fieldname=company]").should("be.visible");
			cy.get(".budget-report-chart-container").should("be.visible");
			cy.window().then((win) => win.frappe.set_route("query-report", "Liquidity Payment Calendar", { company: context.company, from_date: context.from_date, to_date: context.to_date }));
			cy.wait("@calendar");
			cy.get("[data-testid=liquidity-calendar]").should("have.length", 1);
			cy.get(grid + " .ag-root").should("be.visible");
		}
	});
});
