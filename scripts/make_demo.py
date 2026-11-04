"""Create the synthetic SQLite and CSV fixtures used by the browser demo."""
import csv
import math
import random
import sqlite3
from datetime import date, timedelta
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "data"
columns = ("account", "date", "nav", "eq", "cap", "risk")
rows = []
for index, name in enumerate(("Demo Atlas", "Demo Birch", "Demo Cedar")):
    rng = random.Random(4700 + index)
    nav = 1.0
    day = date(2025, 1, 6) + timedelta(days=7 * index)
    for n in range(126):
        while day.weekday() >= 5:
            day += timedelta(days=1)
        if n:
            nav *= 1 + 0.0005 + 0.003 * math.sin(n / 9 + index) + rng.gauss(0, 0.003 + index * 0.001)
        risk = round(34 + 12 * math.sin(n / 13 + index) + rng.random() * 4, 2)
        eq = round(nav * (100000 + 20000 * index), 2)
        rows.append((name, day.isoformat(), round(nav, 8), eq, round(eq * risk / 100, 2), risk))
        day += timedelta(days=1)

with (DATA / "demo-accounts.csv").open("w", newline="") as output:
    writer = csv.writer(output)
    writer.writerow(columns)
    writer.writerows(rows)
with sqlite3.connect(DATA / "demo.sqlite") as db:
    db.execute("DROP TABLE IF EXISTS observations")
    db.execute("""CREATE TABLE observations (
        account TEXT NOT NULL, date TEXT NOT NULL, nav REAL NOT NULL CHECK(nav > 0),
        eq REAL, cap REAL, risk REAL, PRIMARY KEY(account,date))""")
    db.executemany("INSERT INTO observations VALUES (?,?,?,?,?,?)", rows)
