# Demand Projection Tool

Local browser application for generating future demand profiles from a historical demand profile and annual peak and energy projections.

## What It Does

The tool:

1. reads a historical demand profile;
2. maps it to each future financial year while preserving weekday behaviour;
3. scales each projection year to its peak-demand and energy targets; and
4. classifies every interval into a configurable solar/non-solar planning period; and
5. writes the projected interval-level demand to CSV.

Profiles with 24 or 96 periods per day are supported.

An optional rooftop-solar scenario can subtract generation from rooftop capacity
added after the reference financial year. The original peak and energy targets
remain the before-rooftop counterfactual.

## Run From Source

Python 3.10 or later is required. Install the workbook dependency, then run:

```powershell
python -m pip install -r requirements.txt
python -m profile_tool
```

The application starts a local server and opens the interface in the default browser.

To use a fixed port without automatically opening a browser:

```powershell
python -m profile_tool --no-browser --port 8765
```

Then open `http://127.0.0.1:8765/`. Stop the application with `Ctrl+C`.

## Inputs

The interface accepts:

- a base demand-profile CSV or XLSX file;
- an annual peak-projection CSV or XLSX file in MW;
- an annual energy-projection CSV or XLSX file in GWh;
- the base financial year, running from 1 April through 31 March;
- the first and last projection financial years; and
- an output folder.

The solar period defaults to 06:00–18:00 and can be changed in the interface.
Its boundaries must align with the detected hourly or 15-minute profile
resolution. The classification is derived by the tool and requires no input
column.

Base, peak, and energy uploads are validated when selected. Structural errors
are shown in the upload step; compatibility with the configured base and
projection financial years is checked in the configuration step.

When **Rooftop Solar Adjustment** is enabled, the interface also accepts:

- a cumulative FY-end rooftop-capacity trajectory in MW; and
- a normalized rooftop generation profile in daily, monthly, or annual mode.

The preferred rooftop trajectory columns are:

```text
Financial Year,Cumulative MW
```

The preferred rooftop-profile columns are:

```text
Daily:  Period,Normalized value (p.u.)
Monthly: Month,Period,Normalized value (p.u.)
Annual: Month,Day,Period,Normalized value (p.u.)
```

`Normalized value (p.u.)` must be between 0 and 1. Rooftop and demand profiles
must use the same 24- or 96-period resolution. Sparse cumulative-capacity
milestones are linearly interpolated, but the trajectory must include the
reference-FY baseline and cover the final projection FY.

Financial years are entered as `YYYY-YY`. Entering a four-digit start year such as
`2025` automatically completes it to `2025-26`.

The preferred base-profile columns are:

```text
Month,Day,Period,<demand value>
```

A sequential file containing one usable numeric profile column is also supported. Peak and energy projection files require a `DateTime` column and one numeric value column. For XLSX workbooks, the active populated worksheet is read first.

## Output

The generated CSV contains:

```text
Financial Year,year,month,day,period,Period classification,projected demand
```

`Financial Year` identifies the projection block using `YYYY-YY`. Projected demand
is written as whole MW. If the intended filename already exists, a timestamp is
added instead of overwriting it.

`Period classification` is `Solar` when the interval starts inside the configured
solar window and `Non-solar` otherwise. The start boundary is inclusive and the
end boundary is exclusive.

Rooftop-adjusted runs write `<profile_name>_rooftop_adjusted.csv` with the
before-rooftop demand, incremental rooftop capacity, incremental rooftop
generation, and final adjusted demand at three-decimal precision. Negative final
demand is retained as net export.

## Results And Chart

The interface reports annual row count, achieved peak, achieved energy, and
year-on-year peak and energy growth. It also compares the calendar-mapped base
profile with the projected profile using peak-normalized chart series, with year
selection, hover details, zoom, pan, reset, and fullscreen controls. Vertical
guides follow calendar month, week, day, and six-hour boundaries as the view is
zoomed or panned.

A sun/crescent-moon control switches the summary between solar-period and non-solar-
period peak magnitude, timing, and growth while retaining the overall annual
peak.

Rooftop-mode results compare unadjusted and adjusted peak, peak timing, and
energy; cumulative FY-end rooftop capacity; rooftop generation; minimum demand;
and projected CUF. Its chart uses an
absolute-MW axis with unadjusted-demand, adjusted-demand, and rooftop-generation
series.

For rooftop runs, the solar/non-solar summary reports before- and after-rooftop
peaks and timings plus the reduction in each period class.

## Source Structure

```text
profile_tool/
|-- __main__.py       Application entry point
|-- app.py            Local server and request handling
|-- core.py           Parsing, calendar mapping, scaling, validation, and output
`-- static/           Browser interface, styling, and chart behaviour
```
