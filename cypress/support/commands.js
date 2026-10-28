Cypress.Commands.add("login", (role = "financier") => {
	const credentials = Cypress.env("liquidity");
	expect(credentials, "CLI bootstrap credentials").to.exist;
	const email = credentials[role];
	return cy.session(email, () => {
		cy.request({ method: "POST", url: "/api/method/login", body: { usr: email, pwd: credentials.password }, log: false });
	}, { cacheAcrossSpecs: false, validate() {
		cy.request("/api/method/frappe.auth.get_logged_user").its("body.message").should("eq", email);
	} });
});

Cypress.Commands.add("call", (method, args = {}, failOnStatusCode = true) => {
	return cy.window().its("frappe.csrf_token").then((csrf) => {
		expect(csrf).to.be.a("string").and.not.eq("None");
		return cy.request({ method: "POST", url: "/api/method/" + method, body: args,
			headers: { "X-Frappe-CSRF-Token": csrf }, failOnStatusCode });
	});
});

Cypress.Commands.add("seedLiquidity", (scenario = "base") => {
	cy.login("operator");
	cy.visit("/app");
	return cy.call("dinext_projects_pl.tests.liquidity_ui_helpers.seed", { scenario }).its("body.message");
});

Cypress.Commands.add("openLiquidity", (context, extra = {}, role = "financier") => {
	cy.login(role);
	const filters = { company: context.company, from_date: context.from_date, to_date: context.to_date, ...extra };
	const params = new URLSearchParams(Object.entries(filters).map(([k, v]) => [k, Array.isArray(v) ? JSON.stringify(v) : v]));
	cy.intercept("**/api/method/dinext_projects_pl.liquidity.api.get_calendar*").as("calendar");
	cy.visit("/app/query-report/Liquidity%20Payment%20Calendar?" + params.toString());
	cy.wait("@calendar").then(({ request, response }) => {
		expect(response.statusCode, (response.body?.exception || "calendar response") + " filters=" + new URLSearchParams(request.body).get("filters")).to.eq(200);
	});
	cy.get("[data-testid=liquidity-calendar]").should("have.attr", "aria-busy", "false");
	cy.get("[data-testid=liquidity-grid] .ag-root").should("be.visible");
});

Cypress.Commands.add("liquidityFilter", (name, value) => {
	if (["grain", "direction", "grouping", "party_type"].includes(name)) {
		cy.get(`[data-fieldname="${name}"] select`).select(value);
	} else {
		cy.window().then((win) => win.frappe.query_report.set_filter_value(name, value));
	}
	cy.wait("@calendar").its("response.statusCode").should("eq", 200);
	cy.window().should((win) => expect(win.frappe.query_report.__liquidityView.filters[name]).to.deep.eq(value));
	cy.get("[data-testid=liquidity-calendar]").should("have.attr", "aria-busy", "false");
});

Cypress.Commands.add("liquidityScrollRight", () => {
	cy.get("[data-testid=liquidity-grid]").scrollIntoView();
	cy.get("[data-testid=liquidity-grid] .ag-center-cols-viewport").scrollTo("right");
	cy.get("[data-testid=liquidity-grid] .ag-center-cols-viewport").should(($viewport) => expect($viewport[0].scrollLeft).to.be.greaterThan(0));
});

Cypress.Commands.add("liquidityMode", (value) => {
	cy.get("[data-testid=liquidity-display]").select(value);
	cy.wait("@calendar").its("response.statusCode").should("eq", 200);
	cy.get("[data-testid=liquidity-calendar]").should("have.attr", "aria-busy", "false");
	cy.get("[data-testid=liquidity-display]").should("have.value", value);
});
Cypress.Commands.add("liquidityPlan", (value) => {
	cy.get("[data-testid=liquidity-plan]")[value ? "check" : "uncheck"]();
	cy.wait("@calendar").its("response.statusCode").should("eq", 200);
	cy.get("[data-testid=liquidity-calendar]").should("have.attr", "aria-busy", "false");
});
