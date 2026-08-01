"""/analyze 요청에 대한 인가(경로 allowlist)와 인증(공유 시크릿) 검사.

env는 요청 시점에 읽는다 — 테스트에서 monkeypatch가 쉽고,
프로세스 재시작 없이 compose env 교체를 반영할 수 있다.
"""
from __future__ import annotations

import hmac
import os
from typing import List

from fastapi import Header, HTTPException


def allowed_roots() -> List[str]:
    """분석을 허용할 루트 디렉토리 목록.

    ADVANCED_PYEXAMINE_ALLOWED_ROOTS(comma-separated)가 우선이고,
    없으면 ADVANCED_PYEXAMINE_SOURCE_DIR(컨테이너에서는 마운트 루트)로 대체한다.
    """
    raw = os.environ.get("ADVANCED_PYEXAMINE_ALLOWED_ROOTS")
    if raw is None or not raw.strip():
        raw = os.environ.get("ADVANCED_PYEXAMINE_SOURCE_DIR", "")

    return [os.path.realpath(item.strip()) for item in raw.split(",") if item.strip()]


def resolve_allowed_path(project_path: str) -> str:
    """projectPath를 실경로로 정규화하고 allowlist 안에 있는지 검사한다.

    realpath를 먼저 적용해 `..`·심링크로 루트를 벗어나는 우회를 무력화하고,
    접두사 비교에 os.sep을 붙여 `/opt/foo`가 `/opt/foobar`를 통과시키지 않게 한다.
    """
    roots = allowed_roots()
    if not roots:
        raise PermissionError(
            "No allowed analysis roots configured. "
            "Set ADVANCED_PYEXAMINE_ALLOWED_ROOTS (comma-separated directories) "
            "or ADVANCED_PYEXAMINE_SOURCE_DIR."
        )

    real = os.path.realpath(project_path)
    for root in roots:
        # root가 '/'인 경우 'root + sep'이 '//'가 되지 않도록 trailing sep을 정리
        prefix = root.rstrip(os.sep) + os.sep
        if real == root or real.startswith(prefix):
            return real

    raise PermissionError(f"projectPath is outside the allowed analysis roots: {project_path}")


def verify_internal_token(x_internal_token: str = Header(default="")) -> None:
    """ADVANCED_PYEXAMINE_SHARED_SECRET이 설정된 경우 X-Internal-Token 헤더를 검증한다.

    시크릿 미설정 시 인증을 생략한다(로컬 개발 모드) — 경로 allowlist는 항상 적용된다.
    """
    expected = os.environ.get("ADVANCED_PYEXAMINE_SHARED_SECRET", "").strip()
    if not expected:
        return

    if not hmac.compare_digest(x_internal_token.encode("utf-8"), expected.encode("utf-8")):
        raise HTTPException(status_code=401, detail="invalid or missing X-Internal-Token")
