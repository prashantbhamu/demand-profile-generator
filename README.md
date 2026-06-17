# Demand Projection Tool

Local browser application for generating future demand profiles from a historical demand profile and annual peak and energy projections.

## What It Does

The tool:

1. reads a historical demand profile;
2. maps it to each future calendar while preserving weekday behaviour;
3. scales each projection year to its peak-demand and energy targets; and
4. writes the projected interval-level demand to CSV.

Profiles with 24, 48, or 96 periods per day are supported.

## Run From Source

Python 3.10 or later is required. From the project root, run:

```powershell
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

- a base demand-profile CSV;
- an annual peak-projection CSV in MW;
- an annual energy-projection CSV in GWh;
- the base profile's start and end dates;
- the first and last projection years; and
- an output folder.

The preferred base-profile columns are:

```text
Month,Day,Period,<demand value>
```

A sequential CSV containing one usable numeric profile column is also supported. Peak and energy projection files require a `DateTime` column and one numeric value column.

## Output

The generated CSV contains:

```text
year,month,day,period,projected demand
```

Projected demand is written as whole MW. If the intended filename already exists, a timestamp is added instead of overwriting it.

## Results And Chart

The interface reports annual row count, achieved peak, achieved energy, and year-on-year peak and energy growth. It also compares the calendar-mapped base profile with the projected profile using peak-normalized chart series, with year selection, hover details, zoom, pan, reset, and fullscreen controls.

## Source Structure

```text
profile_tool/
|-- __main__.py       Application entry point
|-- app.py            Local server and request handling
|-- core.py           Parsing, calendar mapping, scaling, validation, and output
`-- static/           Browser interface, styling, and chart behaviour
```
