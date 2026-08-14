# Demand Projection Tool

Local browser application for generating future demand profiles from a historical demand profile and annual peak and energy projections.

## What It Does

The tool:

1. reads a historical demand profile;
2. maps it to each future financial year while preserving weekday behaviour;
3. scales each projection year to its peak-demand and energy targets; and
4. writes the projected interval-level demand to CSV.

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

When **Rooftop Solar Adjustment** is enabled, the interface also accepts:

- a cumulative FY-end rooftop-capacity trajectory in MW; and
- a normalized rooftop generation profile in daily, monthly, or annual mode.

The preferred rooftop trajectory columns are:

```text
Financial Year,Cumulative MW
```

The preferred rooftop-profile columns are:

```text
Daily:  Period,Rooftop CF
Monthly: Month,Period,Rooftop CF
Annual: Month,Day,Period,Rooftop CF
```

`Rooftop CF` must be between 0 and 1. Rooftop and demand profiles must use the
same 24- or 96-period resolution. Sparse cumulative-capacity milestones are
linearly interpolated, but the trajectory must include the reference-FY baseline
and cover the final projection FY.

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
Financial Year,year,month,day,period,projected demand
```

`Financial Year` identifies the projection block using `YYYY-YY`. Projected demand
is written as whole MW. If the intended filename already exists, a timestamp is
added instead of overwriting it.

Rooftop-adjusted runs write `<profile_name>_rooftop_adjusted.csv` with the
before-rooftop demand, incremental rooftop capacity, incremental rooftop
generation, and final adjusted demand at three-decimal precision. Negative final
demand is retained as net export.

## Results And Chart

The interface reports annual row count, achieved peak, achieved energy, and year-on-year peak and energy growth. It also compares the calendar-mapped base profile with the projected profile using peak-normalized chart series, with year selection, hover details, zoom, pan, reset, and fullscreen controls.

Rooftop-mode results instead compare before- and after-rooftop peak and energy,
rooftop generation and CUF, FY-end rooftop capacity, minimum demand, and the
adjusted peak interval. Its chart uses an absolute-MW axis with before-rooftop,
adjusted-demand, and rooftop-generation series.

## Source Structure

```text
profile_tool/
|-- __main__.py       Application entry point
|-- app.py            Local server and request handling
|-- core.py           Parsing, calendar mapping, scaling, validation, and output
`-- static/           Browser interface, styling, and chart behaviour
```
