from __future__ import annotations

import logging
import os

from fastapi import Depends, FastAPI, HTTPException

from .analyzer_adapter import analyze_project
from .response_transformer import build_response
from .schemas import AnalyzeRequest
from .security import resolve_allowed_path, verify_internal_token


logger = logging.getLogger("advanced_pyexamine_service")

app = FastAPI(
    title="advanced-pyexamine-service",
    version="0.1.0",
)

if not os.environ.get("ADVANCED_PYEXAMINE_SHARED_SECRET", "").strip():
    logger.warning(
        "ADVANCED_PYEXAMINE_SHARED_SECRET is not set; "
        "/analyze accepts unauthenticated requests (allowed-roots restriction still applies)."
    )


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "service": "advanced-pyexamine-service",
    }


@app.post("/analyze", dependencies=[Depends(verify_internal_token)])
def analyze(request: AnalyzeRequest) -> dict:
    try:
        project_path = resolve_allowed_path(request.projectPath)
        smell_groups = analyze_project(project_path, request.only)
        return build_response(
            project_path=request.projectPath,
            smell_groups=smell_groups,
            only=request.only,
            summary_only=request.summaryOnly,
            limit_per_group=request.limitPerGroup,
        )
    except PermissionError as error:
        raise HTTPException(status_code=403, detail=str(error)) from error
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Failed to analyze project: {error}") from error
