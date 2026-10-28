import "./commands";

beforeEach(() => {
	Cypress.env("liquidityExpectedConsole", []);
	cy.on("window:before:load", (win) => {
		cy.spy(win.console, "error").as("consoleErrors");
	});
});


afterEach(() => {
	cy.get("@consoleErrors").then((spy) => {
		const expected = Cypress.env("liquidityExpectedConsole");
		for (const call of spy.getCalls()) {
			const message = call.args.map(String).join(" ");
			expect(expected.some((text) => message.includes(text)), "unexpected console error: " + message).to.eq(true);
		}
	});
});
