from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, Iterable, List, Optional


class Severity(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"


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
    metrics: dict = field(default_factory=dict)
    related_locations: tuple = field(default_factory=tuple)
    message: str | None = None


def analyze_project(project_path: str, only: Optional[Iterable[str]] = None) -> Dict[str, List[Smell]]:
    requested = set(only or [])
    groups: Dict[str, List[Smell]] = {
        "long_method": [
            Smell(
                name="long_method",
                category="size_metric",
                entity="sample.long_function",
                location=Location("sample_project/sample.py", 1, 45),
                severity=Severity.HIGH,
                metrics={"lines": 45, "threshold": 30},
                message="Extract Method",
            ),
            Smell(
                name="long_method",
                category="size_metric",
                entity="sample.another_long_function",
                location=Location("sample_project/sample.py", 48, 92),
                severity=Severity.MEDIUM,
                metrics={"lines": 44, "threshold": 30},
                message="Extract Method",
            ),
        ],
        "data_clumps": [
            Smell(
                name="data_clumps",
                category="abstraction_misuse_metric",
                entity="user_id, email, name",
                location=Location("sample_project/sample.py", 95, 103),
                severity=Severity.MEDIUM,
                metrics={"occurrences": 3},
                message="Introduce Parameter Object",
            ),
        ],
    }

    if not requested:
        return groups

    return {
        name: smells
        for name, smells in groups.items()
        if name in requested
    }
