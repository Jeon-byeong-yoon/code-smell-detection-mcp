from __future__ import annotations

from typing import Any, Dict, List, Optional


SmellGroups = Dict[str, List[Dict[str, Any]]]


def analyze_project(project_path: str, only: Optional[str] = None) -> SmellGroups:
    """Return smell groups.

    This is a skeleton adapter. It currently returns deterministic mock data so
    the HTTP service contract can be developed and tested before wiring the real
    advanced_pyexamine package.
    """
    groups: SmellGroups = {
        "long_method": [
            {
                "name": "long_method",
                "category": "size_metric",
                "entity": "UserService.get_user",
                "location": {
                    "file": f"{project_path}/sample.py",
                    "line_start": 1,
                    "line_end": 45,
                },
                "severity": "high",
                "metrics": {"lines": 45, "threshold": 30},
                "related_locations": [],
                "message": None,
            },
            {
                "name": "long_method",
                "category": "size_metric",
                "entity": "OrderService.create_order",
                "location": {
                    "file": f"{project_path}/orders.py",
                    "line_start": 10,
                    "line_end": 42,
                },
                "severity": "medium",
                "metrics": {"lines": 33, "threshold": 30},
                "related_locations": [],
                "message": None,
            },
        ],
        "data_clumps": [
            {
                "name": "data_clumps",
                "category": "abstraction_misuse_metric",
                "entity": "name, email, phone",
                "location": {
                    "file": f"{project_path}/users.py",
                    "line_start": 12,
                    "line_end": 18,
                },
                "severity": "medium",
                "metrics": {"occurrences": 3},
                "related_locations": [],
                "message": "Introduce Parameter Object",
            }
        ],
    }

    if not only:
        return groups

    names = [name.strip() for name in only.split(",") if name.strip()]
    return {name: groups.get(name, []) for name in names}
