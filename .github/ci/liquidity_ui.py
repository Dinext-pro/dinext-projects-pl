"""Run real browser acceptance on the disposable bench prepared by Dinext CI."""

import json
import os
from pathlib import Path
import subprocess
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET


def main():
    bench = Path(os.environ["RUNNER_TEMP"]) / "dinext-test-bench"
    app = bench / "apps/dinext_projects_pl"
    credentials = Path("/tmp/liquidity-ui-context.json")
    site = "ci.test"
    env = dict(os.environ, DEV_SERVER="1", LIQUIDITY_TEST_URL="http://127.0.0.1:8001")
    env.pop("ELECTRON_RUN_AS_NODE", None)
    env.pop("CYPRESS_liquidityTestPattern", None)
    env["CYPRESS_reporter"] = "junit"
    env["CYPRESS_reporterOptions"] = json.dumps(
        {"mochaFile": "cypress/results/liquidity-[hash].xml", "toConsole": True}
    )

    def run(*args):
        subprocess.run(args, cwd=bench, env=env, check=True, timeout=1200)

    run("bench", "use", site)
    run("bench", "--site", site, "set-config", "developer_mode", "1")
    run("bench", "--site", site, "execute", "dinext_projects_pl.tests.liquidity_ui_helpers.bootstrap")
    log_path = Path(os.environ["RUNNER_TEMP"]) / "liquidity-web.log"
    with log_path.open("w") as log:
        server = subprocess.Popen(
            ["bench", "--site", site, "serve", "--port", "8001", "--noreload"],
            cwd=bench, env=env, stdout=log, stderr=subprocess.STDOUT,
        )
        try:
            deadline = time.monotonic() + 60
            while True:
                if server.poll() is not None:
                    raise RuntimeError("Development server exited before becoming ready")
                try:
                    with urllib.request.urlopen(env["LIQUIDITY_TEST_URL"] + "/api/method/ping", timeout=2) as response:
                        if response.status == 200:
                            break
                except (urllib.error.URLError, TimeoutError):
                    if time.monotonic() > deadline:
                        raise RuntimeError("Development server did not become ready") from None
                    time.sleep(1)
            run("bench", "--site", site, "run-ui-tests", "dinext_projects_pl", "--headless", "--browser", "electron")
        finally:
            server.terminate()
            try:
                server.wait(timeout=15)
            except subprocess.TimeoutExpired:
                server.kill()
                server.wait()
            credentials.unlink(missing_ok=True)

    reports = sorted((app / "cypress/results").glob("liquidity-*.xml"))
    cases = [case for report in reports for case in ET.parse(report).iter("testcase")]
    assert len(cases) == 30, f"Expected all 30 UI cases, found {len(cases)}"
    assert len({case.attrib["name"] for case in cases}) == 30, "Duplicate UI cases"
    assert not any(case.find(tag) is not None for case in cases for tag in ("failure", "error", "skipped"))
    with Path(os.environ["GITHUB_STEP_SUMMARY"]).open("a") as summary:
        summary.write("### Liquidity UI acceptance\n\n30 passed; 0 failures/errors/skips. Real ERPNext documents and browser.\n")


if __name__ == "__main__":
    main()
