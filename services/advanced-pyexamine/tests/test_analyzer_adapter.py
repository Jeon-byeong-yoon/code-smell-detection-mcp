import tempfile
import unittest
from dataclasses import dataclass
from enum import Enum
from unittest.mock import patch

from app import analyzer_adapter


class Severity(str, Enum):
    HIGH = "high"


@dataclass(frozen=True)
class Location:
    file: str
    line_start: int
    line_end: int


@dataclass(frozen=True)
class Smell:
    name: str
    category: str
    entity: str
    location: Location
    severity: Severity
    metrics: dict
    related_locations: tuple
    message: str


class AnalyzerAdapterTest(unittest.TestCase):
    def test_parse_only_returns_detector_names(self):
        self.assertEqual(
            analyzer_adapter._parse_only(" long_method, data_clumps ,, "),
            ["long_method", "data_clumps"],
        )

    def test_smell_to_dict_serializes_dataclass_smell(self):
        smell = Smell(
            name="long_method",
            category="size_metric",
            entity="UserService.get_user",
            location=Location("sample.py", 1, 45),
            severity=Severity.HIGH,
            metrics={"lines": 45},
            related_locations=(Location("helper.py", 3, 8),),
            message="Extract Method",
        )

        result = analyzer_adapter._smell_to_dict(smell)

        self.assertEqual(result["name"], "long_method")
        self.assertEqual(result["severity"], "high")
        self.assertEqual(result["location"]["file"], "sample.py")
        self.assertEqual(result["related_locations"][0]["line_start"], 3)

    def test_analyze_project_calls_real_analyzer_contract(self):
        smell = Smell(
            name="long_method",
            category="size_metric",
            entity="UserService.get_user",
            location=Location("sample.py", 1, 45),
            severity=Severity.HIGH,
            metrics={"lines": 45},
            related_locations=(),
            message="Extract Method",
        )

        def fake_analyzer(project_path, only=None):
            self.assertEqual(only, ["long_method"])
            return {"long_method": [smell]}

        with tempfile.TemporaryDirectory() as project_path:
            with patch.object(analyzer_adapter, "_load_analyzer", return_value=fake_analyzer):
                result = analyzer_adapter.analyze_project(project_path, "long_method")

        self.assertEqual(result["long_method"][0]["entity"], "UserService.get_user")

    def test_analyze_project_rejects_missing_project_path(self):
        with self.assertRaises(FileNotFoundError):
            analyzer_adapter.analyze_project("/missing/project")


if __name__ == "__main__":
    unittest.main()
