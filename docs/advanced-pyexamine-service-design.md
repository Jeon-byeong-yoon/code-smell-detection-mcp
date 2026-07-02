# Advanced PyExamine Service Design

## Purpose

`code-smell-detection-mcp`는 현재 `advanced_pyexamine`을 CLI subprocess 방식으로 실행한다.

현재 구조:

```text
MCP client
  -> code-smell-detection-mcp
  -> analyze_python_smells
  -> python -m advanced_pyexamine <projectPath> --json
  -> stdout JSON parse
  -> MCP response
```

이 구조는 빠르게 검증하기 좋지만, 장기적으로는 다음 한계가 있다.

- 매 요청마다 Python process를 새로 실행한다.
- CLI stdout parsing에 의존한다.
- 분석 엔진이 "서비스"로 독립되어 있다는 느낌이 약하다.
- MCP 외부 시스템이 같은 분석 기능을 재사용하기 어렵다.

따라서 다음 단계에서는 이 repository 안에 `advanced_pyexamine` HTTP service wrapper를 추가한다.

목표 구조:

```text
MCP client
  -> code-smell-detection-mcp
  -> analyze_python_smells
  -> AdvancedPyexamineClient
  -> HTTP POST /analyze
  -> advanced-pyexamine-service
  -> advanced_pyexamine analyzer
  -> JSON response
```

이 문서는 해당 HTTP service를 이 repository 안에 구현하기 위한 설계 기준이다.

## Why Keep It In This Repository

원래 가장 깔끔한 구조는 `advanced_pyexamine` 원본 repository 안에 FastAPI service를 두는 것이다. 하지만 이번 작업에서는 다음 이유로 `code-smell-detection-mcp` 안에 둔다.

- MCP 서버와 분석 service wrapper를 같은 branch/PR에서 관리할 수 있다.
- 배포/실행 문서를 한 곳에 모을 수 있다.
- MCP tool contract와 HTTP service contract를 동시에 맞추기 쉽다.
- 현재 목표가 "MCP와 함께 별도 code smell service를 제공하는 것"이므로 한 repository에서 PoC를 완성하는 편이 빠르다.

단, smell detection 원본 로직 자체는 복사하지 않는다.

이 repository 안의 service는 wrapper 역할만 한다.

```text
services/advanced-pyexamine
  -> advanced_pyexamine package import
  -> analyze_project 호출
  -> MCP와 동일한 response shape로 normalize
```

## Proposed Directory Structure

```text
code-smell-detection-mcp/
  services/
    advanced-pyexamine/
      README.md
      requirements.txt
      app/
        __init__.py
        main.py
        schemas.py
        analyzer_adapter.py
        response_transformer.py
      tests/
        test_response_transformer.py
```

역할:

- `main.py`: FastAPI app 및 route 정의
- `schemas.py`: request/response Pydantic schema
- `analyzer_adapter.py`: `advanced_pyexamine` 호출 담당
- `response_transformer.py`: `Smell` 객체 또는 raw JSON을 MCP response shape로 변환
- `requirements.txt`: service 실행 의존성
- `README.md`: service 실행법 및 검증법

## Runtime Dependency Strategy

`advanced_pyexamine` 원본 로직은 이 repository로 복사하지 않는다.

대신 service 실행 시 `advanced_pyexamine` package를 import 가능해야 한다.

지원할 방식:

### 1. Local Source Path

개발 환경에서 가장 단순한 방식이다.

```bash
export ADVANCED_PYEXAMINE_SOURCE_DIR="/path/to/pyexamine 2"
```

service 시작 시 해당 경로를 `sys.path`에 추가한다.

장점:

- 지금 로컬 구조와 잘 맞는다.
- 원본 repository 수정사항을 바로 반영할 수 있다.

단점:

- 운영/CI에서는 경로 관리가 필요하다.

### 2. Editable Install

`advanced_pyexamine`을 Python environment에 editable install한다.

```bash
cd "/path/to/pyexamine 2"
python -m pip install -e .
```

장점:

- service code에서 별도 path 주입이 필요 없다.

단점:

- 개발자 환경 세팅 절차가 하나 늘어난다.

### 3. Future Package Dependency

나중에 `advanced_pyexamine`이 package로 배포되면 `requirements.txt`에 의존성으로 추가할 수 있다.

이 단계에서는 1번 local source path를 기본 지원하고, 2번 editable install도 동작하도록 만든다.

## HTTP API

### Health Check

```http
GET /health
```

응답:

```json
{
  "ok": true,
  "service": "advanced-pyexamine-service"
}
```

### Analyze

```http
POST /analyze
```

요청:

```json
{
  "projectPath": "/path/to/python/project",
  "only": "long_method,data_clumps",
  "summaryOnly": false,
  "limitPerGroup": 10
}
```

필드:

- `projectPath`: 분석할 Python project root. 필수.
- `only`: comma-separated detector names. 선택.
- `summaryOnly`: 상세 smell group 생략 여부. 선택. 기본값 `false`.
- `limitPerGroup`: 각 smell group에서 반환할 상세 항목 수. 선택.

응답:

```json
{
  "tool": "advanced_pyexamine",
  "language": "python",
  "projectPath": "/path/to/python/project",
  "only": "long_method,data_clumps",
  "smellGroups": {
    "long_method": []
  },
  "summary": {
    "total": 0,
    "bySeverity": {},
    "byName": {}
  },
  "response": {
    "summaryOnly": false,
    "limitPerGroup": 10,
    "returnedTotal": 0,
    "truncated": false
  }
}
```

`summary`는 항상 전체 분석 결과 기준이다.

`summaryOnly`와 `limitPerGroup`은 반환되는 상세 결과에만 영향을 준다.

## Error Response

HTTP service는 에러를 다음 형태로 반환한다.

```json
{
  "ok": false,
  "error": {
    "code": "ANALYSIS_FAILED",
    "message": "Failed to analyze project.",
    "details": {}
  }
}
```

권장 status code:

- `400`: invalid request
- `404`: project path not found
- `422`: request schema validation error
- `500`: unexpected analyzer failure

MCP server는 이 응답을 받아 기존 stdio error shape로 변환한다.

```json
{
  "id": "py-http-1",
  "error": "advanced_pyexamine service failed: Failed to analyze project."
}
```

## MCP Integration

현재 `AdvancedPyexamineClient`는 CLI mode만 지원한다.

추가할 환경 변수:

```env
ADVANCED_PYEXAMINE_MODE=cli
ADVANCED_PYEXAMINE_SERVICE_URL=http://localhost:18080
ADVANCED_PYEXAMINE_SERVICE_TIMEOUT_MS=30000
```

동작:

- `ADVANCED_PYEXAMINE_MODE=cli`: 기존 subprocess 방식 사용
- `ADVANCED_PYEXAMINE_MODE=http`: HTTP service 호출

기존 CLI 환경 변수는 유지한다.

```env
ADVANCED_PYEXAMINE_BIN=python
ADVANCED_PYEXAMINE_ARGS=-m,advanced_pyexamine
ADVANCED_PYEXAMINE_CWD=/path/to/pyexamine 2
ADVANCED_PYEXAMINE_TIMEOUT_MS=30000
```

이렇게 하면 service 도입 후에도 CLI fallback이 가능하다.

## Implementation Plan

### Step 1. Add Service Skeleton

추가 파일:

```text
services/advanced-pyexamine/requirements.txt
services/advanced-pyexamine/app/main.py
services/advanced-pyexamine/app/schemas.py
services/advanced-pyexamine/app/response_transformer.py
services/advanced-pyexamine/README.md
```

`/health`와 mock `/analyze`부터 구현한다.

검증:

```bash
cd services/advanced-pyexamine
python -m uvicorn app.main:app --host 127.0.0.1 --port 18080
curl http://localhost:18080/health
```

### Step 2. Add Real Analyzer Adapter

`advanced_pyexamine` import 방식:

```python
from advanced_pyexamine.analyzer import analyze_project
```

필요하면 `ADVANCED_PYEXAMINE_SOURCE_DIR`를 `sys.path`에 추가한다.

adapter 책임:

- `projectPath` 검증
- `only` 전달
- `analyze_project` 호출
- `Smell` 객체를 dict로 변환

### Step 3. Match Current MCP Response Shape

현재 CLI client가 반환하는 shape와 HTTP service 응답 shape를 맞춘다.

필수 필드:

- `tool`
- `language`
- `projectPath`
- `only`
- `smellGroups`
- `summary`
- `response`

### Step 4. Add MCP HTTP Mode

`src/clients/advanced-pyexamine-client.ts`를 확장한다.

추가 로직:

```text
mode === "cli"  -> current spawn flow
mode === "http" -> axios.post(`${serviceUrl}/analyze`, payload)
```

검증:

```bash
printf '%s\n' '{"id":"py-http-1","tool":"analyze_python_smells","params":{"projectPath":"/path/to/project","summaryOnly":true}}' \
| ADVANCED_PYEXAMINE_MODE=http \
  ADVANCED_PYEXAMINE_SERVICE_URL=http://localhost:18080 \
  node dist/server.js
```

### Step 5. Tests

테스트 레이어:

1. `npm run test:advanced-pyexamine`
   - 기존 mock CLI smoke test
   - 계속 유지

2. Python service unit test
   - `response_transformer` summary 계산
   - `summaryOnly`
   - `limitPerGroup`

3. HTTP smoke test
   - service를 띄운 뒤 `/health`, `/analyze` 확인

4. MCP HTTP mode smoke test
   - mock HTTP service 또는 실제 service 대상

## Verification Commands

최소 검증:

```bash
npm run build
npm run test:advanced-pyexamine
npm run test:stdio
git diff --check
```

HTTP service 추가 후:

```bash
cd services/advanced-pyexamine
python -m uvicorn app.main:app --host 127.0.0.1 --port 18080
curl http://localhost:18080/health
curl -X POST http://localhost:18080/analyze \
  -H "Content-Type: application/json" \
  -d '{"projectPath":"/path/to/python/project","summaryOnly":true}'
```

MCP HTTP mode:

```bash
printf '%s\n' '{"id":"py-http-1","tool":"analyze_python_smells","params":{"projectPath":"/path/to/python/project","summaryOnly":true}}' \
| ADVANCED_PYEXAMINE_MODE=http \
  ADVANCED_PYEXAMINE_SERVICE_URL=http://localhost:18080 \
  node dist/server.js
```

## Open Questions

1. service가 local filesystem path만 받을지, source code upload도 받을지
2. Docker image를 이 repository에서 같이 제공할지
3. `advanced_pyexamine` 원본 repository를 git submodule로 둘지
4. HTTP mode를 기본값으로 바꿀지, CLI fallback을 기본값으로 유지할지
5. 분석 대상 path 접근 제한을 둘지

초기 구현에서는 다음 정책을 권장한다.

- local filesystem path만 지원
- CLI mode를 기본값으로 유지
- HTTP mode는 opt-in
- `ADVANCED_PYEXAMINE_SOURCE_DIR`로 원본 analyzer 경로를 주입
- Docker는 service skeleton 검증 후 별도 작업으로 분리

## Recommended Next Step

다음 구현 작업은 Step 1이다.

```text
services/advanced-pyexamine FastAPI skeleton 추가
GET /health
POST /analyze mock response
service README 작성
```

이후 실제 `advanced_pyexamine` import와 MCP HTTP mode를 순차적으로 붙인다.

