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
		const scenario =
			title.includes("SC-04") || title.includes("SC-08")
				? "fifo"
				: title.includes("SC-05")
				? "request"
				: title.includes("SC-06")
				? "standalone"
				: title.includes("SC-09")
				? "many"
				: title.includes("ST-01")
				? "stages"
				: title.includes("VF-")
				? "visual"
				: title.includes("UI-20")
				? "pnl"
				: title.includes("zero rows")
				? "zero"
				: title.includes("UI-10") || title.includes("UI-11")
				? "standalone"
				: title.includes("UI-12")
				? "request"
				: title.includes("UI-14") || title.includes("BG-04")
				? "outward"
				: title.includes("without date")
				? "undated"
				: title.includes("future request")
				? "overdue_request"
				: title.includes("overdue")
				? "overdue"
				: title.includes("pagination") || title.includes("UI-04")
				? "many"
				: "base";
		return cy.seedLiquidity(scenario).then((data) => {
			context = data;
		});
	});
	after(() => cy.cleanupLiquidity());

	const openSource = (doctype, metric = "Forecast") => {
		cy.get(".frappe-control[data-fieldname=sources] .grid-body .grid-row").should(
			"have.length",
			14
		);
		cy.window().should((win) =>
			expect(win.cur_frm?.doctype).to.eq("Payment Calendar Settings")
		);
		cy.window().then((win) => {
			const row = win.cur_frm.doc.sources.find(
				(item) => item.source_doctype === doctype && item.metric === metric
			);
			cy.get(
				`[data-fieldname=sources] .grid-row[data-name='${row.name}'] .btn-open-row`
			).click();
		});
		cy.get("[data-fieldname=sources] .grid-row-open .grid-form-body").should("be.visible");
	};
	const chartPaths = (token, attribute) =>
		cy.window().then((win) => {
			const color = win
				.getComputedStyle(win.document.querySelector(".liquidity-calendar"))
				.getPropertyValue(token)
				.trim();
			expect(color, token).not.to.eq("");
			return cy.get(`[data-testid=liquidity-chart] svg path[${attribute}='${color}']`);
		});
	const settingsPage = () => {
		cy.login("operator");
		cy.visit("/app/payment-calendar-settings");
		cy.get(".frappe-control[data-fieldname=sources] .grid-body .grid-row").should(
			"have.length",
			14
		);
	};
	const saveSettings = () => {
		cy.get(".grid-row-open .grid-collapse-row:visible").click();
		cy.intercept("**/api/method/frappe.desk.form.save.savedocs*").as("settingsSaved");
		cy.get(".page-head .primary-action:visible").click();
		cy.wait("@settingsSaved").then(({ request, response }) => {
			const doc = JSON.parse(new URLSearchParams(request.body).get("doc"));
			const dates = doc.sources.map((row) => [
				row.metric,
				row.source_doctype,
				row.date_field,
				row.fallback_date_field,
			]);
			expect(response.statusCode, JSON.stringify(dates)).to.eq(200);
		});
	};

	testCase("SC-01 saves and reloads Sources and Links with metadata date choices", () => {
		settingsPage();
		cy.window().then((win) => {
			expect(
				win.cur_frm.meta.fields
					.filter((field) => field.fieldtype === "Table")
					.map((field) => field.fieldname)
			).to.have.members(["sources", "links"]);
			expect(win.cur_frm.meta.fields.some((field) => /fifo/i.test(field.fieldname))).to.eq(
				false
			);
		});
		openSource("Sales Invoice");
		cy.get(".grid-row-open .grid-form-body [data-fieldname=date_field] select:visible")
			.find("option[value=posting_date]")
			.should("not.be.empty");
		cy.get(".grid-row-open .grid-form-body [data-fieldname=date_field] select:visible").select(
			"posting_date"
		);
		saveSettings();
		cy.reload();
		openSource("Payment Request");
		for (const theme of ["light", "dark"]) {
			cy.window().then((win) => {
				win.document.documentElement.setAttribute("data-theme", theme);
				const source = win.cur_frm.doc.sources.find(
					(row) => row.source_doctype === "Payment Request" && row.metric === "Forecast"
				);
				const states = source.statuses.split("\n").filter(Boolean);
				expect(states.length, "seeded business states").to.be.greaterThan(0);
				cy.get(".grid-row-open [data-fieldname=statuses] .control-value:visible").should(
					($field) => {
						for (const state of states) {
							expect($field.text(), theme + " localized state").to.include(
								win.__(state)
							);
						}
					}
				);
			});
		}
		cy.get(".grid-row-open .grid-collapse-row:visible").click();
		cy.window().then((win) =>
			win.document.documentElement.setAttribute("data-theme", "light")
		);
		openSource("Sales Invoice");
		cy.window().should((win) =>
			expect(
				win.cur_frm.doc.sources.find(
					(row) => row.source_doctype === "Sales Invoice" && row.metric === "Forecast"
				).date_field
			).to.eq("posting_date")
		);
		cy.openLiquidity(context);
		cy.window().should((win) =>
			expect(
				win.frappe.query_report.__liquidityView.payload.directions.in.total__forecast
			).to.eq(40)
		);
		cy.get(grid + " .ag-cell[col-id='total__combined']")
			.first()
			.dblclick();
		cy.get(".liquidity-details tbody tr").should("contain", context.from_date);
	});

	testCase("SC-02 denies Settings read and write to a project report user", () => {
		cy.openLiquidity(context, {}, "manager");
		cy.call("frappe.client.get", { doctype: "Payment Calendar Settings" }, false)
			.its("status")
			.should("eq", 403);
		cy.call(
			"frappe.client.save",
			{
				doc: JSON.stringify({
					doctype: "Payment Calendar Settings",
					name: "Payment Calendar Settings",
					sources: [],
				}),
			},
			false
		)
			.its("status")
			.should("eq", 403);
		cy.get(grid + " .ag-root").should("be.visible");
	});

	testCase(
		"SC-03 draft Payment Entry refines forecast then submits and cancels without duplicates",
		() => {
			cy.call("dinext_projects_pl.tests.liquidity_ui_helpers.draft_entry", {
				invoice_name: context.invoice,
			}).then(({ body }) => {
				const entry = body.message.name;
				cy.openLiquidity(context);
				cy.get(grid + " .ag-cell[col-id='total__combined']")
					.first()
					.dblclick();
				cy.get(".liquidity-details").should("contain", entry);
				cy.get(".modal:visible .modal-header .btn-modal-close").click();
				cy.login("operator");
				cy.visit("/app");
				cy.call("dinext_projects_pl.tests.liquidity_ui_helpers.draft_entry", {
					invoice_name: context.invoice,
					action: "submit",
					entry_name: entry,
				});
				cy.openLiquidity(context);
				cy.window().should((win) => {
					const sums = win.frappe.query_report.__liquidityView.payload.directions.in;
					expect(sums.total__forecast).to.eq(20);
					expect(sums.total__actual).to.eq(40);
				});
				cy.login("operator");
				cy.visit("/app");
				cy.call("dinext_projects_pl.tests.liquidity_ui_helpers.draft_entry", {
					invoice_name: context.invoice,
					action: "cancel",
					entry_name: entry,
				});
				cy.openLiquidity(context);
				cy.window().should((win) =>
					expect(
						win.frappe.query_report.__liquidityView.payload.directions.in
							.total__forecast
					).to.eq(40)
				);
			});
		}
	);

	testCase("SC-04 shows fixed FIFO request100 invoice60 payment20 as forecast80", () => {
		cy.openLiquidity(context);
		cy.get(grid + " [col-id='total__combined']").should("contain", "80");
		cy.get(grid + " .ag-cell[col-id='total__combined']")
			.first()
			.dblclick();
		cy.get(".liquidity-details")
			.should("contain", "FIFO")
			.and("contain", context.request)
			.and("contain", context.invoice);
		cy.get(".liquidity-details tbody tr").should("have.length", 2);
	});

	testCase(
		"SC-05 disabling a refinement link retains debt and restores the invoice date",
		() => {
			settingsPage();
			cy.window().then((win) => {
				const row = win.cur_frm.doc.links.find(
					(item) =>
						item.metric === "Forecast" &&
						item.source_doctype === "Sales Invoice" &&
						item.target_doctype === "Payment Request"
				);
				cy.get(
					`[data-fieldname=links] .grid-row[data-name='${row.name}'] .btn-open-row`
				).click();
			});
			cy.get(
				"[data-fieldname=links] .grid-row-open .grid-form-body [data-fieldname=enabled] input:visible"
			).uncheck();
			saveSettings();
			cy.openLiquidity(context);
			cy.get(grid + " [col-id='total__combined']").should("contain", "80");
			cy.get(grid + " .ag-cell[col-id='total__combined']")
				.first()
				.dblclick();
			cy.get(".liquidity-details tbody tr").should("contain", context.invoice);
			cy.window()
				.then((win) => {
					const view = win.frappe.query_report.__liquidityView;
					return win.frappe.xcall(API + "get_cell_details", {
						filters: view.filters,
						node_key: "root",
						period_key: "total",
						metric: "forecast",
						expected_settings_version: view.payload.settings_version,
					});
				})
				.then((details) =>
					expect(
						details.rows.every((row) => row.date_source.doctype === "Sales Invoice")
					).to.eq(true)
				);
		}
	);

	testCase(
		"SC-06 source selection recalculates projected opening before the display range",
		() => {
			const start = new Date(context.from_date + "T00:00:00Z");
			start.setUTCDate(start.getUTCDate() + 30);
			const from = start.toISOString().slice(0, 10);
			cy.openLiquidity(context, { from_date: from });
			cy.window().should((win) =>
				expect(
					win.frappe.query_report.__liquidityView.payload.balances.periods[0]
						.projected_opening
				).to.eq(100)
			);
			settingsPage();
			openSource("Payment Request");
			cy.get(
				"[data-fieldname=sources] .grid-row-open .grid-form-body [data-fieldname=enabled] input:visible"
			).uncheck();
			saveSettings();
			cy.openLiquidity(context, { from_date: from });
			cy.window().should((win) => {
				const balances = win.frappe.query_report.__liquidityView.payload.balances;
				expect(balances.periods[0].projected_opening).to.eq(0);
				expect(balances.current_cash).to.eq(0);
			});
		}
	);

	testCase("SC-07 stale settings refreshes the report before expanding the tree", () => {
		let oldVersion;
		cy.openLiquidity(context);
		cy.window().then((win) => {
			oldVersion = win.frappe.query_report.__liquidityView.payload.settings_version;
		});
		cy.call("frappe.client.get", { doctype: "Payment Calendar Settings" }).then(({ body }) => {
			const doc = body.message;
			doc.sources.find(
				(row) => row.metric === "Forecast" && row.source_doctype === "Sales Invoice"
			).date_field = "posting_date";
			return cy.call("frappe.client.save", { doc: JSON.stringify(doc) });
		});
		cy.get("[data-testid=liquidity-depth]").select("7");
		cy.window().should((win) =>
			expect(win.frappe.query_report.__liquidityView.payload.settings_version).not.to.eq(
				oldVersion
			)
		);
		cy.get(grid + " .ag-root").should("be.visible");
		cy.get("[data-fieldname=company] input").should("have.value", context.company);
	});

	testCase(
		"SC-08 exports FIFO80 with the applied settings version from a collapsed tree",
		() => {
			let version;
			cy.openLiquidity(context);
			cy.window().then((win) => {
				version = win.frappe.query_report.__liquidityView.payload.settings_version;
			});
			cy.get("[data-testid=liquidity-depth]").select("1");
			cy.task("clearLiquidityWorkbook");
			cy.get("[data-testid=liquidity-export]").click();
			cy.readFile("cypress/downloads/liquidity-payment-calendar.xlsx", "binary").should(
				"have.length.greaterThan",
				1000
			);
			cy.task("readLiquidityWorkbook").then((book) => {
				expect(book.rows[1].at(-1)).to.eq(80);
				expect(book.sheets).to.be.at.least(5);
				expect(book.allocations.slice(1).some((row) => row.includes("FIFO"))).to.eq(true);
				expect(book.parameters.flat()).to.include(version);
			});
		}
	);

	testCase(
		"SC-09 keeps the detail header aligned while scrolling both axes in both themes",
		() => {
			cy.openLiquidity(context);
			cy.get("[data-testid=liquidity-plan]").check();
			cy.get(grid + " .ag-cell[col-id='total__plan']")
				.first()
				.dblclick();
			for (const theme of ["light", "dark"]) {
				cy.window().then((win) =>
					win.document.documentElement.setAttribute("data-theme", theme)
				);
				cy.get(".liquidity-detail-scroll").scrollTo(200, 250);
				cy.get(".liquidity-detail-scroll").should(($scroll) => {
					const scroll = $scroll[0];
					const header = scroll.querySelector("thead th");
					const bounds = scroll.getBoundingClientRect();
					expect(scroll.scrollTop).to.be.greaterThan(0);
					expect(scroll.scrollLeft).to.be.greaterThan(0);
					expect(header.getBoundingClientRect().top - bounds.top).to.be.within(-1, 2);
					expect(getComputedStyle(header).backgroundColor).not.to.eq("rgba(0, 0, 0, 0)");
				});
				cy.get(".liquidity-detail-dialog .liquidity-toolbar").should("be.visible");
				cy.screenshot("liquidity-settings-detail-" + theme, { capture: "viewport" });
			}
		}
	);

	testCase(
		"SC-10 preserves Total scrollbar background border and row alignment in fullscreen themes",
		() => {
			cy.openLiquidity(context);
			for (const theme of ["light", "dark"]) {
				cy.window().then((win) =>
					win.document.documentElement.setAttribute("data-theme", theme)
				);
				for (const fullscreen of [false, true]) {
					if (fullscreen)
						cy.get(grid + " .dinext-table-toolbar-group--end button")
							.last()
							.realClick();
					cy.get(grid).should(($grid) => {
						const spacer = $grid[0].querySelector(".ag-horizontal-right-spacer");
						const root = $grid[0].querySelector(".ag-root-wrapper");
						expect(getComputedStyle(spacer).backgroundColor).to.eq(
							getComputedStyle(root).backgroundColor
						);
						expect(getComputedStyle(spacer).borderLeftWidth).to.eq("1px");
						const pinned = $grid[0].querySelector(
							".ag-pinned-right-cols-container .ag-row"
						);
						const central = [
							...$grid[0].querySelectorAll(".ag-center-cols-container .ag-row"),
						].find(
							(row) => row.getAttribute("row-id") === pinned.getAttribute("row-id")
						);
						expect(
							Math.abs(
								pinned.getBoundingClientRect().top -
									central.getBoundingClientRect().top
							)
						).to.be.lessThan(1);
					});
					if (fullscreen)
						cy.get(grid + " .dinext-table-toolbar-group--end button")
							.last()
							.realClick();
				}
				cy.screenshot("liquidity-settings-total-" + theme, { capture: "viewport" });
			}
		}
	);

	testCase(
		"TN-01 renders metadata icons and safe fallbacks in all tree groupings and themes",
		() => {
			cy.intercept("**/api/method/" + API + "get_calendar*", (req) =>
				req.continue((res) => {
					const visit = (rows) =>
						rows.forEach((row) => {
							if (row.level === "project") row.icon = "fa fa-star";
							if (row.level === "party") row.icon = "fa fa-liquidity-unknown";
							if (row.level === "contract")
								row.icon = '<img src=x onerror="window.badIcon=true">';
							visit(row.children || []);
						});
					visit(res.body.message.rows);
				})
			);
			cy.openLiquidity(context, { show_zero: 1 }, "operator");
			cy.get(grid + " .liquidity-record-icon.fa-star").should("be.visible");
			cy.get("[data-testid=liquidity-depth]").select("7");
			cy.get(grid).contains(context.payment).should("be.visible");
			for (const theme of ["light", "dark"]) {
				cy.window().then((win) =>
					win.document.documentElement.setAttribute("data-theme", theme)
				);
				cy.get(grid + " .ag-pinned-left-cols-container .liquidity-record").each(
					($record) => {
						cy.wrap($record).find(".liquidity-record-icon").should("be.visible");
					}
				);
				cy.get(grid + " .liquidity-record-icon.fa-users").should("be.visible");
				cy.get(grid + " .liquidity-record-icon.fa-file-text-o").should("be.visible");
				cy.get(grid + " .liquidity-record img").should("not.exist");
				cy.window().then((win) => expect(win.badIcon).to.eq(undefined));
				cy.screenshot("liquidity-tree-icons-" + theme, { capture: "fullPage" });
			}
			cy.window().then((win) => {
				const definitions = win.document.createElementNS(
					"http://www.w3.org/2000/svg",
					"svg"
				);
				definitions.setAttribute("width", "0");
				definitions.setAttribute("height", "0");
				definitions.innerHTML =
					'<symbol id="es-solid-liquidity-test" viewBox="0 0 16 16"><path d="M2 2h12v12H2z"/></symbol>';
				win.document.body.append(definitions);
				const view = win.frappe.query_report.__liquidityView;
				view.treeRows[0].children[0].icon = "es-solid-liquidity-test";
				return view.expandDepth(7);
			});
			cy.get(grid + " .liquidity-record-icon.es-solid use").should(
				"have.attr",
				"href",
				"#es-solid-liquidity-test"
			);
			for (const grouping of ["party_project", "party_only"]) {
				cy.liquidityFilter("grouping", grouping);
				cy.get(grid + " .liquidity-record-icon.fa-users").should("be.visible");
			}
		}
	);

	testCase(
		"TN-02 opens real record cards on label double click and keeps money drill-down",
		() => {
			const records = [
				["Project", context.project],
				["Customer", context.customer],
				["Contract", context.contract],
				["Sales Order", context.order],
				["Sales Invoice", context.invoice],
				["Payment Entry", context.payment],
			];
			for (const [doctype, name] of records) {
				cy.openLiquidity(context, { show_zero: 1 }, "operator");
				cy.get("[data-testid=liquidity-depth]").select("7");
				cy.get(grid).contains(context.payment).should("be.visible");
				cy.get(grid + " .liquidity-record-link")
					.filter((_i, el) => el.textContent === name)
					.first()
					.dblclick();
				cy.window().should((win) => {
					expect(win.frappe.get_route()).to.deep.eq(["Form", doctype, name]);
					expect(win.cur_frm?.doc?.doctype).to.eq(doctype);
					expect(win.cur_frm?.doc?.name).to.eq(name);
				});
			}
			cy.openLiquidity(context, {}, "operator");
			cy.get(grid + " .ag-pinned-left-cols-container .liquidity-record")
				.first()
				.should(($record) => expect($record).not.to.have.attr("role"))
				.dblclick();
			cy.get(grid + " .dinext-table-tree-toggle")
				.first()
				.dblclick();
			cy.window().should((win) => expect(win.frappe.get_route()[0]).to.eq("query-report"));
			cy.get(grid + " .ag-pinned-right-cols-container [col-id=total__combined]")
				.first()
				.dblclick();
			cy.get("[data-testid=liquidity-details]")
				.should("be.visible")
				.and("contain", context.invoice);
		}
	);

	testCase("TN-03 restores the calendar after visiting a document without route filters", () => {
		cy.intercept({ url: "**/project-budget.bundle.*.js*", times: 1 }, (request) => {
			request.continue((response) => response.setDelay(500));
		}).as("projectBudgetBundle");
		cy.openLiquidity(context, {}, "operator");
		cy.window().then((win) => {
			expect(win.ProjectBudget?.isReady?.()).not.to.eq(true);
			// Optional local apps may supply the binder eagerly; CI has no such app.
			delete win.project_workload_assignment?.bindLazyTabMount;
		});
		for (const theme of ["light", "dark"]) {
			cy.window().then((win) => {
				win.document.documentElement.setAttribute("data-theme", theme);
				win.__calendarBeforeForm = win.frappe.query_report.__liquidityView;
			});
			cy.get(grid + " .liquidity-record-link")
				.filter((_i, el) => el.textContent === context.project)
				.first()
				.dblclick();
			if (theme === "light") cy.wait("@projectBudgetBundle");
			cy.window().should((win) => {
				expect(win.frappe.get_route()).to.deep.eq(["Form", "Project", context.project]);
				expect(win.cur_frm?.doc?.name).to.eq(context.project);
				expect(win.__calendarBeforeForm.disposed).to.eq(true);
				expect(win.__calendarBeforeForm.chart).to.eq(null);
			});
			cy.window().then((win) =>
				win.frappe.set_route("query-report", "Liquidity Payment Calendar")
			);
			cy.get(grid + " .ag-root").should("be.visible");
			cy.get("[data-testid=liquidity-calendar]")
				.should("have.length", 1)
				.and("have.attr", "aria-busy", "false");
			cy.window().should((win) => {
				expect(win.frappe.query_report.__liquidityView.disposed).to.eq(false);
				expect(win.frappe.query_report.__liquidityView.filters.company).to.eq(
					context.company
				);
			});
		}
	});

	testCase(
		"ST-01 shows authorized payment stages without adding their reference amounts",
		() => {
			cy.openLiquidity(context, {}, "operator");
			cy.viewport(1280, 720);
			cy.liquidityMode("forecast");
			cy.get(grid + " .ag-pinned-right-cols-container [col-id='total__forecast']")
				.first()
				.should("contain", "80")
				.dblclick();
			const request = '[data-stage-doctype="Payment Request"]';
			const order = '[data-stage-doctype="Payment Order"]';
			cy.window().then((win) =>
				cy.get(".modal:visible .modal-dialog").should(($dialog) => {
					expect($dialog[0].getBoundingClientRect().right).to.be.at.most(win.innerWidth);
				})
			);
			cy.get(request).should("contain", context.request);
			cy.get(request + " [data-stage-status]").should("have.attr", "data-stage-status", "1");
			cy.get(request + " [data-stage-field=requested]").should("contain", "60 USD");
			cy.get(request + " [data-stage-field=settled]").should("contain", "20 USD");
			cy.get(request + " [data-stage-field=remaining]").should("contain", "40 USD");
			cy.get(order).should("contain", context.payment_order);
			cy.get(order + " [data-stage-field=ordered]").should("contain", "60 USD");
			for (const theme of ["dark", "light"]) {
				cy.window().then((win) =>
					win.document.documentElement.setAttribute("data-theme", theme)
				);
				// Keep the first stages below the sticky header while scrolling horizontally.
				cy.get(".liquidity-detail-scroll").scrollTo("100%", 0, {
					ensureScrollable: false,
				});
				cy.get(request).should("be.visible");
				cy.screenshot("liquidity-payment-stages-" + theme, { capture: "viewport" });
			}
			cy.get(".modal:visible .btn-modal-close").click();
			cy.liquidityMode("actual");
			cy.get(grid + " .ag-pinned-right-cols-container [col-id='total__actual']")
				.first()
				.should("contain", "20")
				.dblclick();
			cy.get('[data-stage-doctype="Payment Entry"] [data-stage-field=executed]').should(
				"contain",
				"20 USD"
			);
		}
	);

	testCase("VF-01 aligns receipts and payments with visible grids and no hover pointer", () => {
		cy.openLiquidity(context);
		for (const theme of ["dark", "light"]) {
			cy.window().then((win) =>
				win.document.documentElement.setAttribute("data-theme", theme)
			);
			cy.window().should((win) => {
				const chart = win.frappe.query_report.__liquidityView.chart;
				const option = chart.getOption();
				expect(option.tooltip[0].axisPointer.type).to.eq("none");
				expect(option.xAxis[0].splitLine.show).to.eq(true);
				expect(option.yAxis[0].splitLine.show).to.eq(true);
				const bars = chart
					.getModel()
					.getSeriesByType("bar")
					.filter((serie) => serie.option.data.some((d) => d.metric === "forecast"));
				const incoming = bars.find((serie) => serie.option.data.some((d) => d.value > 0));
				const outgoing = bars.find((serie) => serie.option.data.some((d) => d.value < 0));
				const index = incoming.option.data.findIndex((d) => d.value > 0);
				const above = incoming.getData().getItemLayout(index);
				const below = outgoing.getData().getItemLayout(index);
				expect(above.x).to.be.closeTo(below.x, 0.01);
				expect(above.width).to.be.closeTo(below.width, 0.01);
				expect(above.height * below.height).to.be.lessThan(0);
				expect(
					option.series.filter((serie) => serie.id === "liquidity-today")
				).to.have.length(1);
			});
			// Exclude the short legend swatch; move away before re-hovering after theme redraw.
			cy.get("[data-testid=liquidity-kpis]").realHover({ position: "topLeft" });
			chartPaths("--green-600", "fill")
				.filter((_i, path) => path.getBoundingClientRect().height > 20)
				.first()
				.realHover();
			cy.get(".liquidity-chart-tooltip")
				.should("be.visible")
				.and("contain", "40")
				.and("contain", "-100");
		}
	});

	testCase(
		"VF-02 centers currency cards and shows period boundaries muted zeros net colors and dropdown arrows",
		() => {
			cy.openLiquidity(context);
			cy.liquidityPlan(true);
			for (const theme of ["light", "dark"]) {
				cy.window().then((win) =>
					win.document.documentElement.setAttribute("data-theme", theme)
				);
				cy.get(".liquidity-kpi").each(($card) => {
					cy.wrap($card)
						.should("have.css", "text-align", "center")
						.and("have.css", "align-items", "center");
					cy.wrap($card).find("strong").should("contain", "$");
				});
				cy.get("[data-testid=liquidity-gap]")
					.parent()
					.should("have.class", "liquidity-kpi")
					.and("contain", "Минимальный прогнозный остаток");
				cy.get(".liquidity-select-control")
					.should("have.length", 2)
					.each(($control) =>
						cy.wrap($control).find("svg.liquidity-select-arrow").should("be.visible")
					);
				cy.get(grid + " .ag-header-cell.liquidity-period-start")
					.first()
					.should("have.css", "font-size", "10px")
					.and("have.css", "border-left-width", "1px");
				cy.get(grid + " .liquidity-zero")
					.first()
					.should(($cell) =>
						expect($cell.css("color")).not.to.eq(
							$cell.closest(".liquidity-calendar").css("--text-muted")
						)
					);
				cy.get(grid + " .liquidity-net-positive").should("exist");
				cy.get(grid + " .liquidity-net-negative").should("exist");
				cy.window().then((win) => {
					const green = win.getComputedStyle(
						win.document.querySelector(".liquidity-net-positive")
					).color;
					const red = win.getComputedStyle(
						win.document.querySelector(".liquidity-net-negative")
					).color;
					expect(green).not.to.eq(red);
				});
			}
		}
	);

	testCase(
		"VF-03 retains native fullscreen through Plan modes and delayed metric responses",
		() => {
			cy.openLiquidity(context);
			let element;
			cy.get(grid + " .dinext-table-toolbar-group--end button")
				.last()
				.realClick();
			cy.document()
				.should((doc) => expect(doc.fullscreenElement).to.exist)
				.then((doc) => {
					element = doc.fullscreenElement;
				});
			cy.liquidityPlan(true);
			for (const mode of ["actual", "forecast", "combined"]) {
				cy.liquidityMode(mode);
				cy.document().should((doc) => expect(doc.fullscreenElement).to.eq(element));
				cy.window().should((win) =>
					expect(win.frappe.query_report.__liquidityView.viewMode()).to.eq(mode)
				);
			}
			cy.liquidityPlan(false);
			let count = 0;
			cy.intercept("**/api/method/" + API + "get_calendar*", (req) => {
				if (++count === 1) req.on("response", (res) => res.setDelay(600));
			}).as("metricRace");
			cy.get("[data-testid=liquidity-plan]").check().uncheck();
			cy.wait("@metricRace");
			cy.wait("@metricRace");
			cy.get("[data-testid=liquidity-calendar]").should("have.attr", "aria-busy", "false");
			cy.get("[data-testid=liquidity-plan]").should("not.be.checked");
			cy.get(grid + " [col-id=total__plan]").should("not.exist");
			cy.document().should((doc) => expect(doc.fullscreenElement).to.eq(element));
			cy.get(grid + " .dinext-table-toolbar-group--end button")
				.last()
				.realClick();
			cy.document().should((doc) => expect(doc.fullscreenElement).to.eq(null));
		}
	);

	testCase("VF-04 names each period Actual or Forecast and exports the same meaning", () => {
		cy.openLiquidity(context);
		cy.window().then((win) =>
			cy.liquidityFilter(
				"from_date",
				win.moment(context.from_date).subtract(14, "days").format("YYYY-MM-DD")
			)
		);
		cy.window().then((win) => {
			const view = win.frappe.query_report.__liquidityView;
			const columns = view.columns();
			view.payload.periods.forEach((period, index) =>
				expect(columns[index + 2].children[0].headerName).to.eq(
					period.end < view.payload.as_of ? "Факт" : "Прогноз"
				)
			);
			expect(columns[1].children[0].headerName).to.eq("Прогноз");
			expect(columns.at(-1).children[0].headerName).to.eq("Движение");
		});
		cy.task("clearLiquidityWorkbook");
		cy.get("[data-testid=liquidity-export]").click();
		cy.readFile("cypress/downloads/liquidity-payment-calendar.xlsx", "binary").should(
			"have.length.greaterThan",
			1000
		);
		cy.task("readLiquidityWorkbook").then((book) => {
			expect(book.rows[0].some((label) => String(label).endsWith(" / Факт"))).to.eq(true);
			expect(book.rows[0].some((label) => String(label).endsWith(" / Прогноз"))).to.eq(true);
			expect(book.rows[0].at(-1)).to.eq("Итого / Движение");
		});
		cy.liquidityMode("actual");
		cy.get(grid + " .ag-header-cell[col-id$='__actual']").each(($cell) =>
			cy.wrap($cell).should("contain", "Факт")
		);
	});

	testCase("TA-01 keeps native Fullscreen last with XLSX immediately before it", () => {
		cy.openLiquidity(context);
		cy.get(".liquidity-plan").should("have.text", "План");
		cy.get("[data-testid=liquidity-display]")
			.parent()
			.should(($label) => expect($label.clone().children().remove().end().text()).to.eq(""));
		cy.get(grid + " .dinext-table-toolbar-group--end").should(($group) => {
			const items = $group.find("a, button").filter(":visible");
			expect(items.eq(-2).attr("data-testid")).to.eq("liquidity-export");
			expect(items.last().attr("title")).to.match(
				/Fullscreen|Полноэкран|Полный экран|Весь экран/i
			);
		});
		cy.get(grid + " .dinext-table-toolbar-group--end button")
			.last()
			.realClick();
		cy.window().should((win) =>
			expect(win.frappe.query_report.__liquidityView.grid.isFullscreen()).to.eq(true)
		);
		cy.get(grid + " .dinext-table-toolbar-group--end button")
			.last()
			.realClick();
		cy.window().should((win) =>
			expect(win.frappe.query_report.__liquidityView.grid.isFullscreen()).to.eq(false)
		);
	});

	testCase(
		"TA-02 shows six compact filters centered headers and integer spaced amounts in both themes",
		() => {
			cy.openLiquidity(context);
			for (const theme of ["dark", "light"]) {
				cy.window().then((win) =>
					win.document.documentElement.setAttribute("data-theme", theme)
				);
				cy.get(grid + " .dinext-table-toolbar [data-testid=liquidity-show-zero]")
					.should("have.length", 1)
					.and("not.be.checked");
				cy.get(grid + " .liquidity-zero-rows").should("have.text", "Нулевые строки");
				cy.get(".liquidity-filters [data-fieldname=show_zero]:visible").should(
					"not.exist"
				);
				cy.get(grid + " .dinext-table-toolbar-group").each(($group) => {
					const items = [...$group[0].children]
						.map((item) => item.getBoundingClientRect())
						.filter((box) => box.width > 0 && box.height > 0);
					for (let i = 1; i < items.length; i++)
						expect(
							items[i].left - items[i - 1].right,
							"small toolbar spacing"
						).to.be.within(1, 8);
				});
				cy.get(".liquidity-filters .page-form > .frappe-control:visible").should(
					($fields) => {
						const top = $fields[0].getBoundingClientRect().top;
						expect(
							[...$fields].filter(
								(field) => Math.abs(field.getBoundingClientRect().top - top) < 2
							)
						).to.have.length(6);
					}
				);
				cy.get(
					grid + " .ag-header-cell-label, " + grid + " .ag-header-group-cell-label"
				).each(($label) => {
					cy.wrap($label)
						.should("have.css", "justify-content", "center")
						.and("have.css", "align-items", "center");
				});
				cy.get(grid + " .liquidity-money")
					.first()
					.should("have.css", "text-align", "center")
					.and("have.css", "align-items", "center");
			}
			cy.window().then((win) => {
				const view = win.frappe.query_report.__liquidityView;
				expect(view.format(1234567.89)).to.eq("1 234 568");
				expect(view.format(-1234567.89)).to.eq("-1 234 568");
				expect(view.format(-0.5)).to.eq("-1");
				expect(view.format(-0.1)).to.eq("0");
				expect(view.format(1234567.89, true)).to.eq("1 234 567,89");
			});
			cy.get(grid + " .ag-pinned-right-cols-container [col-id=total__combined]")
				.first()
				.should("have.text", "40");
			cy.viewport(800, 900);
			cy.get(".liquidity-filters .page-form").should(($form) =>
				expect($form.css("grid-template-columns").split(" ")).to.have.length(3)
			);
		}
	);

	testCase(
		"TA-03 groups Only Counterparty without project levels and preserves totals export and restrictions",
		() => {
			cy.openLiquidity(context, { show_zero: 1 });
			cy.liquidityFilter("grouping", "party_only");
			cy.get("[data-testid=liquidity-depth] option").should("have.length", 6);
			cy.get(grid).contains("_Test Liquidity Customer").should("be.visible");
			cy.get("[data-testid=liquidity-depth]").select("6");
			cy.get(grid).contains(context.payment).should("be.visible");
			cy.window().then((win) => {
				const view = win.frappe.query_report.__liquidityView;
				const levels = [];
				view.grid.api.forEachNode((node) => levels.push(node.data.level));
				expect(levels).not.to.include("project");
				expect(view.payload.directions.in.total__forecast).to.eq(40);
			});
			cy.task("clearLiquidityWorkbook");
			cy.get("[data-testid=liquidity-export]").click();
			cy.readFile("cypress/downloads/liquidity-payment-calendar.xlsx", "binary").should(
				"have.length.greaterThan",
				1000
			);
			cy.task("readLiquidityWorkbook").then((book) => {
				const rows = book.rows;
				expect(rows.some((row) => row[0] === context.project)).to.eq(false);
				expect(rows[1].at(-1)).to.eq(40);
			});
			cy.openLiquidity(context, { grouping: "party_only" }, "manager");
			cy.get(grid + " .liquidity-balance-row").should("not.exist");
		}
	);

	testCase(
		"TA-04 selects multiple cells with accurate statistics and opens details on double click",
		() => {
			cy.openLiquidity(context);
			cy.liquidityPlan(true);
			const plan =
				grid + " .ag-pinned-right-cols-container [row-index='0'] [col-id=total__plan]";
			const cash =
				grid + " .ag-pinned-right-cols-container [row-index='0'] [col-id=total__combined]";
			cy.get(plan).click();
			cy.get(cash).click({ shiftKey: true });
			cy.get(".modal:visible").should("not.exist");
			cy.get(grid + " .dinext-table-status-bar")
				.should("be.visible")
				.and("contain", "120,00")
				.and("contain", "60,00");
			cy.window().then((win) => {
				const stats = win.frappe.query_report.__liquidityView.grid.getSelectionStats();
				expect(stats.cellCount).to.eq(2);
				expect(stats.sum).to.eq(120);
				expect(stats.average).to.eq(60);
			});
			cy.get(
				grid + " .ag-pinned-right-cols-container [row-index='1'] [col-id=total__combined]"
			).click({ ctrlKey: true });
			cy.window().then((win) => {
				const stats = win.frappe.query_report.__liquidityView.grid.getSelectionStats();
				expect(stats.cellCount).to.eq(3);
				expect(stats.sum).to.eq(160);
				expect(stats.average).to.be.closeTo(160 / 3, 0.000001);
			});
			cy.get(cash).dblclick();
			cy.get("[data-testid=liquidity-details]").should("contain", context.invoice);
		}
	);

	testCase("TA-05 batches all branches once and discards late expansion after collapse", () => {
		let childRequests = 0;
		cy.intercept("**/api/method/" + API + "get_children*", () => {
			childRequests++;
		});
		cy.openLiquidity(context, { show_zero: 1 });
		cy.intercept("**/api/method/" + API + "get_calendar*", (req) => {
			req.on("response", (res) => res.setDelay(700));
		}).as("depthRequest");
		cy.get("[data-testid=liquidity-depth]").select("7");
		cy.get("[data-testid=liquidity-depth]").select("1");
		cy.wait("@depthRequest");
		cy.get(grid).should("have.attr", "aria-busy", "false");
		cy.window().should((win) =>
			expect(win.frappe.query_report.__liquidityView.grid.api.getDisplayedRowCount()).to.eq(
				1
			)
		);
		cy.get("[data-testid=liquidity-depth]").select("7");
		cy.wait("@depthRequest");
		cy.get(grid).contains(context.payment).should("be.visible");
		cy.get("[data-testid=liquidity-depth]").select("2").select("7");
		cy.get(grid).contains(context.payment).should("be.visible");
		cy.get("@depthRequest.all").should("have.length", 2);
		cy.then(() => expect(childRequests).to.eq(0));
	});

	testCase(
		"CT-01 synchronizes all display modes and plan with chart table URL and export",
		() => {
			cy.openLiquidity(context);
			cy.get("[data-testid=liquidity-plan]").should("not.be.checked");
			cy.get("[data-testid=liquidity-display]").should("have.value", "combined");
			for (const plan of [true, false]) {
				cy.liquidityPlan(plan);
				for (const mode of ["actual", "forecast", "combined"]) {
					cy.liquidityMode(mode);
					cy.window().then((win) => {
						const view = win.frappe.query_report.__liquidityView;
						const expected = [
							...(plan ? ["plan"] : []),
							...(mode === "combined" ? ["forecast", "actual"] : [mode]),
						];
						expect(view.filters.metrics).to.have.members(expected);
						const bars = view.chart
							.getOption()
							.series.filter((serie) => serie.type === "bar");
						expect(bars.map((serie) => serie.data[0].metric)).to.have.members([
							...expected,
							...expected,
						]);
						if (plan)
							expect(
								bars.find((serie) => serie.data[0].metric === "plan").stack
							).not.to.eq(
								bars.find((serie) => serie.data[0].metric !== "plan").stack
							);
						for (const metric of ["plan", "forecast", "actual", "combined"]) {
							cy.get(grid + ` [col-id='total__${metric}']`).should(
								(metric === "plan" ? plan : metric === mode)
									? "exist"
									: "not.exist"
							);
						}
						const exported = new URL(
							view.root.find("[data-testid=liquidity-export]")[0].href
						).searchParams.get("filters");
						expect(JSON.parse(exported).metrics).to.have.members(expected);
						expect(
							JSON.parse(new URL(win.location.href).searchParams.get("metrics"))
						).to.have.members(expected);
					});
				}
			}
			cy.reload();
			cy.wait("@calendar");
			cy.get("[data-testid=liquidity-plan]").should("not.be.checked");
			cy.get("[data-testid=liquidity-display]").should("have.value", "combined");
		}
	);

	testCase(
		"CT-02 keeps controls and icon export in the table toolbar and explains accounts on hover",
		() => {
			cy.openLiquidity(context, { show_zero: 1 });
			cy.get(
				".liquidity-meta, .liquidity-account-note, [data-testid=liquidity-mode]"
			).should("not.exist");
			cy.get("[data-fieldname=metrics]").should("not.be.visible");
			cy.get("[data-fieldname=accounts]")
				.should("have.attr", "title")
				.and("include", "Денежные счета");
			cy.get(grid + " .dinext-table-toolbar [data-testid=liquidity-depth]").select("7");
			cy.get(grid).contains(context.payment).should("be.visible");
			cy.get(grid + " .dinext-table-toolbar-group--end [data-testid=liquidity-export]")
				.should("have.attr", "aria-label")
				.and("include", "XLSX");
			cy.get("[data-testid=liquidity-export]")
				.should(($button) => expect($button.text().trim()).to.eq(""))
				.find("svg path")
				.should(($path) => {
					const path = $path[0];
					expect(path.getBBox().width, "icon has visible geometry").to.be.greaterThan(0);
					expect(path.ownerDocument.defaultView.getComputedStyle(path).stroke).to.eq(
						$path.closest("a").css("color")
					);
				});
			cy.task("clearLiquidityWorkbook");
			cy.get("[data-testid=liquidity-export]").click();
			cy.readFile("cypress/downloads/liquidity-payment-calendar.xlsx", "binary").should(
				"have.length.greaterThan",
				1000
			);
		}
	);

	testCase("CT-03 marks today within each grain and downloads the current chart image", () => {
		cy.openLiquidity(context);
		for (const grain of ["day", "month", "week"]) {
			cy.liquidityFilter("grain", grain);
			cy.window().then((win) => {
				const view = win.frappe.query_report.__liquidityView;
				const option = view.chart.getOption();
				const markers = option.series.filter((serie) => serie.id === "liquidity-today");
				expect(markers).to.have.length(1);
				expect(markers[0].markLine.label.formatter)
					.to.contain(view.payload.as_of)
					.and.contain("Сегодня");
				expect(markers[0].markLine.data[0].xAxis).to.be.greaterThan(0).and.lessThan(1);
				expect(option.toolbox[0].feature.saveAsImage.title).to.eq("Скачать как рисунок");
			});
		}
		// Locate the rendered toolbox path by its position; ZRender normalizes path data.
		cy.window().then((win) =>
			cy.spy(win.HTMLAnchorElement.prototype, "dispatchEvent").as("imageDownload")
		);
		const downloadIcon = () =>
			cy
				.get("[data-testid=liquidity-chart] svg path")
				.filter((_index, path) => {
					const bounds = path.closest(".liquidity-chart").getBoundingClientRect();
					const box = path.getBoundingClientRect();
					return (
						box.width > 5 &&
						box.width < 30 &&
						box.height > 5 &&
						box.height < 30 &&
						box.top >= bounds.top &&
						box.top < bounds.top + 30 &&
						box.right > bounds.right - 45
					);
				})
				.should("have.length", 1);
		// ECharts needs pointer hover before click and may replace the SVG path on hover.
		downloadIcon().realHover();
		downloadIcon().realClick();
		cy.window().then((win) => {
			const view = win.frappe.query_report.__liquidityView;
			cy.get("@imageDownload").should((spy) => {
				expect(
					spy
						.getCalls()
						.some(
							(call) =>
								call.thisValue.download ===
								"liquidity-calendar-" + view.payload.as_of + ".svg"
						),
					"chart requested an SVG download"
				).to.eq(true);
			});
			cy.readFile(
				"cypress/downloads/liquidity-calendar-" + view.payload.as_of + ".svg"
			).should("contain", "<svg");
			cy.liquidityFilter(
				"from_date",
				win.moment(view.payload.as_of).add(1, "day").format("YYYY-MM-DD")
			);
		});
		cy.window().then((win) =>
			expect(
				win.frappe.query_report.__liquidityView.chart
					.getOption()
					.series.some((serie) => serie.id === "liquidity-today")
			).to.eq(false)
		);
	});

	testCase(
		"CT-04 keeps compact totals pinned with conditional undated and muted zeros in both themes",
		() => {
			for (const undated of [false, true]) {
				if (undated) cy.seedLiquidity("undated").then((data) => (context = data));
				cy.then(() => cy.openLiquidity(context));
				cy.liquidityPlan(true);
				for (const theme of ["dark", "light"]) {
					cy.window().then((win) =>
						win.document.documentElement.setAttribute("data-theme", theme)
					);
					cy.window().should((win) => {
						const view = win.frappe.query_report.__liquidityView;
						expect(view.payload.has_undated).to.eq(undated);
						expect(view.chart.getOption().yAxis[0].splitLine.show).to.eq(true);
						expect(view.chart.getOption().xAxis[0].splitLine.show).to.eq(true);
						const columns = view.grid.api.getAllDisplayedColumns();
						expect(columns.find((col) => !col.getPinned()).getColId()).to.eq(
							(undated ? "undated" : view.payload.periods[0].key) + "__plan"
						);
						expect(view.grid.api.getDisplayedRowAtIndex(0).rowHeight).to.eq(26);
					});
					cy.get(grid + " .ag-header [col-id='undated__combined']").should(
						undated ? "be.visible" : "not.exist"
					);
					cy.get(grid + " .ag-center-cols-container [col-id$='__combined']")
						.first()
						.should("have.css", "font-size", "12px");
					cy.get(grid + " .liquidity-zero")
						.first()
						.should(($cell) =>
							expect($cell.css("color")).not.to.eq(
								$cell.closest(".liquidity-calendar").css("color")
							)
						);
					cy.get(grid + " .ag-pinned-right-header [col-id='total__combined']").should(
						"be.visible"
					);
					cy.get(grid).screenshot("liquidity-controls-" + theme + "-undated-" + undated);
				}
				cy.task("clearLiquidityWorkbook");
				cy.get("[data-testid=liquidity-export]").click();
				cy.readFile("cypress/downloads/liquidity-payment-calendar.xlsx", "binary").should(
					"have.length.greaterThan",
					1000
				);
				cy.task("readLiquidityWorkbook").then((book) =>
					expect(book.rows[0].some((label) => String(label).includes("Без даты"))).to.eq(
						undated
					)
				);
				cy.liquidityScrollRight();
				cy.get(grid + " .ag-pinned-right-cols-container [col-id='total__combined']")
					.first()
					.should("be.visible");
				cy.viewport(1100, 850);
				cy.get(grid + " .ag-pinned-right-header [col-id='total__combined']").should(
					"be.visible"
				);
			}
			cy.liquidityMode("actual");
			cy.get(grid + " [col-id^='undated__']").should("not.exist");
			cy.liquidityMode("forecast");
			cy.get(grid + " .ag-center-cols-viewport").scrollTo(0, 0, { ensureScrollable: false });
			cy.get(grid + " .ag-header [col-id='undated__forecast']").should("be.visible");
			cy.liquidityFilter("direction", "out");
			cy.get(grid + " [col-id^='undated__']").should("not.exist");
			cy.liquidityFilter("direction", "");
			cy.get(grid + " .ag-header [col-id='undated__forecast']").should("be.visible");
		}
	);

	testCase("CT-05 puts filters after chart before grid and opens project or party level", () => {
		cy.openLiquidity(context);
		cy.get("[data-testid=liquidity-depth]").should("have.value", "2");
		cy.get(grid).contains(context.project).should("be.visible");
		cy.get(
			".liquidity-report-active .actions-btn-group, .liquidity-report-active .custom-actions"
		).each(($group) => cy.wrap($group).should("not.be.visible"));
		cy.get("[data-testid=liquidity-filters] [data-fieldname=company]").should("be.visible");
		cy.get("[data-fieldname=metrics]").should("not.be.visible");
		cy.window().then((win) => {
			const chart = win.document.querySelector("[data-testid=liquidity-chart]");
			const filters = win.document.querySelector("[data-testid=liquidity-filters]");
			const table = win.document.querySelector("[data-testid=liquidity-grid]");
			expect(chart.compareDocumentPosition(filters) & 4).to.eq(4);
			expect(filters.compareDocumentPosition(table) & 4).to.eq(4);
		});
		cy.liquidityFilter("grouping", "party_project");
		cy.get(grid).contains("_Test Liquidity Customer").should("be.visible");
	});

	testCase("CT-06 selects forecast for the current period and keeps short period labels", () => {
		cy.openLiquidity(context);
		cy.liquidityPlan(true);
		cy.get(grid + " .ag-pinned-right-cols-container [col-id='total__combined']")
			.first()
			.should("contain", "40")
			.dblclick();
		cy.get("[data-testid=liquidity-details]").should("contain", context.invoice);
		cy.get("[data-testid=liquidity-details] tbody tr").should("have.length", 1);
		cy.get(".modal:visible").should(($modal) =>
			expect($modal.data("bs.modal")._isTransitioning).to.eq(false)
		);
		cy.get(".modal:visible .btn-modal-close").click();
		cy.get(".modal:visible").should("not.exist");
		cy.window().then((win) => {
			const view = win.frappe.query_report.__liquidityView;
			const group = view
				.columns()
				.find(
					(item) => item.children?.[0].field === view.payload.periods[0].key + "__plan"
				);
			expect(group.children.map((col) => col.headerName)).to.deep.eq(["План", "Прогноз"]);
			expect(group.headerName).to.match(/\d{2} · \d{4}/);
		});
		cy.liquidityFilter("grain", "month");
		cy.window().then((win) =>
			expect(win.frappe.query_report.__liquidityView.columns()[1].headerName).to.match(
				/\d{2}\.\d{4}/
			)
		);
		cy.task("clearLiquidityWorkbook");
		cy.get("[data-testid=liquidity-export]").click();
		cy.readFile("cypress/downloads/liquidity-payment-calendar.xlsx", "binary").should(
			"have.length.greaterThan",
			1000
		);
		cy.task("readLiquidityWorkbook").then((book) => {
			expect(book.rows[0].slice(-2)).to.deep.eq(["Итого / План", "Итого / Прогноз"]);
			expect(book.rows[1].at(-1)).to.eq(40);
		});
	});

	testCase("BG-01 balances share the period columns without additive totals", () => {
		cy.openLiquidity(context);
		cy.liquidityPlan(true);
		cy.get(".liquidity-balances").should("not.exist");
		cy.get(grid).contains("Начальный остаток").should("be.visible");
		cy.get(grid).contains("Конечный остаток").should("be.visible");
		cy.window().then((win) => {
			const view = win.frappe.query_report.__liquidityView;
			const rows = view.grid.summaryRowData;
			expect(rows.map((r) => r.id)).to.deep.eq([
				"balance-opening",
				"net",
				"balance-closing",
			]);
			for (const period of view.payload.balances.periods) {
				for (const [metric, prefix] of [
					["actual", "actual"],
					["forecast", "projected"],
				]) {
					for (const [row, kind] of [
						[rows[0], "opening"],
						[rows[2], "closing"],
					]) {
						expect(row[period.key + "__" + metric]).to.eq(period[prefix + "_" + kind]);
					}
				}
			}
			const key = view.payload.periods[0].key;
			cy.get(grid + ` .liquidity-balance-row [col-id='${key}__combined']`)
				.first()
				.should(
					"have.text",
					view.format(view.payload.balances.periods[0].projected_opening)
				);
		});
		cy.get(grid + " .liquidity-balance-row [col-id$='__plan']").each(($cell) =>
			expect($cell.text()).to.eq("—")
		);
		cy.get(grid + " [col-id='undated__combined']").should("not.exist");
		for (const field of ["total__combined"]) {
			cy.get(grid + ` .liquidity-balance-row [col-id='${field}']`)
				.should("have.length", 2)
				.each(($cell) => expect($cell.text()).to.eq("—"));
		}
	});

	testCase("BG-02 balance cells open the exact balance detail and blanks do not request", () => {
		cy.openLiquidity(context);
		cy.liquidityPlan(true);
		cy.intercept("**/api/method/dinext_projects_pl.liquidity.api.get_cell_details*").as(
			"balanceDetail"
		);
		cy.window().then((win) => {
			const key = win.frappe.query_report.__liquidityView.payload.periods[0].key;
			cy.get(grid + ` .liquidity-balance-row [col-id='${key}__combined']`)
				.first()
				.dblclick();
		});
		cy.wait("@balanceDetail").then(({ request, response }) => {
			expect(new URLSearchParams(request.body).get("metric")).to.eq("projected_opening");
			expect(response.statusCode).to.eq(200);
		});
		cy.get("[data-testid=liquidity-details]").should("be.visible");
		cy.get(".modal:visible").should(($modal) =>
			expect($modal.data("bs.modal")._isTransitioning).to.eq(false)
		);
		cy.get(".modal:visible .modal-header .btn-modal-close").click();
		cy.get(".modal:visible").should("not.exist");
		cy.window().then((win) => {
			const key = win.frappe.query_report.__liquidityView.payload.periods[0].key;
			cy.get(
				grid +
					` .ag-floating-bottom-container .liquidity-balance-row [col-id='${key}__combined']`
			)
				.last()
				.dblclick();
		});
		cy.wait("@balanceDetail").then(({ request, response }) => {
			expect(new URLSearchParams(request.body).get("metric")).to.eq("projected_closing");
			expect(response.statusCode).to.eq(200);
		});
		cy.get(".modal:visible").should(($modal) =>
			expect($modal.data("bs.modal")._isTransitioning).to.eq(false)
		);
		cy.get(".modal:visible .modal-header .btn-modal-close").click();
		cy.get(".modal:visible").should("not.exist");
		cy.get(grid + " .liquidity-balance-row [col-id$='__plan']")
			.first()
			.dblclick();
		cy.get("@balanceDetail.all").should("have.length", 2);
		cy.get(".modal:visible").should("not.exist");
	});

	testCase("BG-03 balance rows follow visible metrics and period granularity", () => {
		cy.openLiquidity(context);
		cy.liquidityMode("forecast");
		for (const grain of ["day", "month", "week"]) {
			cy.liquidityFilter("grain", grain);
			cy.get(grid).contains("Конечный остаток").should("be.visible");
			cy.get(grid + " .liquidity-balance-row [col-id$='__actual']").should("not.exist");
		}
		cy.liquidityFilter("accounts", [context.bank_b]);
		cy.get(grid + " .liquidity-balance-row").should("not.exist");
		cy.liquidityMode("actual");
		cy.get(grid).contains("Конечный остаток").should("be.visible");
	});

	testCase("BG-04 negative balances remain highlighted in Russian in both themes", () => {
		cy.openLiquidity(context);
		cy.liquidityFilter("grain", "month");
		for (const theme of ["dark", "light"]) {
			cy.window().then((win) =>
				win.document.documentElement.setAttribute("data-theme", theme)
			);
			cy.get(grid).scrollIntoView().contains("Конечный остаток").should("be.visible");
			cy.get(grid + " .liquidity-negative-balance")
				.should("be.visible")
				.and("contain", "-100");
			cy.get(grid + " .liquidity-negative-balance")
				.first()
				.scrollIntoView()
				.should(($cell) => {
					expect($cell.css("color")).not.to.eq(
						$cell.closest(".liquidity-calendar").css("color")
					);
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
			cy.login("operator");
			cy.visit("/app");
			cy.window().then((win) => win.frappe.set_route("Workspaces", workspace));
			cy.get("a[href*='Liquidity']").filter(":visible").first().click();
			cy.get(grid + " .ag-root").should("be.visible");
			cy.get("[data-fieldname=company] input").should("have.value", context.company);
			cy.get("[data-testid=liquidity-chart] svg").should("be.visible");
			cy.window().then((win) => {
				const start = win.moment(context.from_date).isoWeekday(1);
				expect(win.frappe.query_report.get_filter_value("from_date")).to.eq(
					start.format("YYYY-MM-DD")
				);
				expect(win.frappe.query_report.get_filter_value("to_date")).to.eq(
					start.add(90, "days").format("YYYY-MM-DD")
				);
			});
		});
	}

	testCase("UI-02 expands seven levels and collapses without changing totals", () => {
		cy.openLiquidity(context, { show_zero: 1 });
		cy.get("[data-testid=liquidity-depth]").select("7");
		cy.get(grid).contains(context.payment).should("be.visible");
		cy.get(grid).contains(context.contract).should("be.visible");
		cy.get("[data-testid=liquidity-depth]").select("1");
		cy.get(grid).contains(context.payment).should("not.exist");
		cy.liquidityScrollRight();
		cy.get(grid + " [col-id='total__combined']").should("exist");
	});

	testCase("UI-03 reorders project and counterparty keeping the contract level", () => {
		cy.openLiquidity(context);
		cy.liquidityFilter("grouping", "party_project");
		cy.get("[data-testid=liquidity-depth]").select("4");
		cy.get(grid).contains(context.contract).should("be.visible");
		cy.get(grid + " .ag-pinned-left-cols-container")
			.contains("_Test Liquidity Customer")
			.should("be.visible");
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

	testCase(
		"UI-06 selects a project from its visible dropdown and filters portfolio and party",
		() => {
			cy.openLiquidity(context);
			cy.get("[data-fieldname=projects] [data-toggle=dropdown]").click();
			cy.get("[data-fieldname=projects] .selectable-item").contains(context.project).click();
			cy.wait("@calendar");
			cy.get("[data-testid=liquidity-kpis]").click();
			cy.get(grid + " .liquidity-balance-row").should("not.exist");
			cy.liquidityFilter("projects", []);
			cy.liquidityFilter("portfolios", [context.portfolio]);
			cy.get("[data-testid=liquidity-kpis]").should("contain", "40");
			cy.liquidityFilter("portfolios", []);
			cy.liquidityFilter("party_type", "Customer");
			cy.get("[data-fieldname=parties] [data-toggle=dropdown]").click();
			cy.get("[data-fieldname=parties] .selectable-item")
				.contains("_Test Liquidity Customer")
				.click();
			cy.wait("@calendar");
			cy.get("[data-testid=liquidity-kpis]").click().should("contain", "40");
			cy.get(grid + " .liquidity-balance-row").should("not.exist");
		}
	);

	testCase("UI-07 account selection filters actual only and hides projected balances", () => {
		cy.openLiquidity(context);
		cy.liquidityFilter("accounts", [context.bank_b]);
		cy.get("[data-fieldname=accounts]")
			.should("have.attr", "title")
			.and("include", "Денежные счета");
		cy.window().then((win) => {
			const view = win.frappe.query_report.__liquidityView;
			const rows = view.grid.summaryRowData.filter((row) => row.balanceKind);
			const actualLine = view.chart
				.getOption()
				.series.find((serie) => serie.data?.[0]?.metric === "actual_closing");
			expect(actualLine.data[0].value).to.eq(
				view.payload.balances.periods[0].actual_closing
			);
			expect(
				rows
					.flatMap((row) => Object.values(row.balanceMetrics))
					.filter(Boolean)
					.every((metric) => metric.startsWith("actual_"))
			).to.eq(true);
		});
		cy.get("[data-testid=liquidity-kpis]").should("contain", "40");
		cy.liquidityFilter("accounts", []);
		cy.window().then((win) =>
			expect(win.frappe.query_report.__liquidityView.payload.balances.minimum).not.to.eq(
				null
			)
		);
	});

	testCase("UI-08 opens a cell's exact source documents", () => {
		cy.openLiquidity(context);
		cy.liquidityMode("forecast");
		cy.liquidityScrollRight();
		cy.get(grid + " .ag-pinned-right-cols-container [col-id='total__forecast']")
			.first()
			.dblclick();
		cy.get("[data-testid=liquidity-details]")
			.should("be.visible")
			.and("contain", context.invoice);
		cy.get("[data-testid=liquidity-details] a")
			.first()
			.should("have.attr", "href")
			.and("include", "sales-invoice/");
		cy.get("[data-testid=liquidity-details] a").first().click();
		cy.location("pathname").should("contain", "/sales-invoice/");
		cy.window().should((win) => expect(win.cur_frm?.doc?.name).to.eq(context.invoice));
	});

	testCase("UI-09 chart modes retain a rendered interactive chart", () => {
		cy.openLiquidity(context);
		for (const theme of ["light", "dark"]) {
			cy.window().then((win) =>
				win.document.documentElement.setAttribute("data-theme", theme)
			);
			for (const mode of ["forecast", "actual", "combined"]) {
				cy.liquidityMode(mode);
				cy.get("[data-testid=liquidity-chart] svg").should("be.visible");
			}
			cy.window().then((win) => {
				const root = win.document.querySelector(".liquidity-calendar");
				const style = win.getComputedStyle(root);
				const series = win.frappe.query_report.__liquidityView.chart.getOption().series;
				for (const row of series.filter((item) => item.type === "bar")) {
					const token = row.name.startsWith(win.__("Receipts") + " ·")
						? "--green-600"
						: "--red-500";
					expect(row.itemStyle.color, theme + " series token").to.eq(
						style.getPropertyValue(token).trim()
					);
				}
			});
		}
		cy.liquidityMode("actual");
		chartPaths("--green-600", "fill").then(($paths) => {
			const bar = [...$paths].find((el) => el.getBoundingClientRect().height > 20);
			expect(bar, "actual cash bar").to.exist;
			cy.wrap(bar).trigger("mousemove", "center");
			cy.get(".liquidity-chart-tooltip").should("be.visible").and("contain", "20");
			// Click beside the tooltip axis pointer, which overlays the bar center.
			cy.wrap(bar).click(4, 10);
		});
		cy.get("[data-testid=liquidity-details]").should("contain", context.payment);
	});

	testCase("UI-09 clicks a balance point and reconciles its opening anchor", () => {
		cy.openLiquidity(context);
		chartPaths("--blue-500", "stroke").then(($paths) => {
			const points = [...$paths].filter((el) => {
				const box = el.getBoundingClientRect();
				return box.width < 12 && box.height < 12;
			});
			expect(points.length, "visible balance symbols").to.be.greaterThan(1);
			cy.wrap(points.at(-1)).click();
		});
		cy.get("[data-testid=liquidity-details]").should("contain", context.invoice);
		cy.get(".modal:visible").should("contain", "20").and("contain", "60");
	});

	testCase("UI-15 a project manager sees permitted analytics without company balances", () => {
		cy.openLiquidity(context, {}, "manager");
		cy.get(grid + " .liquidity-balance-row").should("not.exist");
		cy.call(API + "get_calendar", { filters: { company: context.company } })
			.its("body.message.balances")
			.should("eq", null);
	});

	testCase("UI-19 switches light and dark theme without reloading", () => {
		cy.openLiquidity(context);
		cy.viewport(1280, 720);
		cy.document().should((doc) =>
			expect(doc.documentElement.scrollWidth).to.be.at.most(doc.documentElement.clientWidth)
		);
		for (const theme of ["dark", "light"]) {
			cy.window().then((win) =>
				win.document.documentElement.setAttribute("data-theme", theme)
			);
			cy.get(grid + " .ag-root").should("be.visible");
			cy.get("[data-testid=liquidity-chart] svg").should("be.visible");
			cy.screenshot("liquidity-" + theme, { capture: "viewport" });
		}
		cy.viewport(1100, 850);
		cy.document().should((doc) =>
			expect(doc.documentElement.scrollWidth).to.be.at.most(doc.documentElement.clientWidth)
		);
		cy.get("[data-testid=liquidity-chart]").should("be.visible");
	});

	testCase("UI-04 scrolls a large tree with a pinned name column and switches metrics", () => {
		const assertTopScrollbar = () =>
			cy.get(grid).should(($grid) => {
				const header = $grid[0].querySelector(".ag-header");
				const viewport = $grid[0].querySelector(".dinext-table-hscroll-top-viewport");
				const bounds = viewport.getBoundingClientRect();
				const win = viewport.ownerDocument.defaultView;
				const nativeHeight = viewport.offsetHeight - viewport.clientHeight;
				const overlayHeight = parseFloat(
					win.getComputedStyle(viewport, "::-webkit-scrollbar").height
				);
				const trackHeight = Math.min(bounds.height, nativeHeight || overlayHeight);
				expect(bounds.height, "top scrollbar remains accessible").to.be.greaterThan(0);
				expect(viewport.scrollWidth, "horizontal overflow remains").to.be.greaterThan(
					viewport.clientWidth
				);
				expect(
					Math.abs(bounds.top - header.getBoundingClientRect().bottom),
					"scroll viewport touches header"
				).to.be.at.most(1);
				expect(
					Math.abs(bounds.bottom - trackHeight - header.getBoundingClientRect().bottom),
					"visible scrollbar track touches header"
				).to.be.at.most(1);
			});
		cy.openLiquidity(context);
		cy.liquidityPlan(true);
		cy.get("[data-testid=liquidity-depth]").select("5");
		for (const theme of ["light", "dark"]) {
			cy.window().then((win) =>
				win.document.documentElement.setAttribute("data-theme", theme)
			);
			for (const fullscreen of [false, true]) {
				if (fullscreen) {
					cy.get(grid + " .dinext-table-toolbar-group--end button")
						.last()
						.focus()
						.realPress("Enter");
					cy.window().should((win) =>
						expect(win.frappe.query_report.__liquidityView.grid.isFullscreen()).to.eq(
							true
						)
					);
				}
				assertTopScrollbar();
				cy.get(grid + " .ag-body-viewport").scrollTo("bottom", {
					ensureScrollable: false,
				});
				cy.get(grid + " .dinext-table-hscroll-top-viewport").scrollTo("right");
				cy.get(grid + " .ag-body-horizontal-scroll-viewport").should(($viewport) =>
					expect(
						$viewport[0].scrollLeft,
						"top scrollbar scrolls the table"
					).to.be.greaterThan(0)
				);
				cy.liquidityScrollRight();
				cy.get(grid + " .ag-pinned-left-cols-container").should(($pinned) => {
					const doc = $pinned[0].ownerDocument;
					const viewport = doc.querySelector(grid + " .ag-body-viewport");
					const bounds = viewport.getBoundingClientRect();
					const cell = [...$pinned[0].querySelectorAll("[col-id='label']")].find(
						(node) => {
							const box = node.getBoundingClientRect();
							return (
								box.top >= Math.max(bounds.top, 0) &&
								box.bottom <= Math.min(bounds.bottom, doc.defaultView.innerHeight)
							);
						}
					);
					expect(cell, "a pinned label remains inside the viewport").to.exist;
					const box = cell.getBoundingClientRect();
					expect(
						cell.contains(
							doc.elementFromPoint(
								box.left + box.width / 2,
								box.top + box.height / 2
							)
						),
						"the visible pinned label is not covered"
					).to.eq(true);
				});
				cy.get(grid + " .ag-pinned-right-header [col-id='total__combined']").should(
					"be.visible"
				);
				assertTopScrollbar();
				if (fullscreen) {
					cy.get(grid + " .dinext-table-toolbar-group--end button")
						.last()
						.focus()
						.realPress("Enter");
					cy.window().should((win) =>
						expect(win.frappe.query_report.__liquidityView.grid.isFullscreen()).to.eq(
							false
						)
					);
				}
			}
		}
		cy.liquidityPlan(false);
		cy.liquidityMode("forecast");
		cy.get(grid + " [col-id$='__plan']").should("not.exist");
		cy.get(grid + " [col-id$='__forecast']").should("exist");
		assertTopScrollbar();
	});

	testCase("UI-04 explicitly shows zero rows outside the completed payment period", () => {
		const zeroRows = () => {
			cy.get("[data-testid=liquidity-calendar]").should("have.attr", "aria-busy", "false");
			cy.get(grid).should("have.attr", "aria-busy", "false");
			return cy.get(grid + " .dinext-table-toolbar [data-testid=liquidity-show-zero]");
		};
		let changeIndex = 0;
		const change = (action) => {
			const alias = "zeroRowsChange" + ++changeIndex;
			cy.intercept("**/api/method/" + API + "get_calendar*").as(alias);
			action();
			cy.wait("@" + alias);
			cy.get("[data-testid=liquidity-calendar]").should("have.attr", "aria-busy", "false");
			cy.get(grid).should("have.attr", "aria-busy", "false");
		};
		const grain = (value) =>
			change(() =>
				cy.window().then((win) => win.frappe.query_report.set_filter_value("grain", value))
			);
		let tomorrow;
		cy.openLiquidity(context);
		zeroRows().should("not.be.checked");
		grain("month");
		cy.get("[data-testid=liquidity-empty]").should("be.visible");
		change(() => zeroRows().check());
		cy.get("[data-testid=liquidity-depth]").select("7");
		cy.get(grid).contains(context.payment).should("be.visible");
		change(() => zeroRows().uncheck());
		cy.get("[data-testid=liquidity-empty]").should("be.visible");
		change(() => cy.get("[data-testid=liquidity-display]").select("actual"));
		cy.get(grid).contains(context.payment).should("be.visible");
		cy.get(grid + " .ag-cell[col-id=total__actual]")
			.first()
			.should("have.text", "100");
		change(() => cy.get("[data-testid=liquidity-display]").select("combined"));
		cy.get("[data-testid=liquidity-empty]").should("be.visible");
		grain("week");
		change(() =>
			cy.window().then((win) => {
				tomorrow = win.moment(context.from_date).add(1, "day").format("YYYY-MM-DD");
				return win.frappe.query_report.set_filter_value("from_date", tomorrow);
			})
		);
		cy.get("[data-testid=liquidity-empty]").should("be.visible");
		zeroRows().should("be.visible");
		change(() => zeroRows().check());
		zeroRows().should("be.checked");
		cy.get(grid).contains("Поступления").should("be.visible");
		cy.get("[data-testid=liquidity-kpis]").should("contain", "0");
		grain("month");
		zeroRows().should("be.checked");
		cy.get(grid + " .ag-cell[col-id=total__combined]")
			.first()
			.should("have.text", "0");
		change(() => zeroRows().uncheck());
		zeroRows().should("not.be.checked");
		cy.get("[data-testid=liquidity-empty]").should("be.visible");
		cy.then(() => cy.openLiquidity(context, { from_date: tomorrow, show_zero: 1 }));
		zeroRows().should("be.checked");
		cy.get(grid).contains("Поступления").should("be.visible");
		cy.get(grid + " .dinext-table-toolbar-group--end button")
			.last()
			.focus()
			.realPress("Enter");
		cy.window().should((win) =>
			expect(win.frappe.query_report.__liquidityView.grid.isFullscreen()).to.eq(true)
		);
		change(() => zeroRows().uncheck());
		zeroRows().should("not.be.checked");
		cy.window().should((win) =>
			expect(win.frappe.query_report.__liquidityView.grid.isFullscreen()).to.eq(true)
		);
		// Restore native browser state after checking the filter keeps Fullscreen active.
		cy.document().then((doc) => doc.exitFullscreen());
		cy.window().should((win) =>
			expect(win.frappe.query_report.__liquidityView.grid.isFullscreen()).to.eq(false)
		);
	});

	testCase("UI-08 pagination keeps the exact total and source links", () => {
		cy.openLiquidity(context);
		cy.liquidityPlan(true);
		cy.liquidityScrollRight();
		cy.get(grid + " .ag-pinned-right-cols-container [col-id='total__plan']")
			.first()
			.dblclick();
		cy.get("[data-testid=liquidity-details] tbody tr").should("have.length", 50);
		cy.get(".modal:visible").contains("button", "Далее").click();
		cy.get("[data-testid=liquidity-details] tbody tr").should("have.length", 6);
		cy.get("[data-testid=liquidity-details] a").first().click();
		cy.location("pathname").should("include", "/app/sales-order/");
		cy.get(".form-layout").should("be.visible");
	});

	testCase("UI-10 standalone request becomes forecast 70 and actual 30 after payment", () => {
		cy.openLiquidity(context, {}, "operator");
		cy.get("[data-testid=liquidity-kpis]").should("contain", "100");
		cy.get("[data-testid=liquidity-depth]").select("7");
		cy.get(grid).contains("Без инвойса").should("be.visible");
		cy.get(grid).contains(context.request).should("be.visible");
		cy.call("dinext_projects_pl.tests.liquidity_ui_helpers.pay_standalone", {
			request_name: context.request,
		});
		cy.window().then((win) => win.frappe.query_report.refresh());
		cy.wait("@calendar");
		cy.get("[data-testid=liquidity-kpis]").should("contain", "70");
		cy.get(grid + " .ag-pinned-right-cols-container [col-id='total__combined']")
			.first()
			.should("contain", "70");
	});

	testCase("UI-12 request transaction_date moves its forecast slice on refresh", () => {
		cy.openLiquidity(context, {}, "operator");
		cy.liquidityMode("forecast");
		cy.call("dinext_projects_pl.tests.liquidity_ui_helpers.move_request", {
			request_name: context.request,
			days: 35,
		});
		cy.window().then((win) => win.frappe.query_report.refresh());
		cy.wait("@calendar");
		cy.get("[data-testid=liquidity-kpis]").should("contain", "80");
		cy.liquidityScrollRight();
		cy.get(grid + " .ag-pinned-right-cols-container [col-id='total__forecast']")
			.first()
			.dblclick();
		cy.get("[data-testid=liquidity-details]").should("contain", context.request);
		cy.window().then((win) => {
			const date = win.moment(context.from_date).add(35, "days").format("YYYY-MM-DD");
			cy.get("[data-testid=liquidity-details]").should("contain", date);
		});
	});

	testCase("UI-11 partial then full explicit invoice coverage keeps forecast 100", () => {
		cy.openLiquidity(context, {}, "operator");
		cy.liquidityMode("forecast");
		cy.get("[data-testid=liquidity-kpis]").should("contain", "100");
		cy.call("dinext_projects_pl.tests.liquidity_ui_helpers.cover_request", {
			request_name: context.request,
			amount: 60,
		});
		cy.window().then((win) => win.frappe.query_report.refresh());
		cy.wait("@calendar");
		cy.get("[data-testid=liquidity-calendar]").should("have.attr", "aria-busy", "false");
		cy.liquidityScrollRight();
		cy.get(grid + " .ag-pinned-right-cols-container [col-id='total__forecast']")
			.first()
			.dblclick();
		cy.get("[data-testid=liquidity-details] tbody tr").should("have.length", 2);
		cy.get("[data-testid=liquidity-details]").should("contain", "60").and("contain", "40");
		cy.call("dinext_projects_pl.tests.liquidity_ui_helpers.cover_request", {
			request_name: context.request,
			amount: 40,
		});
		cy.window().then((win) => win.frappe.query_report.refresh());
		cy.wait("@calendar");
		cy.get("[data-testid=liquidity-calendar]").should("have.attr", "aria-busy", "false");
		cy.get("[data-testid=liquidity-kpis]").should("contain", "100");
		cy.liquidityScrollRight();
		cy.get(grid + " .ag-pinned-right-cols-container [col-id='total__forecast']")
			.first()
			.dblclick();
		cy.window().then((win) =>
			cy
				.get("[data-testid=liquidity-details] tbody tr td:first-child")
				.should("have.length", 2)
				.each(($cell) => cy.wrap($cell).should("contain", win.__("Sales Invoice")))
		);
	});

	testCase("UI-13 overdue dates remain visible while cash is expected today", () => {
		cy.openLiquidity(context);
		cy.get(grid + " .liquidity-overdue")
			.first()
			.dblclick();
		cy.get("[data-testid=liquidity-details]").should("contain", context.from_date);
		cy.window().then((win) => {
			cy.get("[data-testid=liquidity-details]").should(
				"contain",
				win.moment(context.from_date).subtract(7, "days").format("YYYY-MM-DD")
			);
		});
	});

	testCase("UI-13 future request keeps the overdue contractual date in details", () => {
		cy.openLiquidity(context);
		cy.liquidityMode("forecast");
		cy.liquidityScrollRight();
		cy.get(grid + " .ag-pinned-right-cols-container [col-id='total__forecast']")
			.first()
			.dblclick();
		cy.get("[data-testid=liquidity-details]")
			.should("contain", context.request)
			.and("contain", "40");
		cy.window().then((win) => {
			cy.get("[data-testid=liquidity-details]")
				.should(
					"contain",
					win.moment(context.from_date).subtract(7, "days").format("YYYY-MM-DD")
				)
				.and(
					"contain",
					win.moment(context.from_date).add(21, "days").format("YYYY-MM-DD")
				);
		});
	});

	testCase("UI-13 obligations without date stay outside projected balance", () => {
		cy.openLiquidity(context);
		cy.liquidityMode("forecast");
		cy.get("[data-testid=liquidity-kpis]").should("contain", "20");
		cy.get(grid + " .ag-center-cols-container [col-id='undated__forecast']")
			.first()
			.should("contain", "40")
			.dblclick();
		cy.get("[data-testid=liquidity-details]").should("contain", "Без даты");
	});

	for (const via of ["entry", "journal"]) {
		testCase(`UI-14 executes Payment Order through ${via} without duplicate forecast`, () => {
			cy.openLiquidity(context, {}, "operator");
			cy.get("[data-testid=liquidity-kpis]").should("contain", "100");
			cy.call("dinext_projects_pl.tests.liquidity_ui_helpers.execute_order", {
				order_name: context.payment_order,
				via,
			});
			cy.window().then((win) => win.frappe.query_report.refresh());
			cy.wait("@calendar");
			cy.get("[data-testid=liquidity-kpis]").should("contain", "70");
			cy.get("[data-testid=liquidity-depth]").select("7");
			cy.get(grid).contains(context.payment_order).should("be.visible");
		});
	}

	testCase("UI-16 downloads a complete XLSX while the tree remains collapsed", () => {
		for (const [metrics, showPayment, total] of [
			[["forecast", "actual"], false, 40],
			[["actual"], true, 20],
		]) {
			cy.openLiquidity(context, { metrics });
			cy.get(grid).contains(context.invoice).should("not.exist");
			cy.task("clearLiquidityWorkbook");
			cy.get("[data-testid=liquidity-export]").click();
			cy.readFile("cypress/downloads/liquidity-payment-calendar.xlsx", "binary").should(
				"have.length.greaterThan",
				1000
			);
			cy.task("readLiquidityWorkbook").then((book) => {
				expect(book.numeric).to.be.greaterThan(10);
				const labels = book.rows.map((row) => row[0]);
				expect(labels).to.include(context.contract).and.include(context.invoice);
				expect(labels.includes(context.payment)).to.eq(showPayment);
				expect(book.rows[1].at(-1)).to.eq(total);
				expect(book.sheets).to.eq(5);
				expect(book.allocations[0]).to.have.length(7);
				expect(book.sheet_names).to.include("Распределения");
			});
		}
	});

	testCase("UI-17 ignores an older delayed filter response", () => {
		cy.openLiquidity(context);
		cy.intercept("**/api/method/" + API + "get_calendar*", (req) => {
			const filters = JSON.parse(new URLSearchParams(req.body).get("filters"));
			if (filters.direction === "out") req.continue((res) => res.setDelay(1800));
		}).as("raced");
		cy.get("[data-fieldname=direction] select").select("out").select("in");
		cy.wait("@raced");
		cy.wait("@raced");
		cy.get(grid).contains("Поступления").should("be.visible");
		cy.get("[data-testid=liquidity-kpis]").should("contain", "40");
	});

	testCase("UI-18 distinguishes a failed request from an empty result and retries", () => {
		cy.openLiquidity(context);
		Cypress.env("liquidityExpectedConsole", ["Liquidity injected failure"]);
		cy.intercept(
			{ url: "**/api/method/" + API + "get_calendar*", times: 1 },
			{
				statusCode: 500,
				body: { exception: "Liquidity injected failure", exc_type: "ValidationError" },
			}
		).as("failedCalendar");
		cy.window().then((win) => win.frappe.query_report.refresh());
		cy.wait("@failedCalendar");
		cy.get("[data-testid=liquidity-error]").should("be.visible");
		cy.get(grid + " .ag-root").should("not.exist");
		cy.get("[data-testid=liquidity-calendar]").should("have.attr", "aria-busy", "false");
		cy.get("body").then(($body) => {
			if ($body.find(".modal:visible .btn-modal-close").length)
				cy.get(".modal:visible .btn-modal-close").click();
		});
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
		cy.login("denied");
		cy.visit("/app");
		cy.call(
			"frappe.desk.query_report.get_script",
			{ report_name: "Liquidity Payment Calendar" },
			false
		)
			.its("status")
			.should("eq", 403);
		for (const method of ["get_calendar", "get_children", "export_liquidity_calendar"]) {
			cy.call(API + method, { filters: { company: context.company } }, false)
				.its("status")
				.should("eq", 403);
		}
		cy.call(
			API + "get_cell_details",
			{
				filters: { company: context.company },
				node_key: "root",
				period_key: "total",
				metric: "forecast",
			},
			false
		)
			.its("status")
			.should("eq", 403);
		cy.call(API + "get_options", { kind: "company" }, false)
			.its("status")
			.should("eq", 403);
	});

	testCase(
		"UI-20 navigates P&L and calendar repeatedly without retaining calendar resources",
		() => {
			cy.openLiquidity(context, {}, "operator");
			for (let i = 0; i < 2; i++) {
				let requested = false;
				cy.intercept(
					{ url: "**/api/method/" + API + "get_calendar*", times: 1 },
					(req) => {
						requested = true;
						req.continue((res) => res.setDelay(1800));
					}
				).as("leavingCalendar");
				cy.get("[data-fieldname=direction] select").select("out");
				cy.wrap(null).should(() =>
					expect(requested, "request started before leaving").to.eq(true)
				);
				cy.intercept("**/api/method/frappe.desk.query_report.run*").as("pnl");
				cy.window().then((win) => {
					win.__previousCalendar = win.frappe.query_report.__liquidityView;
					win.frappe.set_route("query-report", "Project Budget Plan vs Forecast", {
						company: context.company,
						ignore_prepared_report: true,
					});
				});
				cy.wait("@leavingCalendar");
				cy.wait("@pnl").then(({ response }) => {
					expect(response.statusCode).to.eq(200);
					expect(response.body.message.result.length, "real P&L rows").to.be.greaterThan(
						0
					);
				});
				cy.get("[data-testid=liquidity-calendar]").should("not.exist");
				cy.get(".liquidity-report-active").should("not.exist");
				cy.window().should((win) => {
					expect(win.__previousCalendar.disposed).to.eq(true);
					expect(win.__previousCalendar.chart).to.eq(null);
					expect(win.frappe.query_report.report_name).to.eq(
						"Project Budget Plan vs Forecast"
					);
				});
				cy.get("[data-fieldname=company]").should("be.visible");
				cy.get(".budget-report-chart-container").should("be.visible");
				cy.window().then((win) => {
					win.__previousPnlTable = win.frappe.query_report.datatable;
					win.frappe.set_route("query-report", "Liquidity Payment Calendar", {
						company: context.company,
						from_date: context.from_date,
						to_date: context.to_date,
					});
				});
				cy.wait("@calendar");
				cy.get("[data-testid=liquidity-calendar]").should("have.length", 1);
				cy.get(grid + " .ag-root").should("be.visible");
				cy.get(".liquidity-report-active .report-wrapper .datatable").should("not.exist");
				cy.window().should((win) =>
					expect(
						win.__previousPnlTable._sm._destroyed,
						"previous table observers released"
					).to.eq(true)
				);
			}
		}
	);
});
