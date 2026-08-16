import csv
import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path

from profile_tool.core import (
    ProfileGenerationError,
    expand_rooftop_profile,
    fiscal_year_label,
    generate_profiles,
    inspect_base_profile,
    inspect_targets,
    interpolate_rooftop_capacity,
    load_rooftop_profile,
    load_rooftop_trajectory,
    period_classification,
    summaries_as_dicts,
    validate_rooftop_trajectory_coverage,
)


class GenerateProfilesFinancialYearTests(unittest.TestCase):
    def test_financial_year_labels_match_shared_cross_runtime_cases(self) -> None:
        cases_path = Path(__file__).with_name("financial_year_cases.json")
        cases = json.loads(cases_path.read_text(encoding="utf-8"))

        for financial_year_case in cases:
            with self.subTest(financial_year_case=financial_year_case):
                self.assertEqual(
                    fiscal_year_label(financial_year_case["start_year"]),
                    financial_year_case["label"],
                )

    def _write_inputs(
        self,
        root: Path,
        base_day_count: int = 366,
        periods_per_day: int = 24,
    ) -> tuple[Path, Path, Path]:
        base_path = root / "base.csv"
        with base_path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.writer(handle)
            writer.writerow(["demand"])
            for _day in range(base_day_count):
                for period in range(periods_per_day):
                    writer.writerow([100 + period])

        interval_hours = 24 / periods_per_day
        energy_gwh = (
            sum(100 + period for period in range(periods_per_day))
            * interval_hours
            * 365
            / 1000
        )
        peak_mw = 100 + periods_per_day - 1
        peak_path = root / "peak.csv"
        energy_path = root / "energy.csv"
        with peak_path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.writer(handle)
            writer.writerow(["DateTime", "target"])
            writer.writerow(["2025-04-01", peak_mw])
            writer.writerow(["2026-04-01", peak_mw])
        with energy_path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.writer(handle)
            writer.writerow(["DateTime", "target"])
            writer.writerow(["2025-04-01", energy_gwh])
            writer.writerow(["2026-04-01", energy_gwh])
        return base_path, peak_path, energy_path

    def test_generated_csv_starts_with_financial_year_column(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            base_path, peak_path, energy_path = self._write_inputs(root)

            result = generate_profiles(
                base_profile_path=base_path,
                peak_projection_path=peak_path,
                energy_projection_path=energy_path,
                base_start_date=dt.date(2023, 4, 1),
                base_end_date=dt.date(2024, 3, 31),
                projection_start_year=2025,
                projection_end_year=2026,
                output_dir=root,
                profile_name="test",
            )

            with result.output_path.open(newline="", encoding="utf-8") as handle:
                rows = list(csv.reader(handle))

            self.assertEqual(
                rows[0],
                [
                    "Financial Year",
                    "year",
                    "month",
                    "day",
                    "period",
                    "Period classification",
                    "projected demand",
                ],
            )
            self.assertEqual(rows[1][0], "2025-26")
            self.assertEqual(rows[8760][0], "2025-26")
            self.assertEqual(rows[8761][0], "2026-27")
            self.assertEqual(rows[-1][0], "2026-27")
            self.assertEqual(
                result.output_path.name,
                "test_projected_demand_2025_2026.csv",
            )
            self.assertEqual(rows[1][1:5], ["2025", "4", "1", "1"])
            self.assertAlmostEqual(float(rows[1][-1]), 100.0, places=9)
            self.assertAlmostEqual(result.summaries[0].achieved_peak_mw, 123.0)
            expected_energy_gwh = (
                sum(100 + period for period in range(24)) * 365 / 1000
            )
            self.assertAlmostEqual(
                result.summaries[0].achieved_energy_gwh,
                expected_energy_gwh,
                places=9,
            )

    def test_default_solar_window_classifies_hourly_and_quarter_hour_periods(self) -> None:
        expected = {
            24: {6: "Non-solar", 7: "Solar", 18: "Solar", 19: "Non-solar"},
            96: {24: "Non-solar", 25: "Solar", 72: "Solar", 73: "Non-solar"},
        }
        for periods_per_day, cases in expected.items():
            for period, classification in cases.items():
                with self.subTest(periods_per_day=periods_per_day, period=period):
                    self.assertEqual(
                        period_classification(period, periods_per_day, 360, 1080),
                        classification,
                    )

    def test_normal_generation_exports_classification_and_split_peaks(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            base_path, peak_path, energy_path = self._write_inputs(
                root, base_day_count=365, periods_per_day=24
            )
            result = generate_profiles(
                base_profile_path=base_path,
                peak_projection_path=peak_path,
                energy_projection_path=energy_path,
                base_start_date=dt.date(2024, 4, 1),
                base_end_date=dt.date(2025, 3, 31),
                projection_start_year=2025,
                projection_end_year=2025,
                output_dir=root,
            )
            with result.output_path.open(newline="", encoding="utf-8") as handle:
                rows = list(csv.DictReader(handle))
            first_day = rows[:24]
            self.assertEqual(first_day[5]["Period classification"], "Non-solar")
            self.assertEqual(first_day[6]["Period classification"], "Solar")
            self.assertEqual(first_day[17]["Period classification"], "Solar")
            self.assertEqual(first_day[18]["Period classification"], "Non-solar")
            summary = result.summaries[0]
            self.assertEqual(summary.solar_peak_mw, 117.0)
            self.assertEqual(summary.solar_peak_period, 18)
            self.assertEqual(summary.non_solar_peak_mw, 123.0)
            self.assertEqual(summary.non_solar_peak_period, 24)

    def test_custom_solar_window_must_align_to_profile_resolution(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            base_path, peak_path, energy_path = self._write_inputs(
                root, base_day_count=365, periods_per_day=24
            )
            with self.assertRaisesRegex(ProfileGenerationError, "align to 60-minute"):
                generate_profiles(
                    base_profile_path=base_path,
                    peak_projection_path=peak_path,
                    energy_projection_path=energy_path,
                    base_start_date=dt.date(2024, 4, 1),
                    base_end_date=dt.date(2025, 3, 31),
                    projection_start_year=2025,
                    projection_end_year=2025,
                    output_dir=root,
                    solar_start_minutes=375,
                    solar_end_minutes=1080,
                )

    def test_custom_aligned_window_drives_csv_and_split_peak_timing(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            base_path, peak_path, energy_path = self._write_inputs(
                root, base_day_count=365, periods_per_day=24
            )
            result = generate_profiles(
                base_profile_path=base_path,
                peak_projection_path=peak_path,
                energy_projection_path=energy_path,
                base_start_date=dt.date(2024, 4, 1),
                base_end_date=dt.date(2025, 3, 31),
                projection_start_year=2025,
                projection_end_year=2025,
                output_dir=root,
                solar_start_minutes=420,
                solar_end_minutes=1140,
            )
            with result.output_path.open(newline="", encoding="utf-8") as handle:
                rows = list(csv.DictReader(handle))
            self.assertEqual(rows[6]["Period classification"], "Non-solar")
            self.assertEqual(rows[7]["Period classification"], "Solar")
            self.assertEqual(rows[18]["Period classification"], "Solar")
            self.assertEqual(rows[19]["Period classification"], "Non-solar")
            summary = result.summaries[0]
            self.assertEqual(summary.solar_peak_period, 19)
            self.assertEqual(summary.non_solar_peak_period, 24)

    def test_upload_inspection_reports_resolution_and_rejects_duplicate_targets(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            base_path, peak_path, _ = self._write_inputs(
                root, base_day_count=365, periods_per_day=96
            )
            inspection = inspect_base_profile(base_path)
            self.assertEqual(inspection.periods_per_day, 96)
            self.assertEqual(inspection.day_count, 365)
            with peak_path.open("a", newline="", encoding="utf-8") as handle:
                csv.writer(handle).writerow(["2025-08-01", 200])
            with self.assertRaisesRegex(ProfileGenerationError, "duplicate target year"):
                inspect_targets(peak_path)

    def test_upload_inspection_reports_partial_calendar_schema(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "partial.csv"
            path.write_text("Month,Day,Value\n4,1,1.0\n", encoding="utf-8")

            with self.assertRaisesRegex(ProfileGenerationError, "missing: Period"):
                inspect_base_profile(path)

    def test_generation_rejects_calendar_year_base_period(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)

            with self.assertRaisesRegex(
                ProfileGenerationError,
                "Base period must run from 1 April through 31 March",
            ):
                generate_profiles(
                    base_profile_path=root / "missing-base.csv",
                    peak_projection_path=root / "missing-peak.csv",
                    energy_projection_path=root / "missing-energy.csv",
                    base_start_date=dt.date(2024, 1, 1),
                    base_end_date=dt.date(2024, 12, 31),
                    projection_start_year=2025,
                    projection_end_year=2025,
                    output_dir=root,
                )

    def test_supported_period_counts_generate_for_default_base_fy(self) -> None:
        for periods_per_day in (24, 96):
            with self.subTest(periods_per_day=periods_per_day):
                with tempfile.TemporaryDirectory() as temp_dir:
                    root = Path(temp_dir)
                    base_path, peak_path, energy_path = self._write_inputs(
                        root,
                        base_day_count=365,
                        periods_per_day=periods_per_day,
                    )

                    result = generate_profiles(
                        base_profile_path=base_path,
                        peak_projection_path=peak_path,
                        energy_projection_path=energy_path,
                        base_start_date=dt.date(2024, 4, 1),
                        base_end_date=dt.date(2025, 3, 31),
                        projection_start_year=2025,
                        projection_end_year=2025,
                        output_dir=root,
                    )

                    self.assertEqual(result.rows_written, 365 * periods_per_day)

    def test_generation_rejects_retired_48_period_profile(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            base_path, peak_path, energy_path = self._write_inputs(
                root, base_day_count=365, periods_per_day=48
            )

            with self.assertRaisesRegex(
                ProfileGenerationError, "48-period demand profiles are no longer supported"
            ):
                generate_profiles(
                    base_profile_path=base_path,
                    peak_projection_path=peak_path,
                    energy_projection_path=energy_path,
                    base_start_date=dt.date(2024, 4, 1),
                    base_end_date=dt.date(2025, 3, 31),
                    projection_start_year=2025,
                    projection_end_year=2025,
                    output_dir=root,
                )

    def _write_rooftop_profile(
        self, root: Path, mode: str, periods_per_day: int = 24, cf: float = 0.5
    ) -> Path:
        path = root / f"rooftop-{mode}.csv"
        with path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.writer(handle)
            if mode == "daily":
                writer.writerow(["Period", "Normalized value (p.u.)"])
                for period in range(1, periods_per_day + 1):
                    writer.writerow([period, cf])
            elif mode == "monthly":
                writer.writerow(["Month", "Period", "Normalized value (p.u.)"])
                for month in range(1, 13):
                    for period in range(1, periods_per_day + 1):
                        writer.writerow([month, period, cf])
            else:
                writer.writerow(
                    ["Month", "Day", "Period", "Normalized value (p.u.)"]
                )
                day = dt.date(2023, 1, 1)
                while day <= dt.date(2023, 12, 31):
                    for period in range(1, periods_per_day + 1):
                        writer.writerow([day.month, day.day, period, cf])
                    day += dt.timedelta(days=1)
        return path

    def _write_rooftop_trajectory(self, root: Path, final_capacity: float = 200) -> Path:
        path = root / "rooftop-trajectory.csv"
        with path.open("w", newline="", encoding="utf-8") as handle:
            writer = csv.writer(handle)
            writer.writerow(["Financial Year", "Cumulative MW"])
            writer.writerow(["2024-25", 100])
            writer.writerow(["2025-26", final_capacity])
        return path

    def test_rooftop_profile_modes_and_leap_day_expansion(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            for mode, expected_rows in (
                ("daily", 24),
                ("monthly", 12 * 24),
                ("annual", 365 * 24),
            ):
                with self.subTest(mode=mode):
                    profile = load_rooftop_profile(
                        self._write_rooftop_profile(root, mode), mode
                    )
                    self.assertEqual(profile.row_count, expected_rows)
                    self.assertAlmostEqual(profile.template_cuf, 0.5)
                    expanded = expand_rooftop_profile(
                        profile, [dt.date(2024, 2, 28), dt.date(2024, 2, 29), dt.date(2024, 3, 1)]
                    )
                    self.assertEqual(len(expanded), 3 * 24)
                    self.assertTrue(all(value == 0.5 for value in expanded))

    def test_sparse_rooftop_trajectory_interpolates_without_extrapolation(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            trajectory_path = root / "trajectory.csv"
            with trajectory_path.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.writer(handle)
                writer.writerow(["FY", "Capacity MW"])
                writer.writerow(["2024-25", 100])
                writer.writerow(["2026-27", 300])
            trajectory = load_rooftop_trajectory(trajectory_path)
            self.assertAlmostEqual(
                interpolate_rooftop_capacity(trajectory, dt.datetime(2026, 4, 1)),
                200,
                places=6,
            )
            with self.assertRaisesRegex(ProfileGenerationError, "extrapolation"):
                interpolate_rooftop_capacity(trajectory, dt.datetime(2028, 4, 1))

    def test_rooftop_generation_exports_auditable_adjusted_profile(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            base_path, peak_path, energy_path = self._write_inputs(
                root, base_day_count=365, periods_per_day=24
            )
            profile_path = self._write_rooftop_profile(root, "daily", cf=0.5)
            trajectory_path = self._write_rooftop_trajectory(root)

            result = generate_profiles(
                base_profile_path=base_path,
                peak_projection_path=peak_path,
                energy_projection_path=energy_path,
                base_start_date=dt.date(2024, 4, 1),
                base_end_date=dt.date(2025, 3, 31),
                projection_start_year=2025,
                projection_end_year=2025,
                output_dir=root,
                profile_name="utility",
                rooftop_profile_path=profile_path,
                rooftop_trajectory_path=trajectory_path,
                rooftop_profile_mode="daily",
            )

            self.assertEqual(result.output_path.name, "utility_rooftop_adjusted.csv")
            with result.output_path.open(newline="", encoding="utf-8") as handle:
                rows = list(csv.DictReader(handle))
            self.assertEqual(len(rows), 365 * 24)
            for row in (rows[0], rows[len(rows) // 2], rows[-1]):
                before = float(row["demand before rooftop"])
                generation = float(row["incremental rooftop generation"])
                adjusted = float(row["projected demand"])
                self.assertAlmostEqual(adjusted, before - generation, places=3)
            self.assertEqual(rows[0]["incremental rooftop capacity"], "0.000")
            self.assertAlmostEqual(
                result.summaries[0].rooftop_effective_cuf_percent, 50.0, places=9
            )
            self.assertEqual(result.graph["normalization"], "absolute_mw")
            self.assertEqual(result.graph["years"][0]["label"], "2025-26")
            self.assertEqual(
                result.graph["years"][0]["before_rooftop"]["label"],
                "Unadjusted demand",
            )
            summary = result.summaries[0]
            self.assertIsNotNone(summary.unadjusted_peak_date)
            self.assertIsNotNone(summary.unadjusted_peak_period)
            summary_payload = summaries_as_dicts(result.summaries)[0]
            self.assertEqual(
                summary_payload["unadjusted_peak_date"],
                summary.unadjusted_peak_date,
            )
            self.assertEqual(
                summary_payload["unadjusted_peak_period"],
                summary.unadjusted_peak_period,
            )
            self.assertIsNotNone(summary.before_rooftop_solar_peak_mw)
            self.assertIsNotNone(summary.before_rooftop_non_solar_peak_mw)
            self.assertAlmostEqual(
                summary.solar_peak_reduction_mw,
                summary.before_rooftop_solar_peak_mw - summary.solar_peak_mw,
            )
            self.assertAlmostEqual(
                summary.non_solar_peak_reduction_mw,
                summary.before_rooftop_non_solar_peak_mw
                - summary.non_solar_peak_mw,
            )
            for classification, prefix in (("Solar", "solar"), ("Non-solar", "non_solar")):
                classified_rows = [
                    row for row in rows if row["Period classification"] == classification
                ]
                for value_column, field_prefix in (
                    ("demand before rooftop", f"before_rooftop_{prefix}"),
                    ("projected demand", prefix),
                ):
                    peak_row = max(
                        classified_rows, key=lambda row: float(row[value_column])
                    )
                    self.assertAlmostEqual(
                        getattr(summary, f"{field_prefix}_peak_mw"),
                        float(peak_row[value_column]),
                        places=3,
                    )
                    self.assertEqual(
                        getattr(summary, f"{field_prefix}_peak_date"),
                        f"{int(peak_row['year']):04d}-{int(peak_row['month']):02d}-{int(peak_row['day']):02d}",
                    )
                    self.assertEqual(
                        getattr(summary, f"{field_prefix}_peak_period"),
                        int(peak_row["period"]),
                    )

    def test_rooftop_class_peak_timing_uses_csv_precision_for_ties(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            base_path = root / "base.csv"
            day_values = [
                199.9996 if period == 7 else 200.0 if period == 8 else 100.0
                for period in range(1, 25)
            ]
            with base_path.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.writer(handle)
                writer.writerow(["demand"])
                for _ in range(365):
                    writer.writerows([[value] for value in day_values])
            peak_path = root / "peak.csv"
            energy_path = root / "energy.csv"
            with peak_path.open("w", newline="", encoding="utf-8") as handle:
                csv.writer(handle).writerows(
                    [["DateTime", "target"], ["2025-04-01", 200.0]]
                )
            with energy_path.open("w", newline="", encoding="utf-8") as handle:
                csv.writer(handle).writerows(
                    [
                        ["DateTime", "target"],
                        ["2025-04-01", sum(day_values) * 365 / 1000],
                    ]
                )
            result = generate_profiles(
                base_profile_path=base_path,
                peak_projection_path=peak_path,
                energy_projection_path=energy_path,
                base_start_date=dt.date(2024, 4, 1),
                base_end_date=dt.date(2025, 3, 31),
                projection_start_year=2025,
                projection_end_year=2025,
                output_dir=root,
                rooftop_profile_path=self._write_rooftop_profile(root, "daily"),
                rooftop_trajectory_path=self._write_rooftop_trajectory(root),
                rooftop_profile_mode="daily",
            )
            summary = result.summaries[0]
            self.assertEqual(summary.before_rooftop_solar_peak_period, 7)
            self.assertEqual(summary.solar_peak_period, 7)

    def test_rooftop_resolution_must_match_demand(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            base_path, peak_path, energy_path = self._write_inputs(
                root, base_day_count=365, periods_per_day=24
            )
            profile_path = self._write_rooftop_profile(
                root, "daily", periods_per_day=96
            )
            trajectory_path = self._write_rooftop_trajectory(root)
            with self.assertRaisesRegex(ProfileGenerationError, "exactly match"):
                generate_profiles(
                    base_profile_path=base_path,
                    peak_projection_path=peak_path,
                    energy_projection_path=energy_path,
                    base_start_date=dt.date(2024, 4, 1),
                    base_end_date=dt.date(2025, 3, 31),
                    projection_start_year=2025,
                    projection_end_year=2025,
                    output_dir=root,
                    rooftop_profile_path=profile_path,
                    rooftop_trajectory_path=trajectory_path,
                    rooftop_profile_mode="daily",
                )

    def test_rooftop_adjustment_supports_96_period_profiles(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            base_path, peak_path, energy_path = self._write_inputs(
                root, base_day_count=365, periods_per_day=96
            )
            result = generate_profiles(
                base_profile_path=base_path,
                peak_projection_path=peak_path,
                energy_projection_path=energy_path,
                base_start_date=dt.date(2024, 4, 1),
                base_end_date=dt.date(2025, 3, 31),
                projection_start_year=2025,
                projection_end_year=2025,
                output_dir=root,
                rooftop_profile_path=self._write_rooftop_profile(
                    root, "daily", periods_per_day=96
                ),
                rooftop_trajectory_path=self._write_rooftop_trajectory(root),
                rooftop_profile_mode="daily",
            )
            self.assertEqual(result.rows_written, 365 * 96)
            self.assertEqual(result.summaries[0].periods_per_day, 96)

    def test_rooftop_profile_rejects_out_of_range_and_missing_values(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            path = root / "invalid-rooftop.csv"
            with path.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.writer(handle)
                writer.writerow(["Period", "Normalized value (p.u.)"])
                for period in range(1, 24):
                    writer.writerow([period, 1.2 if period == 12 else 0.5])
            with self.assertRaisesRegex(ProfileGenerationError, "between 0 and 1"):
                load_rooftop_profile(path, "daily")

            rows = [["Period", "Normalized value (p.u.)"]] + [
                [period, 0.5] for period in range(1, 25) if period != 12
            ]
            with path.open("w", newline="", encoding="utf-8") as handle:
                csv.writer(handle).writerows(rows)
            with self.assertRaisesRegex(ProfileGenerationError, "consecutive"):
                load_rooftop_profile(path, "daily")

    def test_rooftop_profile_rejects_retired_cf_header(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "retired-header.csv"
            with path.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.writer(handle)
                writer.writerow(["Period", "Rooftop CF"])
                for period in range(1, 25):
                    writer.writerow([period, 0.5])
            with self.assertRaisesRegex(
                ProfileGenerationError, r"Normalized value \(p.u.\)"
            ):
                load_rooftop_profile(path, "daily")

    def test_rooftop_trajectory_rejects_decrease_and_missing_final_coverage(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            path = root / "invalid-trajectory.csv"
            with path.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.writer(handle)
                writer.writerow(["Financial Year", "Cumulative MW"])
                writer.writerow(["2024-25", 100])
                writer.writerow(["2025-26", 90])
            with self.assertRaisesRegex(ProfileGenerationError, "non-decreasing"):
                load_rooftop_trajectory(path)

            with self.assertRaisesRegex(ProfileGenerationError, "extrapolation"):
                validate_rooftop_trajectory_coverage(
                    {2024: 100, 2025: 150}, 2024, 2025, 2026
                )

    def test_rooftop_trajectory_rejects_non_finite_capacity(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            for invalid in ("NaN", "Infinity"):
                with self.subTest(invalid=invalid):
                    path = root / f"trajectory-{invalid}.csv"
                    with path.open("w", newline="", encoding="utf-8") as handle:
                        writer = csv.writer(handle)
                        writer.writerow(["Financial Year", "Cumulative MW"])
                        writer.writerow(["2024-25", 100])
                        writer.writerow(["2025-26", invalid])
                    with self.assertRaisesRegex(ProfileGenerationError, "must be finite"):
                        load_rooftop_trajectory(path)

    def test_rooftop_trajectory_requires_baseline_and_unique_years(self) -> None:
        with self.assertRaisesRegex(ProfileGenerationError, "must include the reference"):
            validate_rooftop_trajectory_coverage(
                {2023: 80, 2025: 150}, 2024, 2025, 2025
            )
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "duplicate-trajectory.csv"
            with path.open("w", newline="", encoding="utf-8") as handle:
                writer = csv.writer(handle)
                writer.writerow(["Financial Year", "Cumulative MW"])
                writer.writerow(["2024-25", 100])
                writer.writerow(["2024-25", 120])
            with self.assertRaisesRegex(ProfileGenerationError, "duplicate"):
                load_rooftop_trajectory(path)

    def test_rooftop_projection_must_start_after_reference_fy(self) -> None:
        with self.assertRaisesRegex(ProfileGenerationError, "must begin after"):
            validate_rooftop_trajectory_coverage(
                {2024: 100, 2025: 150}, 2024, 2024, 2025
            )

    def test_rooftop_adjustment_preserves_negative_net_export(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            base_path, peak_path, energy_path = self._write_inputs(
                root, base_day_count=365, periods_per_day=24
            )
            profile_path = self._write_rooftop_profile(root, "daily", cf=1.0)
            trajectory_path = self._write_rooftop_trajectory(root, final_capacity=1000)
            result = generate_profiles(
                base_profile_path=base_path,
                peak_projection_path=peak_path,
                energy_projection_path=energy_path,
                base_start_date=dt.date(2024, 4, 1),
                base_end_date=dt.date(2025, 3, 31),
                projection_start_year=2025,
                projection_end_year=2025,
                output_dir=root,
                rooftop_profile_path=profile_path,
                rooftop_trajectory_path=trajectory_path,
                rooftop_profile_mode="daily",
            )
            self.assertLess(result.summaries[0].adjusted_minimum_mw, 0)
            with result.output_path.open(newline="", encoding="utf-8") as handle:
                self.assertTrue(
                    any(float(row["projected demand"]) < 0 for row in csv.DictReader(handle))
                )


if __name__ == "__main__":
    unittest.main()
