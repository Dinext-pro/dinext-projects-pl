const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
module.exports = {
	defaultCommandTimeout: 30000,
	pageLoadTimeout: 120000,
	requestTimeout: 60000,
	responseTimeout: 120000,
	video: false,
	viewportHeight: 1000,
	viewportWidth: 1600,
	retries: 0,
	e2e: {
		baseUrl: "http://127.0.0.1:8001",
		specPattern: "cypress/integration/**/*.js",
		supportFile: "cypress/support/e2e.js",
		includeShadowDom: true,
		testIsolation: true,
		setupNodeEvents(on, config) {
			on("task", {
				clearLiquidityWorkbook() {
					const filename = path.resolve(
						config.downloadsFolder,
						"liquidity-payment-calendar.xlsx"
					);
					if (fs.existsSync(filename)) fs.unlinkSync(filename);
					return null;
				},
				readLiquidityWorkbook() {
					const filename = path.resolve(
						config.downloadsFolder,
						"liquidity-payment-calendar.xlsx"
					);
					const script =
						"import json,sys; from openpyxl import load_workbook; w=load_workbook(sys.argv[1]); print(json.dumps({'rows':[[c.value for c in r] for r in w.worksheets[0]],'numeric':sum(c.data_type=='n' for s in w for r in s for c in r),'sheets':len(w.worksheets)}))";
					return JSON.parse(
						execFileSync(
							path.resolve(__dirname, "../../env/bin/python"),
							["-c", script, filename],
							{ encoding: "utf8" }
						)
					);
				},
			});
			if (process.env.LIQUIDITY_TEST_URL) config.baseUrl = process.env.LIQUIDITY_TEST_URL;
			const credentialsPath =
				process.env.LIQUIDITY_UI_CREDENTIALS || "/tmp/liquidity-ui-context.json";
			if (fs.existsSync(credentialsPath))
				config.env.liquidity = JSON.parse(fs.readFileSync(credentialsPath, "utf8"));
			return config;
		},
	},
};
