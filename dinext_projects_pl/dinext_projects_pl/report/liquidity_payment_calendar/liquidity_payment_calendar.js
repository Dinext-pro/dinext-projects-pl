/* global DinextTable, echarts */
(() => {
	const NAME = "Liquidity Payment Calendar";
	const API = "dinext_projects_pl.liquidity.api.";
	const esc = (value) => frappe.utils.escape_html(String(value ?? ""));
	const labels = { combined: __("Forecast / actual"), plan: __("Plan"), forecast: __("Forecast"), actual: __("Actual"), adjustment: __("Balance adjustments"), transfer: __("Internal transfers"), actual_opening: __("Actual opening"), actual_closing: __("Actual closing"), projected_opening: __("Projected opening"), projected_closing: __("Projected closing") };
	const call = (method, args) => frappe.xcall(API + method, args);
	const active = (report) => report.report_name === NAME && frappe.get_route()[0] === "query-report" && frappe.get_route()[1] === NAME;
	const options = (kind, extra = {}) => (txt) => call("get_options", { kind, txt, company: frappe.query_report.get_filter_value("company"), ...extra });
	const firstDay = moment(frappe.datetime.get_today()).isoWeekday(1).format("YYYY-MM-DD");

	class CalendarView {
		constructor(report) {
			this.report = report;
			this.sequence = 0;
			this.disposed = false;
			this.depth = 2;
			this.filterForm = report.page.page_form;
			this.filterHome = document.createComment("liquidity-filter-home");
			this.filterForm[0].before(this.filterHome);
			this.pageWrapper = report.page.wrapper;
			this.pageWrapper.addClass("liquidity-report-active");
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

		restoreFilters() {
			if (this.filterHome.parentNode) this.filterHome.after(this.filterForm[0]);
		}

		clearVisuals() {
			this.restoreFilters();
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
			this.accountFilter?.removeAttr("title aria-description");
			this.filterHome.remove();
			this.pageWrapper.removeClass("liquidity-report-active");
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
				// Keep older plan-only URLs usable with the new three-mode control.
				if (!filters.metrics?.some((metric) => metric === "actual" || metric === "forecast")) {
					filters.metrics = [...(filters.metrics || []), "forecast", "actual"];
					const control = this.report.get_filter("metrics");
					control.values = filters.metrics;
					control.update_status();
				}
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
			this.depth = 2;
			this.accountFilter = this.report.get_filter("accounts").$wrapper;
			this.accountFilter.attr({ title: p.account_filter_note, "aria-description": p.account_filter_note });
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

			const chart = $("<div class='liquidity-chart' data-testid='liquidity-chart' role='img'></div>").attr("aria-label", __("Cash movements and balances")).appendTo(this.root);
			this.chart = echarts.init(chart[0], null, { renderer: "svg" });
			this.resizeObserver.observe(chart[0]);
			this.chart.on("click", (event) => {
				if (!event.data?.metric || !this.valid(sequence)) return;
				this.details(event.data.node_key, event.data.period_key, event.data.metric, 0, sequence);
			});
			this.drawChart();
			$("<div class='liquidity-filters' data-testid='liquidity-filters'></div>").append(this.filterForm).appendTo(this.root);
			if (!p.rows.length) $("<p data-testid='liquidity-empty'></p>").text(__("No movements in the selected range")).appendTo(this.root);
			const host = $("<div class='liquidity-grid' data-testid='liquidity-grid'></div>").appendTo(this.root);
			const grid = await DinextTable.create({
				container: host[0], data: p.rows, columns: this.columns(), edit: false,
				rowIdField: "id", childrenField: "children", expandedIds: [],
				filter: { enabled: false }, sort: { enabled: false },
				toolbar: { enabled: true, defaultPinned: true, presets: ["tree"], items: this.toolbarItems(sequence) },
				layout: { height: "auto", maxHeight: 440 },
				defaultColDef: { minWidth: 80 },
				summaryRows: this.summaryRows(),
				summary: { pin: "bottom" },
				onExpandRow: async ({ rowId, row, table }) => {
					try {
						const children = await call("get_children", { filters: this.filters, node_key: row.id });
						if (this.valid(sequence)) table.setRowChildren(rowId, children);
					} catch (error) { if (this.valid(sequence)) frappe.msgprint(__("Unable to load this branch. Collapse and retry.")); }
				},
				gridOptions: { rowHeight: 28, headerHeight: 28, groupHeaderHeight: 28,
					getRowClass: (params) => params.data?.balanceKind ? "liquidity-balance-row" : "",
					onCellClicked: (event) => {
						const field = event.colDef.field;
						if (!field?.includes("__")) return;
						const [period, metric] = field.split("__");
						if (event.data.balanceKind) {
							if (event.value == null) return;
							const balanceMetric = event.data.balanceMetrics?.[field] || `${metric === "actual" ? "actual" : "projected"}_${event.data.balanceKind}`;
							this.details("root", period, balanceMetric, 0, sequence);
						} else this.details(event.data.detailMetric ? "net" : event.data.id, period, event.data.detailMetric || metric, 0, sequence);
					},
				},
			});
			if (!this.valid(sequence)) { grid.destroy(); return; }
			this.grid = grid;
			await this.expandDepth(2, sequence);
		}

		viewMode() {
			const metrics = this.filters.metrics;
			return metrics.includes("actual") && metrics.includes("forecast") ? "combined" : metrics.includes("actual") ? "actual" : "forecast";
		}

		setMetrics(mode, plan) {
			const metrics = mode === "combined" ? ["forecast", "actual"] : [mode];
			if (plan) metrics.unshift("plan");
			return this.report.set_filter_value("metrics", metrics);
		}

		toolbarItems(sequence) {
			return [
				{ id: "liquidity-depth", type: "custom", render: ({ host }) => {
					$(host).empty();
					this.select($(host), "liquidity-depth", __("Expand to level"), Array.from({ length: 7 }, (_, i) => [String(i + 1), String(i + 1)]), String(this.depth), (value) => {
						this.depth = Number(value); this.expandDepth(this.depth, sequence);
					});
				} },
				{ id: "liquidity-plan", type: "custom", render: ({ host }) => {
					const label = $("<label class='liquidity-plan'></label>");
					$("<input type='checkbox' data-testid='liquidity-plan'>").prop("checked", this.filters.metrics.includes("plan"))
						.on("change", (event) => this.setMetrics(this.viewMode(), event.target.checked)).appendTo(label);
					$("<span></span>").text(labels.plan).appendTo(label);
					$(host).empty().append(label);
				} },
				{ id: "liquidity-display", type: "custom", render: ({ host }) => {
					$(host).empty();
					this.select($(host), "liquidity-display", __("Display"), [["combined", __("Forecast and actual")], ["actual", __("Actual only")], ["forecast", __("Forecast only")]], this.viewMode(), (value) => this.setMetrics(value, this.filters.metrics.includes("plan")));
				} },
				{ id: "liquidity-export", type: "custom", align: "end", render: ({ host }) => {
					const link = $("<a class='dinext-table-toolbar-item' data-testid='liquidity-export' download='liquidity-payment-calendar.xlsx'></a>")
						.attr({ title: __("Export XLSX"), "aria-label": __("Export XLSX"), href: "/api/method/" + API + "export_liquidity_calendar?filters=" + encodeURIComponent(JSON.stringify(this.filters)) })
						.html('<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" d="M8 2v8m-3-3 3 3 3-3M3 11v3h10v-3"/></svg>');
					$(host).empty().append(link);
				} },
			];
		}

		select(host, id, label, values, initial, onChange) {
			const wrapper = $("<label class='liquidity-select'></label>").text(label).appendTo(host);
			const select = $("<select class='form-control input-sm'></select>").attr("data-testid", id).appendTo(wrapper);
			values.forEach(([value, text]) => $("<option></option>").val(value).text(text).appendTo(select));
			select.val(initial).on("change", () => onChange(select.val()));
		}

		periodLabel(period) {
			const start = moment(period.start);
			if (this.filters.grain === "week") return __("Week {0}", [start.isoWeek()]) + " · " + start.isoWeekYear();
			if (this.filters.grain === "month") return start.format("MM.YYYY");
			return start.format("DD.MM.YYYY");
		}

		periodMetric(key) {
			const period = this.payload.periods.find((p) => p.key === key);
			return period && period.end < this.payload.as_of ? "actual" : "forecast";
		}

		cellValue(row, key, metric, suffix = "") {
			if (!row) return null;
			if (metric !== "combined" || row.balanceKind || row.detailMetric) return row[key + "__" + metric + suffix];
			if (key === "total") return this.payload.periods.reduce((sum, period) => sum + this.cellValue(row, period.key, metric, suffix), 0);
			return row[key + "__" + this.periodMetric(key) + suffix] || 0;
		}

		columns() {
			const columns = [{ field: "label", headerName: __("Direction / Project / Counterparty / Contract / Documents"), pinned: "left", width: 280, minWidth: 180,
				render: (params) => { const span = document.createElement("span"); span.textContent = params.value || ""; span.title = params.value || ""; return span; } }];
			const periods = [["undated", __("Without date")], ...this.payload.periods.map((p) => [p.key, this.periodLabel(p), `${p.start} — ${p.end}`]), ["total", __("Total")]];
			const metrics = [...(this.filters.metrics.includes("plan") ? ["plan"] : []), this.viewMode() === "combined" ? "combined" : this.viewMode()];
			periods.forEach(([key, title, range]) => columns.push({ headerName: title, headerTooltip: range || title, marryChildren: true, pinned: key === "total" ? "right" : undefined, children: metrics.map((metric) => ({
				field: key + "__" + metric, headerName: labels[metric], type: "number", width: 96, minWidth: 80, pinned: key === "total" ? "right" : undefined,
				valueGetter: (params) => this.cellValue(params.data, key, metric),
				valueFormatter: (params) => this.format(params.data?.balanceKind ? params.value : (params.value ?? 0)),
				cellClass: "liquidity-money", tooltipValueGetter: (params) => {
					const overdue = this.cellValue(params.data, key, metric, "__overdue");
					const contractual = this.cellValue(params.data, key, metric, "__contract_overdue");
					return [this.format(params.data?.balanceKind ? params.value : (params.value ?? 0)), overdue ? __("Overdue portion") + ": " + this.format(overdue) : "", contractual ? __("Original due date overdue") + ": " + this.format(contractual) : ""].filter(Boolean).join(" · ");
				},
				cellClassRules: {
					"liquidity-zero": (params) => params.data?.balanceKind ? params.value === 0 : !params.value,
					"liquidity-negative-balance": (params) => !!params.data?.balanceKind && params.value < 0,
					"liquidity-unavailable-balance": (params) => !!params.data?.balanceKind && params.value == null,
					"liquidity-overdue": (params) => !!(this.cellValue(params.data, key, metric, "__overdue") || this.cellValue(params.data, key, metric, "__contract_overdue")) },
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
			const metrics = this.filters.metrics;
			const gridColor = getComputedStyle(this.root[0]).getPropertyValue("--border-color").trim() || color;
			const series = [];
			for (const direction of ["in", "out"]) {
				const node = p.rows.find((r) => r.path[0] === direction);
				for (const metric of metrics) series.push({
					name: `${direction === "in" ? __("Receipts") : __("Payments")} · ${labels[metric]}`,
					type: "bar", stack: metric === "plan" ? direction + "-plan" : direction, itemStyle: { color: direction === "in" ? "#37a077" : "#d16a69", opacity: metric === "plan" ? 0.3 : metric === "forecast" ? 0.6 : 1 },
					data: p.periods.map((period) => ({ value: (this.viewMode() === "combined" && metric !== "plan" && metric !== this.periodMetric(period.key) ? 0 : p.directions[direction][period.key + "__" + metric] || 0) * (direction === "in" ? 1 : -1), metric, period_key: period.key, node_key: node?.id || "root" })),
					markLine: { silent: true, symbol: "none", data: [{ yAxis: 0 }], lineStyle: { color, type: "solid", opacity: 0.5 } },
				});
			}
			if (p.balances) {
				[["actual_closing", __("Actual balance"), "solid", "actual"], ["projected_closing", __("Projected balance"), "dashed", "forecast"]].forEach(([field, name, type, metric]) => {
					if (!metrics.includes(metric)) return;
					series.push({ name, type: "line", connectNulls: false, lineStyle: { type, width: 2 }, symbolSize: 7,
						data: p.balances.periods.map((row) => ({ value: this.viewMode() === "combined" && metric !== this.periodMetric(row.key) && !(metric === "actual" && this.filters.accounts?.length) ? null : row[field], metric: field, node_key: "root", period_key: row.key, itemStyle: { color: row[field] < 0 ? "#d16a69" : "#5683c4" } })) });
				});
			}
			const todayPeriod = p.periods.findIndex((period) => period.start <= p.as_of && p.as_of <= period.end);
			if (todayPeriod >= 0) {
				const period = p.periods[todayPeriod];
				const day = moment(p.as_of).diff(moment(period.start), "days");
				const length = moment(period.end).diff(moment(period.start), "days") + 1;
				series.push({ id: "liquidity-today", type: "line", xAxisIndex: 1, data: [], silent: true,
					markLine: { symbol: "none", silent: true, lineStyle: { color, type: "dashed", width: 1, opacity: 0.8 },
						label: { formatter: __("Today") + " · " + p.as_of, color, backgroundColor: background, padding: 3, position: "insideEndTop" },
						data: [{ xAxis: todayPeriod + (day + 0.5) / length }] } });
			}
			this.chart.setOption({ animation: false, textStyle: { color }, backgroundColor: background,
				tooltip: { trigger: "axis", className: "liquidity-chart-tooltip", backgroundColor: background, textStyle: { color }, formatter: (entries) => `${esc(entries[0]?.axisValueLabel)}<br>` + entries.filter((e) => e.value != null).map((e) => `${esc(e.seriesName)}: ${esc(this.format(e.value))}`).join("<br>") },
				toolbox: { right: 8, top: 0, iconStyle: { borderColor: color }, feature: { saveAsImage: { type: "svg", name: "liquidity-calendar-" + p.as_of, title: __("Download as image"), backgroundColor: background, excludeComponents: ["toolbox"] } } },
				legend: { type: "scroll", right: 50, textStyle: { color } }, grid: { left: 80, right: 25, top: 48, bottom: 55 },
				xAxis: [{ type: "category", data: p.periods.map((period) => period.start), axisLabel: { color } },
					{ type: "value", min: 0, max: p.periods.length, show: false }],
				yAxis: { type: "value", name: p.currency, axisLabel: { color }, splitLine: { lineStyle: { color: gridColor, opacity: 0.45 } } }, series,
			}, true);
		}

		summaryRows() {
			const net = { id: "net", label: __("Net cash movement"), ...this.payload.net };
			const movement = [net];
			if (this.filters.metrics.includes("actual")) {
				for (const metric of ["transfer", "adjustment"]) {
					if (!Object.keys(this.payload.net).some((key) => key.endsWith("__" + metric))) continue;
					const row = { id: metric, detailMetric: this.viewMode() === "combined" ? "combined_" + metric : metric, label: labels[metric] };
					for (const key of [...this.payload.periods.map((p) => p.key), "undated"]) row[key + "__" + this.viewMode()] = this.viewMode() === "combined" && this.periodMetric(key) !== "actual" ? 0 : this.payload.net[key + "__" + metric] || 0;
					row["total__" + this.viewMode()] = this.payload.periods.reduce((sum, period) => sum + row[period.key + "__" + this.viewMode()], 0);
					movement.push(row);
				}
			}
			if (!this.payload.balances) return movement;
			const balances = ["opening", "closing"].map((kind) => {
				const row = { id: "balance-" + kind, balanceKind: kind, balanceMetrics: {},
					label: kind === "opening" ? __("Opening balance") : __("Closing balance") };
				for (const period of this.payload.balances.periods) {
					if (this.viewMode() === "combined") {
						const prefix = this.periodMetric(period.key) === "actual" ? "actual" : "projected";
						const candidates = [`${prefix}_${kind}`, ...(prefix === "projected" && this.filters.accounts?.length ? [`actual_${kind}`] : [])];
						const chosen = candidates.find((field) => period[field] != null);
						row[period.key + "__combined"] = chosen ? period[chosen] : null;
						row.balanceMetrics[period.key + "__combined"] = chosen;
					}
					for (const metric of this.filters.metrics) {
						const prefix = { actual: "actual", forecast: "projected" }[metric];
						if (prefix) row[period.key + "__" + metric] = period[`${prefix}_${kind}`];
					}
				}
				return row;
			}).filter((row) => Object.entries(row).some(([key, value]) => key.includes("__") && value != null));
			return [...balances.filter((row) => row.balanceKind === "opening"), ...movement,
				...balances.filter((row) => row.balanceKind === "closing")];
		}

		async details(node, period, metric, start, sequence) {
			const detailSequence = (this.detailSequence || 0) + 1;
			this.detailSequence = detailSequence;
			try {
				const response = await call("get_cell_details", { filters: this.filters, node_key: node, period_key: period, metric, start, page_length: 50 });
				if (!this.valid(sequence) || detailSequence !== this.detailSequence) return;
				await this.closeDialog();
				if (!this.valid(sequence) || detailSequence !== this.detailSequence) return;
				const dialog = this.dialog = new frappe.ui.Dialog({ title: (labels[metric] || labels[metric.replace("combined_", "")]) + " · " + (period === "undated" ? __("Without date") : period), size: "extra-large", fields: [{ fieldname: "details", fieldtype: "HTML" }] });
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
			{ fieldname: "metrics", label: __("Metrics"), fieldtype: "MultiSelectList", default: ["forecast", "actual"], get_data: () => ["plan", "forecast", "actual"].map((value) => ({ value, label: labels[value], description: "" })) },
			{ fieldname: "show_zero", label: __("Show zero rows"), fieldtype: "Check", default: 0 },
		],
		onload(report) {
			// QueryReport initializes defaults with set_input; MultiSelectList keeps
			// its selection in values and needs set_value for an initial array.
			if (!report.get_filter_value("metrics")?.length) {
				const metrics = report.get_filter("metrics");
				// Initializing this report-only control must not schedule a delayed
				// onchange refresh after QueryReport has started its first load.
				metrics.values = ["forecast", "actual"];
				metrics.update_status();
			}
			report.get_filter("metrics").$wrapper.hide();
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
