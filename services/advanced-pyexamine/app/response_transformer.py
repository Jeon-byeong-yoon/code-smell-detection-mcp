from __future__ import annotations

from typing import Any, Dict, List, Optional


Smell = Dict[str, Any]
SmellGroups = Dict[str, List[Smell]]


def summarize(smell_groups: SmellGroups) -> Dict[str, Any]:
    summary: Dict[str, Any] = {
        "total": 0,
        "bySeverity": {},
        "byName": {},
    }

    for name, smells in smell_groups.items():
        summary["byName"][name] = len(smells)
        summary["total"] += len(smells)

        for smell in smells:
            severity = str(smell.get("severity") or "unknown").strip().lower() or "unknown"
            summary["bySeverity"][severity] = summary["bySeverity"].get(severity, 0) + 1

    return summary


def limit_groups(smell_groups: SmellGroups, limit_per_group: Optional[int]) -> SmellGroups:
    if not limit_per_group:
        return smell_groups

    return {
        name: smells[:limit_per_group]
        for name, smells in smell_groups.items()
    }


def count_smells(smell_groups: SmellGroups) -> int:
    return sum(len(smells) for smells in smell_groups.values())


def build_response(
    *,
    project_path: str,
    smell_groups: SmellGroups,
    only: Optional[str] = None,
    summary_only: bool = False,
    limit_per_group: Optional[int] = None,
) -> Dict[str, Any]:
    summary = summarize(smell_groups)
    returned_groups = None if summary_only else limit_groups(smell_groups, limit_per_group)
    returned_total = 0 if returned_groups is None else count_smells(returned_groups)

    response: Dict[str, Any] = {
        "tool": "advanced_pyexamine",
        "language": "python",
        "projectPath": project_path,
        "summary": summary,
        "response": {
            "summaryOnly": summary_only,
            "returnedTotal": returned_total,
            "truncated": returned_total < summary["total"],
        },
    }

    if only:
        response["only"] = only

    if returned_groups is not None:
        response["smellGroups"] = returned_groups

    if limit_per_group:
        response["response"]["limitPerGroup"] = limit_per_group

    return response
