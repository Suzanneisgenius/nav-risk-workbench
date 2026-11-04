"""Build the offline entry point using only Python's standard library."""
import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
with sqlite3.connect(ROOT / "data/demo.sqlite") as db:
    db.row_factory = sqlite3.Row
    rows = [dict(r) for r in db.execute("SELECT * FROM observations ORDER BY account,date")]
state = {"source": "Synthetic demo", "demo": True, "mode": "strict", "rows": rows}
page = (ROOT / "src/page.html").read_text()
for marker, path in (("STYLE", "src/style.css"), ("CHART", "vendor/chart.umd.js"),
                     ("XLSX", "vendor/xlsx.full.min.js"), ("MARKET", "data/spy-ief.json"),
                     ("ENGINE", "src/analysis.js"), ("APP", "src/app.js")):
    page = page.replace("{{" + marker + "}}", (ROOT / path).read_bytes().decode())
page = page.replace("{{STATE}}", json.dumps(state, separators=(",", ":")).replace("<", r"\u003c"))
(ROOT / "index.html").write_bytes(page.encode())
