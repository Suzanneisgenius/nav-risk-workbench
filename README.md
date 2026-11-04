# NAV Risk Workbench

A browser-based workspace for exploring how daily net asset value (NAV), exposure and momentum change across several accounts. Open a demo account, inspect a flagged date, then switch alert modes to see how the same score is classified.

**[Open the interactive demo](https://suzanneisgenius.github.io/nav-risk-workbench/)** · [Download the demo CSV](data/demo-accounts.csv) · [Download the SQLite database](data/demo.sqlite)

![Account monitor showing synthetic NAV, drawdown, exposure and volatility](docs/account-monitor.png)

## Try it

1. Open the live demo or download and open `index.html` in a modern browser. The standalone file includes the chart and spreadsheet libraries and works offline.
2. Switch between **Demo Atlas**, **Demo Birch** and **Demo Cedar**. The database contains 126 generated weekday observations per account, each with its own start date. The series are synthetic and illustrate the interface.
3. Switch **Strict** to **Normal**. Inspect the account level or compare alert history for the same date.
4. Choose **Excel template** or use the demo CSV. Choose **Upload data** and select one or more files. To combine the accounts, open **Scoring settings → Enable combined NAV**, then choose the combined series in the account monitor.

## Alert modes

Both modes use the same observations, six configurable rules, raw scores, return series, drawdowns and slopes. Mode determines the point total required to enter each alert level. Strict uses the configured cutoffs. Normal adds one point to each cutoff.

| Balanced profile | Watch | Elevated | High |
| --- | ---: | ---: | ---: |
| Strict (default) | 1 | 3 | 5 |
| Normal | 2 | 4 | 6 |

For example, a score of **3.0** is **Elevated** in Strict and **Watch** in Normal. Below the Watch cutoff, the level is Low. A score equal to a cutoff enters that level. Selecting a different preset or editing a rule updates the active cutoffs shown beside the selector. The independent slope lab uses its own fixed thresholds.

## Bring your own accounts

Use CSV, XLSX or XLS. The importer reads every worksheet with a recognized header. Put multiple accounts in one table, split them across sheets, or select several files together.

| Column | Meaning |
| --- | --- |
| `account` | Account identifier. If the column is absent, the filename without its extension identifies the series. |
| `date` | Observation date. Use ISO `YYYY-MM-DD` for portability. Excel date cells are supported. |
| `nav` | Positive unit NAV. Supply NAV, positive equity, or both. |
| `eq` | Account equity. Equity-only histories are rebased to their earliest positive equity. A row with both equity and NAV can anchor a mixed series. |
| `cap` | Capital in use, in the same currency units as equity. Used to derive exposure when risk is missing. |
| `risk` | Exposure percentage. `35`, `35%` and `0.35` mean 35%. Use an explicit percent sign for low values such as `0.5%`. |

The first successful import replaces the demo accounts. Further imports merge on **account and date**. For repeated keys, the last incoming row replaces the earlier row. Files in one selection are applied together. The importer reports skipped rows and retains the current workspace if a selected file has no usable observations. Missing dates stay missing. Exposure-dependent rules require exposure data.

**Combined NAV** averages rebased account NAVs with equal starting weights. It starts at 1 on the earliest date shared by every account and uses only common dates. The combined series is computed for display and excluded from signal-study counts. “Multi-account” refers to monitoring multiple account series together in one local browser session.

**Save snapshot** downloads a standalone HTML file containing the open workspace's data, scoring settings and mode. Uploads are processed in memory. Reload the original demo to return to the generated accounts.

## Workspace views

| View | What to inspect |
| --- | --- |
| Account monitor | Account switcher, current score and review note, NAV/drawdown toggle, four metric histories, 3/5/10-observation slopes, exposure versus volatility, and the latest 40 signal dates. |
| Stocks & bonds | Separate SPY/IEF course study with 5,536 aligned return observations. Compare historical periods and 30/90/252-session correlation windows, rebased returns and daily volatility. Export the selected period as CSV. |
| Signal study | Five signal families, the lower-exposure comparison group, slope-gap buckets, and five-observation forward outcomes against the workspace baseline. |
| Slope lab | Paste dated or undated NAV or equity values, run the independent warning check, and inspect the most recent 60 observations. |
| Scoring settings | Sensitive, Balanced and Conservative presets, custom weights and thresholds, rule toggles, in-sample calibration, capacity planning and combined NAV. |

The signal study measures the worst return relative to the signal-date NAV over the following five observations, floored in magnitude at zero for a series that stays above the starting value. Incomplete forward windows are excluded. Overlapping windows can share observations. Calibration describes the loaded sample and does not establish predictive accuracy.

## Reproduce the demo

`data/demo.sqlite` contains the table `observations` with primary key `(account, date)`. The CSV contains the same rows. The page embeds a snapshot of SQLite at build time. No database server is required.

```sh
python3 scripts/make_demo.py
python3 scripts/build.py
node tests/analytics.cjs
```

The Python scripts use the standard library. `src/` holds the editable HTML, styles and JavaScript. Open the rebuilt `index.html` directly or serve the directory as a static site.

## Data and credits

- **Account monitor.** The published account series, tool example and Excel template are generated demonstration data. All account-specific statistics are calculated from the currently loaded records.
- **Stocks & bonds.** The historical market snapshot is independent of the account demo. It retains the SPY/IEF return series from the course project by Joylyn Qiao and Zun Cao. The original notebook used Yahoo Finance adjusted closing prices. [Course notebook](https://github.com/Wirepullerrr/Comprehensive-analysis-of-U.S.-stock-and-bond-market/blob/main/Presentation%20CS329E.ipynb)
- **Bundled libraries.** Chart.js 4.4.1 renders the charts. SheetJS Community Edition 0.20.3 reads and writes workbooks. License texts are in `vendor/`. [Chart.js](https://www.chartjs.org/) · [SheetJS](https://docs.sheetjs.com/docs/getting-started/installation/standalone/)
