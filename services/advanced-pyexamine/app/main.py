from __future__ import annotations

from fastapi import FastAPI, HTTPException

from .analyzer_adapter import analyze_project
from .response_transformer import build_response
from .schemas import AnalyzeRequest


app = FastAPI(
    title="advanced-pyexamine-service",
    version="0.1.0",
)


@app.get("/health")
def health() -> dict:
    return {
        "ok": True,
        "service": "advanced-pyexamine-service",
    }


@app.post("/analyze")
def analyze(request: AnalyzeRequest) -> dict:
    try:
        smell_groups = analyze_project(request.projectPath, request.only)
        return build_response(
            project_path=request.projectPath,
            smell_groups=smell_groups,
            only=request.only,
            summary_only=request.summaryOnly,
            limit_per_group=request.limitPerGroup,
        )
    except FileNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail=f"Failed to analyze project: {error}") from error
