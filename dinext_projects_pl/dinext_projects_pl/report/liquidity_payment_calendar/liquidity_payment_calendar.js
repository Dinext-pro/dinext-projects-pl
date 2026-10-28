/* global DinextTable, echarts */
(() => {
	const NAME = "Liquidity Payment Calendar";
	const API = "dinext_projects_pl.liquidity.api.";
	const esc = (value) => frappe.utils.escape_html(String(value ?? ""));
	const labels = { plan: __("Plan"), forecast: __("Forecast"), actual: __("Actual"), adjustment: __("Balance adjustments"), transfer: __("Internal transfers"), actual_opening: __("Actual opening"), actual_closing: __("Actual closing"), projected_opening: __("Projected opening"), projected_closing: __("Projected closing") };
	const call = (method, args) => frappe.xcall(API + method, args);
	const active = (report) => report.report_name === NAME && frappe.get_route()[0] === "query-report" && frappe.get_route()[1] === NAME;
	const options = (kind, extra = {}) => (txt) => call("get_options", { kind, txt, company: frappe.query_report.get_filter_value("company"), ...extra });
	const firstDay = moment(frappe.datetime.get_today()).isoWeekday(1).format("YYYY-MM-DD");

	class CalendarView {
		constructor(report) {
			this.report = report;
			this.sequence = 0;
			this.disposed = false;
			this.mode = "combined";
			this.root = $("<section class='liquidity-calendar' data-testid='liquidity-calendar'></section>").appendTo(report.$report);
			this.routeChanged = () => { if (!active(report)) this.destroy(); };
			if (!frappe.router.jq) frappe.router.init();
			frappe.router.jq.on("change.liquidityCalendar", this.routeChanged);
			this.themeObserver = new MutationObserver(() => { if (this.chart && active(report)) this.drawChart(); });
			this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-theme-mode"] });
			this.resizeObserver = new ResizeObserver(([entry]) => {
				const { width, height } = entry.contentRect;
				if (width === this.chartWidth && height === this.chartHeight) return;
				this.chartWidth = width; this.chartHeight = height;
				cancelAnimationFrame(this.resizeFrame);
				this.resizeFrame = requestAnimationFrame(() => { if (!this.disposed) this.chart?.resize(); });
			});
		}

		valid(sequence) { return !this.disposed && active(this.report) && sequence === this.sequence; }

		closeDialog() {
			const dialog = this.dialog;
			this.dialog = null;
			if (!dialog) return Promise.resolve();
			return new Promise((resolve) => {
				dialog.$wrapper.one("hidden.bs.modal", () => { dialog.$wrapper.remove(); resolve(); });
				dialog.hide();
			});
		}

		clearVisuals() {
			this.resizeObserver.disconnect();
			cancelAnimationFrame(this.resizeFrame);
			this.chartWidth = this.chartHeight = null;
			this.grid?.destroy(); this.grid = null;
			this.chart?.dispose(); this.chart = null;
			const closed = this.closeDialog();
			this.root.empty();
			return closed;
		}

		destroy() {
			if (this.disposed) return;
			this.disposed = true;
			this.sequence++;
			this.clearVisuals();
			this.themeObserver.disconnect();
			this.resizeObserver.disconnect();
			frappe.router.jq.off("change.liquidityCalendar", this.routeChanged);
			this.root.remove();
		}

		async refresh() {
			const sequence = ++this.sequence;
			// Keep the page height stable while its table/chart are replaced.
			this.root.css("min-height", this.root.outerHeight());
			await this.clearVisuals();
			if (!this.valid(sequence)) return;
			this.report.$report.show();
			this.report.$chart.empty();
			this.report.$summary.empty().hide();
			this.report.toggle_message(false);
			this.root.attr("aria-busy", "true").append($("<p class='text-muted' role='status'></p>").text(__("Loading payment calendar…")));
			try {
				const filters = this.report.get_filter_values();
				if (!filters?.company) throw new Error(__("Company is required"));
				const [payload] = await Promise.all([
					call("get_calendar", { filters }),
					frappe.require(["dinext-table.bundle.js", "/assets/dinext_common/js/echarts.min.js", "/assets/dinext_projects_pl/css/liquidity_payment_calendar.css"]),
				]);
				if (!this.valid(sequence)) return;
				this.payload = payload;
				this.filters = payload.filters;
				this.root.empty();
				await this.render(sequence);
				if (!this.valid(sequence)) return;
				this.report.update_url_with_filters();
			} catch (error) {
				if (!this.valid(sequence)) return;
				this.clearVisuals();
				$("<p class='text-danger' role='alert' data-testid='liquidity-error'></p>").text(__("Unable to load payment calendar. Please retry.")).appendTo(this.root);
				$("<button class='btn btn-default'></button>").text(__("Retry")).on("click", () => this.refresh()).appendTo(this.root);
			} finally {
				if (this.valid(sequence)) this.root.attr("aria-busy", "false").css("min-height", "");
			}
		}

		format(value) {
			return value == null ? "—" : Number(value).toLocaleString(frappe.boot.lang || "ru", { minimumFractionDigits: this.payload.precision, maximumFractionDigits: this.payload.precision });
		}

		async render(sequence) {
			const p = this.payload;
			const meta = $("<div class='liquidity-meta'></div>").appendTo(this.root);
			$("<span></span>").text(`${this.filters.company} · ${p.currency} · ${__("Calculation date")}: ${p.as_of}`).appendTo(meta);
			$("<a class='btn btn-default btn-sm' data-testid='liquidity-export' download='liquidity-payment-calendar.xlsx'></a>")
				.text(__("Export XLSX")).attr("href", "/api/method/" + API + "export_liquidity_calendar?filters=" + encodeURIComponent(JSON.stringify(this.filters))).appendTo(meta);
			$("<p class='text-muted liquidity-account-note'></p>").text(p.account_filter_note).appendTo(this.root);
			if (p.warnings.length) {
				const warnings = $("<div class='liquidity-warnings' role='status'></div>").appendTo(this.root);
				p.warnings.forEach((warning) => $("<p></p>").text(warning).appendTo(warnings));
			}
			const kpis = $("<div class='liquidity-kpis' data-testid='liquidity-kpis'></div>").appendTo(this.root);
			const cards = [[__("Expected receipts"), p.kpis.expected_receipts], [__("Expected payments"), p.kpis.expected_payments]];
			if (p.balances) {
				cards.unshift([__("Current cash balance"), p.balances.current_cash]);
				if (p.balances.minimum != null) cards.push([__("Minimum projected balance"), p.balances.minimum]);
			}
			cards.forEach(([label, value]) => {
				const card = $("<div class='liquidity-kpi'></div>").appendTo(kpis);
				$("<span class='text-muted'></span>").text(label).appendTo(card);
				$("<strong></strong>").toggleClass("text-danger", value < 0).text(this.format(value)).appendTo(card);
			});
			if (p.balances?.minimum != null) $("<p data-testid='liquidity-gap'></p>").text(__("First cash shortfall") + ": " + (p.balances.first_gap_date || __("None in selected range"))).appendTo(this.root);
			const controls = $("<div class='liquidity-toolbar'></div>").appendTo(this.root);
			this.select(controls, "liquidity-mode", __("Chart mode"), [["combined", __("Actual + forecast")], ["plan", labels.plan], ["forecast", labels.forecast], ["actual", labels.actual]], this.mode, (value) => { this.mode = value; this.drawChart(); });
			this.select(controls, "liquidity-depth", __("Expand to level"), Array.from({ length: 7 }, (_, i) => [String(i + 1), String(i + 1)]), "1", (value) => this.expandDepth(Number(value), sequence));
			const chart = $("<div class='liquidity-chart' data-testid='liquidity-chart' role='img'></div>").attr("aria-label", __("Cash movements and balances")).appendTo(this.root);
			this.chart = echarts.init(chart[0], null, { renderer: "svg" });
			this.resizeObserver.observe(chart[0]);
			this.chart.on("click", (event) => {
				if (!event.data?.metric || !this.valid(sequence)) return;
				this.details(event.data.node_key, event.data.period_key, event.data.metric, 0, sequence);
			});
			this.drawChart();
			if (!p.rows.length) $("<p data-testid='liquidity-empty'></p>").text(__("No movements in the selected range")).appendTo(this.root);
			const host = $("<div class='liquidity-grid' data-testid='liquidity-grid'></div>").appendTo(this.root);
			const grid = await DinextTable.create({
				container: host[0], data: p.rows, columns: this.columns(), edit: false,
				rowIdField: "id", childrenField: "children", expandedIds: [],
				filter: { enabled: false }, sort: { enabled: false }, toolbar: false,
				summaryRows: [{ id: "net", label: __("Net cash movement"), ...p.net }],
				summary: { pin: "bottom" },
				onExpandRow: async ({ rowId, row, table }) => {
					try {
						const children = await call("get_children", { filters: this.filters, node_key: row.id });
						if (this.valid(sequence)) table.setRowChildren(rowId, children);
					} catch (error) { if (this.valid(sequence)) frappe.msgprint(__("Unable to load this branch. Collapse and retry.")); }
				},
				gridOptions: { rowHeight: 34, onCellClicked: (event) => {
					const field = event.colDef.field;
					if (!field?.includes("__")) return;
					const [period, metric] = field.split("__");
					this.details(event.data.id, period, metric, 0, sequence);
				} },
			});
			if (!this.valid(sequence)) { grid.destroy(); return; }
			this.grid = grid;
			this.renderBalances();
		}

		select(host, id, label, values, initial, onChange) {
			const wrapper = $("<label class='liquidity-select'></label>").text(label).appendTo(host);
			const select = $("<select class='form-control input-sm'></select>").attr("data-testid", id).appendTo(wrapper);
			values.forEach(([value, text]) => $("<option></option>").val(value).text(text).appendTo(select));
			select.val(initial).on("change", () => onChange(select.val()));
		}

		columns() {
			const columns = [{ field: "label", headerName: __("Direction / Project / Counterparty / Contract / Documents"), pinned: "left", width: 340,
				render: (params) => { const span = document.createElement("span"); span.textContent = params.value || ""; span.title = params.value || ""; return span; } }];
			const periods = this.payload.periods.map((p) => [p.key, p.start === p.end ? p.start : `${p.start} — ${p.end}`]);
			periods.push(["total", __("Selected period total")], ["undated", __("Without date")]);
			const metrics = [...this.filters.metrics];
			["transfer", "adjustment"].forEach((m) => { if (Object.keys(this.payload.net).some((k) => k.endsWith("__" + m))) metrics.push(m); });
			periods.forEach(([key, title]) => columns.push({ headerName: title, children: metrics.map((metric) => ({
				field: key + "__" + metric, headerName: labels[metric], type: "number", width: 145,
				valueFormatter: (params) => this.format(params.value || 0),
				cellClass: "liquidity-money", tooltipValueGetter: (params) => {
					const overdue = params.data?.[key + "__" + metric + "__overdue"];
					const contractual = params.data?.[key + "__" + metric + "__contract_overdue"];
					return [overdue ? __("Overdue portion") + ": " + this.format(overdue) : "", contractual ? __("Original due date overdue") + ": " + this.format(contractual) : ""].filter(Boolean).join(" · ");
				},
				cellClassRules: { "liquidity-overdue": (params) => !!(params.data?.[key + "__" + metric + "__overdue"] || params.data?.[key + "__" + metric + "__contract_overdue"]) },
			})) }));
			return columns;
		}

		async expandDepth(depth, sequence) {
			if (!this.grid || !this.valid(sequence)) return;
			await this.grid.collapseAll();
			for (let level = 0; level < depth - 1 && this.valid(sequence); level++) {
				const pending = [];
				this.grid.api.forEachNode((node) => { if (node.data?.depth === level && node.data.hasChildren) pending.push(node.id); });
				for (const id of pending) { if (this.valid(sequence)) await this.grid.expandRow(id); }
			}
		}

		drawChart() {
			if (!this.chart || this.disposed) return;
			const p = this.payload;
			const color = getComputedStyle(this.root[0]).getPropertyValue("--text-color").trim() || "#555";
			const background = getComputedStyle(this.root[0]).getPropertyValue("--card-bg").trim() || "#fff";
			const metrics = this.mode === "combined" ? ["actual", "forecast"] : [this.mode];
			const series = [];
			for (const direction of ["in", "out"]) {
				const node = p.rows.find((r) => r.path[0] === direction);
				for (const metric of metrics) series.push({
					name: `${direction === "in" ? __("Receipts") : __("Payments")} · ${labels[metric]}`,
					type: "bar", stack: direction, itemStyle: { color: direction === "in" ? "#37a077" : "#d16a69", opacity: metric === "forecast" ? 0.55 : 1 },
					data: p.periods.map((period) => ({ value: (p.directions[direction][period.key + "__" + metric] || 0) * (direction === "in" ? 1 : -1), metric, period_key: period.key, node_key: node?.id || "root" })),
					markLine: { silent: true, symbol: "none", data: [{ yAxis: 0 }], lineStyle: { color, type: "solid", opacity: 0.5 } },
				});
			}
			if (p.balances) {
				[["actual_closing", __("Actual balance"), "solid"], ["projected_closing", __("Projected balance"), "dashed"]].forEach(([field, name, type]) => {
					series.push({ name, type: "line", connectNulls: false, lineStyle: { type, width: 2 }, symbolSize: 7,
						data: p.balances.periods.map((row) => ({ value: row[field], metric: field, node_key: "root", period_key: row.key, itemStyle: { color: row[field] < 0 ? "#d16a69" : "#5683c4" } })) });
				});
			}
			this.chart.setOption({ animation: false, textStyle: { color }, backgroundColor: "transparent",
				tooltip: { trigger: "axis", className: "liquidity-chart-tooltip", backgroundColor: background, textStyle: { color }, formatter: (entries) => `${esc(entries[0]?.axisValueLabel)}<br>` + entries.filter((e) => e.value != null).map((e) => `${esc(e.seriesName)}: ${esc(this.format(e.value))}`).join("<br>") },
				legend: { type: "scroll", textStyle: { color } }, grid: { left: 80, right: 25, top: 48, bottom: 55 },
				xAxis: { type: "category", data: p.periods.map((period) => period.start), axisLabel: { color } },
				yAxis: { type: "value", name: p.currency, axisLabel: { color } }, series,
			}, true);
		}

		renderBalances() {
			if (!this.payload.balances) return;
			const wrapper = $("<div class='liquidity-balances'></div>").appendTo(this.root);
			const table = $("<table class='table table-bordered table-sm'></table>").appendTo(wrapper);
			const fields = [["actual_opening", __("Actual opening")], ["actual_closing", __("Actual closing")], ["projected_opening", __("Projected opening")], ["projected_closing", __("Projected closing")]];
			const header = $("<tr></tr>").appendTo($("<thead></thead>").appendTo(table));
			$("<th></th>").text(__("Balances")).appendTo(header);
			this.payload.periods.forEach((p) => $("<th></th>").text(p.start).appendTo(header));
			const body = $("<tbody></tbody>").appendTo(table);
			fields.filter(([key]) => this.payload.balances.periods.some((p) => p[key] != null)).forEach(([key, label]) => {
				const row = $("<tr></tr>").appendTo(body);
				$("<th></th>").text(label).appendTo(row);
				this.payload.balances.periods.forEach((p) => {
					const cell = $("<td></td>").appendTo(row);
					if (p[key] == null) cell.text("—");
					else $("<button class='btn btn-link btn-sm'></button>").toggleClass("text-danger", p[key] < 0).text(this.format(p[key])).on("click", () => this.details("root", p.key, key, 0, this.sequence)).appendTo(cell);
				});
			});
		}

		async details(node, period, metric, start, sequence) {
			const detailSequence = (this.detailSequence || 0) + 1;
			this.detailSequence = detailSequence;
			try {
				const response = await call("get_cell_details", { filters: this.filters, node_key: node, period_key: period, metric, start, page_length: 50 });
				if (!this.valid(sequence) || detailSequence !== this.detailSequence) return;
				await this.closeDialog();
				if (!this.valid(sequence) || detailSequence !== this.detailSequence) return;
				const dialog = this.dialog = new frappe.ui.Dialog({ title: labels[metric] + " · " + (period === "undated" ? __("Without date") : period), size: "extra-large", fields: [{ fieldname: "details", fieldtype: "HTML" }] });
				dialog.$wrapper.one("hidden.bs.modal", () => {
					dialog.$wrapper.remove();
					if (this.dialog === dialog) this.dialog = null;
				});
				const host = dialog.fields_dict.details.$wrapper;
				$("<p></p>").text(`${__("Total")}: ${this.format(response.total)} · ${response.count} · ${response.calculated_at}`).appendTo(host);
				if (response.anchor != null) $("<p></p>").text(`${__("Opening anchor")}: ${this.format(response.anchor)} · ${__("Net cash movement")}: ${this.format(response.movement)}`).appendTo(host);
				const table = $("<table class='table table-bordered liquidity-details' data-testid='liquidity-details'></table>").appendTo($("<div class='liquidity-detail-scroll'></div>").appendTo(host));
				const header = $("<tr></tr>").appendTo($("<thead></thead>").appendTo(table));
				[__("Source"), __("Original due date"), __("Expected date"), __("Original amount"), this.payload.currency, __("Paid"), __("Outstanding"), __("Linked documents")].forEach((title) => $("<th></th>").text(title).appendTo(header));
				const body = $("<tbody></tbody>").appendTo(table);
				const link = (target, doc) => $("<a></a>").attr("href", "/app/" + frappe.router.slug(doc.doctype) + "/" + encodeURIComponent(doc.name)).text(doc.doctype + ": " + doc.name).appendTo(target);
				response.rows.forEach((item) => {
					const row = $("<tr></tr>").appendTo(body);
					link($("<td></td>").appendTo(row), item.source);
					[item.original_date || __("Without date"), item.date || __("Without date"), this.format(item.original_amount) + " " + item.currency, this.format(item.amount * (response.signed && item.direction === "out" ? -1 : 1)), this.format(item.paid), this.format(item.outstanding)].forEach((value) => $("<td></td>").text(value).appendTo(row));
					const refs = $("<td></td>").appendTo(row);
					const docs = [...item.links, item.analytic.order, item.analytic.invoice, item.payment, item.analytic.contract && { doctype: "Contract", name: item.analytic.contract }].filter(Boolean);
					const seen = new Set();
					docs.forEach((doc) => { const id = doc.doctype + ":" + doc.name; if (!seen.has(id)) { seen.add(id); link($("<div></div>").appendTo(refs), doc); } });
					if (item.status) $("<div></div>").text(__(item.status)).appendTo(refs);
					if (item.date_source) $("<div class='text-muted'></div>").text(__("Date source") + ": " + item.date_source.doctype + " " + item.date_source.name).appendTo(refs);
					if (item.contract_overdue) $("<div></div>").text(__("Original due date overdue")).appendTo(refs);
				});
				const pager = $("<div class='liquidity-toolbar'></div>").appendTo(host);
				[[__("Previous"), Math.max(0, start - 50), start > 0], [__("Next"), start + 50, start + 50 < response.count]].forEach(([label, offset, enabled]) => $("<button class='btn btn-default btn-sm'></button>").text(label).prop("disabled", !enabled).on("click", () => this.details(node, period, metric, offset, sequence)).appendTo(pager));
				dialog.show();
			} catch (error) { if (this.valid(sequence)) frappe.msgprint(__("Unable to load details. Refresh and retry.")); }
		}
	}

	frappe.query_reports[NAME] = {
		filters: [
			{ fieldname: "company", label: __("Company"), fieldtype: "Link", options: "Company", reqd: 1, default: frappe.defaults.get_user_default("Company") },
			{ fieldname: "from_date", label: __("From Date"), fieldtype: "Date", default: firstDay, reqd: 1 },
			{ fieldname: "to_date", label: __("To Date"), fieldtype: "Date", default: moment(firstDay).add(90, "days").format("YYYY-MM-DD"), reqd: 1 },
			{ fieldname: "grain", label: __("Period granularity"), fieldtype: "Select", options: [{ value: "day", label: __("Day") }, { value: "week", label: __("Week") }, { value: "month", label: __("Month") }], default: "week" },
			{ fieldname: "projects", label: __("Projects"), fieldtype: "MultiSelectList", get_data: options("project") },
			{ fieldname: "portfolios", label: __("Project portfolios"), fieldtype: "MultiSelectList", get_data: options("portfolio") },
			{ fieldname: "party_type", label: __("Counterparty type"), fieldtype: "Select", options: "\nCustomer\nSupplier\nEmployee" },
			{ fieldname: "parties", label: __("Counterparties"), fieldtype: "MultiSelectList", get_data: (txt) => options("party", { party_type: frappe.query_report.get_filter_value("party_type") })(txt) },
			{ fieldname: "accounts", label: __("Cash accounts"), fieldtype: "MultiSelectList", get_data: options("account") },
			{ fieldname: "direction", label: __("Direction"), fieldtype: "Select", options: [{ value: "", label: __("All") }, { value: "in", label: __("Receipts") }, { value: "out", label: __("Payments") }] },
			{ fieldname: "grouping", label: __("Grouping"), fieldtype: "Select", default: "project_party", options: [{ value: "project_party", label: __("Project → Counterparty") }, { value: "party_project", label: __("Counterparty → Project") }] },
			{ fieldname: "metrics", label: __("Metrics"), fieldtype: "MultiSelectList", default: ["plan", "forecast", "actual"], get_data: () => ["plan", "forecast", "actual"].map((value) => ({ value, label: labels[value], description: "" })) },
			{ fieldname: "show_zero", label: __("Show zero rows"), fieldtype: "Check", default: 0 },
		],
		onload(report) {
			// QueryReport initializes defaults with set_input; MultiSelectList keeps
			// its selection in values and needs set_value for an initial array.
			if (!report.get_filter_value("metrics")?.length) {
				const metrics = report.get_filter("metrics");
				// Initializing this report-only control must not schedule a delayed
				// onchange refresh after QueryReport has started its first load.
				metrics.values = ["plan", "forecast", "actual"];
				metrics.update_status();
			}
			report.__liquidityView?.destroy();
			report.__liquidityView = new CalendarView(report);
			if (!report.__liquidityWrapped) {
				const previous = report.refresh;
				report.refresh = function (...args) {
					if (!active(this) || !this.__liquidityView || this.__liquidityView.disposed) return previous.apply(this, args);
					return this.__liquidityView.refresh();
				};
				report.__liquidityWrapped = true;
			}
		},
	};
})();
