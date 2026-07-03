from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class AnalyzeRequest(BaseModel):
    projectPath: str = Field(..., min_length=1)
    only: Optional[str] = None
    summaryOnly: bool = False
    limitPerGroup: Optional[int] = Field(default=None, gt=0)
