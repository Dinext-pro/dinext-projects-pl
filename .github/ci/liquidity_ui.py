"""Run real browser acceptance on the disposable bench prepared by Dinext CI."""

import json
import os
import platform
import subprocess
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path


def main():
	bench = Path(os.environ["RUNNER_TEMP"]) / "dinext-test-bench"
	app = bench / "apps/dinext_projects_pl"
	credentials = Path("/tmp/liquidity-ui-context.json")
	site = "ci.test"
	env = dict(os.environ, DEV_SERVER="1", FRAPPE_SITE=site, LIQUIDITY_TEST_URL="http://127.0.0.1:8001")
	env.pop("ELECTRON_RUN_AS_NODE", None)
	env.pop("CYPRESS_liquidityTestPattern", None)
	env["CYPRESS_reporter"] = "junit"
	env["CYPRESS_reporterOptions"] = json.dumps(
		{"mochaFile": "cypress/results/liquidity-[hash].xml", "toConsole": True}
	)

	def run(*args):
		subprocess.run(args, cwd=bench, env=env, check=True, timeout=1200)

	run("bench", "use", site)
	common = bench / "sites/common_site_config.json"
	config = json.loads(common.read_text())
	config.update(socketio_port=9000, webserver_port=8001, default_site=site)
	common.write_text(json.dumps(config))
	run("bench", "--site", site, "set-config", "developer_mode", "1")
	run("bench", "--site", site, "execute", "dinext_projects_pl.tests.liquidity_ui_helpers.bootstrap")
	log_path = Path(os.environ["RUNNER_TEMP"]) / "liquidity-web.log"
	socket_log = Path(os.environ["RUNNER_TEMP"]) / "liquidity-socketio.log"
	with log_path.open("w") as log, socket_log.open("w") as realtime_log:
		server = subprocess.Popen(
			["bench", "--site", site, "serve", "--port", "8001", "--noreload"],
			cwd=bench,
			env=env,
			stdout=log,
			stderr=subprocess.STDOUT,
		)
		realtime = subprocess.Popen(
			["node", "apps/frappe/socketio.js"],
			cwd=bench,
			env=env,
			stdout=realtime_log,
			stderr=subprocess.STDOUT,
		)
		try:
			deadline = time.monotonic() + 60
			while True:
				if any(process.poll() is not None for process in (server, realtime)):
					raise RuntimeError("Development HTTP/Socket.IO server exited before becoming ready")
				try:
					for url in (
						env["LIQUIDITY_TEST_URL"] + "/api/method/frappe.ping",
						"http://127.0.0.1:9000/socket.io/?EIO=4&transport=polling",
					):
						with urllib.request.urlopen(url, timeout=2) as response:
							assert response.status == 200
					break
				except (urllib.error.URLError, TimeoutError):
					if time.monotonic() > deadline:
						raise RuntimeError("Development server did not become ready") from None
					time.sleep(1)
			run(
				"bench",
				"--site",
				site,
				"run-ui-tests",
				"dinext_projects_pl",
				"--headless",
				"--browser",
				"electron",
			)
		finally:
			for process in (server, realtime):
				process.terminate()
				try:
					process.wait(timeout=15)
				except subprocess.TimeoutExpired:
					process.kill()
					process.wait()
			credentials.unlink(missing_ok=True)

	reports = sorted((app / "cypress/results").glob("liquidity-*.xml"))
	cases = [case for report in reports for case in ET.parse(report).iter("testcase")]
	assert len(cases) == 63, f"Expected all 63 UI cases, found {len(cases)}"
	assert len({case.attrib["name"] for case in cases}) == 63, "Duplicate UI cases"
	assert not any(case.find(tag) is not None for case in cases for tag in ("failure", "error", "skipped"))
	with Path(os.environ["GITHUB_STEP_SUMMARY"]).open("a") as summary:
		summary.write(
			"### Liquidity UI acceptance\n\n63 passed; 0 failures/errors/skips. Real ERPNext documents and browser.\n"
		)
	# A separate CLI run after the browser has stopped makes the 10k performance
	# gate reproducible on the declared hosted runner, without competing tests.
	try:
		run("bench", "--site", site, "execute", "dinext_projects_pl.tests.liquidity_ui_helpers.bootstrap")
		run(
			"bench",
			"--site",
			site,
			"execute",
			"dinext_projects_pl.tests.liquidity_benchmark.run",
			"--kwargs",
			json.dumps({"chains": 2000, "repetitions": 5}),
		)
	finally:
		credentials.unlink(missing_ok=True)
	result = json.loads(Path("/tmp/liquidity-benchmark.json").read_text())
	result["runner_environment"] = {
		"platform": platform.platform(),
		"logical_cpus": os.cpu_count(),
		"github_sha": os.environ["GITHUB_SHA"],
		"run_id": os.environ["GITHUB_RUN_ID"],
	}
	(Path(os.environ["RUNNER_TEMP"]) / "liquidity-benchmark.json").write_text(json.dumps(result, indent=2))
	assert result["source_documents"] == 10000 and result["chains"] == 2000
	assert result["user_mode"] == "financier" and result["settings_version"] and result["code_sha256"]
	measurements = result["measurements"]
	assert len(measurements) == 10
	assert all(record["passed"] and record["queries"] > 0 for record in measurements)
	for operation, limit in (("summary", 5), ("details", 2)):
		values = [record["seconds"] for record in measurements if record["operation"] == operation]
		assert len(values) == 5
		with Path(os.environ["GITHUB_STEP_SUMMARY"]).open("a") as summary:
			summary.write(f"\n10,000-source {operation}: {values}; target ≤{limit}s for every run.\n")
		assert all(0 < value <= limit for value in values), (operation, values, limit)


if __name__ == "__main__":
	main()
