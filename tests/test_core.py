import csv
import datetime as dt
import json
import tempfile
import unittest
from pathlib import Path

from profile_tool.core import (
    ProfileGenerationError,
    fiscal_year_label,
    generate_profiles,
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
                    "projected demand",
                ],
            )
            self.assertEqual(rows[1][0], "2025-26")
            self.assertEqual(rows[8760][0], "2025-26")
            self.assertEqual(rows[8761][0], "2026-27")
            self.assertEqual(rows[-1][0], "2026-27")

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
        for periods_per_day in (24, 48, 96):
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


if __name__ == "__main__":
    unittest.main()
