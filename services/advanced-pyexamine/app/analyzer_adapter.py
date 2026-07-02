from __future__ import annotations

import os
import sys
from typing import Any, Callable, Dict, Iterable, List, Optional


SmellGroups = Dict[str, List[Dict[str, Any]]]
AnalyzeProject = Callable[..., Dict[str, Iterable[Any]]]


def analyze_project(project_path: str, only: Optional[str] = None) -> SmellGroups:
    """Run advanced_pyexamine and return JSON-serializable smell groups."""
    if not os.path.isdir(project_path):
        raise FileNotFoundError(f"Project path does not exist or is not a directory: {project_path}")

    analyzer = _load_analyzer()
    results = analyzer(project_path, only=_parse_only(only))

    return {
        name: [_smell_to_dict(smell) for smell in smells]
        for name, smells in results.items()
    }


def _load_analyzer() -> AnalyzeProject:
    _configure_source_dir()

    try:
        from advanced_pyexamine.analyzer import analyze_project as advanced_analyze_project
    except ModuleNotFoundError as error:
        if error.name == "advanced_pyexamine":
            raise RuntimeError(
                "advanced_pyexamine is not importable. "
                "Set ADVANCED_PYEXAMINE_SOURCE_DIR to the repository root "
                "or install advanced_pyexamine in this Python environment."
            ) from error
        raise

    return advanced_analyze_project


def _configure_source_dir() -> None:
    source_dir = os.environ.get("ADVANCED_PYEXAMINE_SOURCE_DIR")
    if not source_dir:
        return

    absolute_source_dir = os.path.abspath(source_dir)
    if not os.path.isdir(absolute_source_dir):
        raise FileNotFoundError(
            f"ADVANCED_PYEXAMINE_SOURCE_DIR does not exist or is not a directory: {source_dir}"
        )

    if absolute_source_dir not in sys.path:
        sys.path.insert(0, absolute_source_dir)


def _parse_only(only: Optional[str]) -> Optional[List[str]]:
    if not only:
        return None

    detector_names = [name.strip() for name in only.split(",") if name.strip()]
    return detector_names or None


def _smell_to_dict(smell: Any) -> Dict[str, Any]:
    return {
        "name": _get_value(smell, "name"),
        "category": _get_value(smell, "category"),
        "entity": _get_value(smell, "entity"),
        "location": _location_to_dict(_get_value(smell, "location")),
        "severity": _severity_to_string(_get_value(smell, "severity")),
        "metrics": dict(_get_value(smell, "metrics") or {}),
        "related_locations": [
            _location_to_dict(location)
            for location in (_get_value(smell, "related_locations") or [])
        ],
        "message": _get_value(smell, "message"),
    }


def _location_to_dict(location: Any) -> Dict[str, Any]:
    if isinstance(location, dict):
        return {
            "file": location.get("file"),
            "line_start": location.get("line_start"),
            "line_end": location.get("line_end"),
        }

    return {
        "file": _get_value(location, "file"),
        "line_start": _get_value(location, "line_start"),
        "line_end": _get_value(location, "line_end"),
    }


def _severity_to_string(severity: Any) -> str:
    value = getattr(severity, "value", severity)
    return str(value)


def _get_value(source: Any, key: str) -> Any:
    if isinstance(source, dict):
        return source.get(key)
    return getattr(source, key, None)
