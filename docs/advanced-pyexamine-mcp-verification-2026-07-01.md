# Advanced PyExamine MCP Verification - 2026-07-01

## Summary

2026-07-01 기준 `code-smell-detection-mcp`에 `advanced_pyexamine` 기반 Python code smell 분석 도구를 추가하고 검증했다.

최종 결론은 다음과 같다.

- `analyze_python_smells` MCP tool 추가 완료
- `advanced_pyexamine` CLI를 subprocess로 실행하는 client 추가 완료
- `python -m advanced_pyexamine <projectPath> --json` 출력 파싱 성공
- 기존 CodeVi backend 연동 tool과 독립적으로 실행 가능하도록 lazy client initialization 적용
- 실제 `advanced_pyexamine` 프로젝트를 대상으로 end-to-end 실행 성공
- 기존 build 및 stdio smoke test 회귀 검증 성공

따라서 MCP 서버가 CodeVi backend 프록시 역할만 하던 상태에서, 별도 Python smell analysis engine인 `advanced_pyexamine`을 실행해 code smell 결과를 직접 반환할 수 있는 1차 구조가 완성되었다.

## Scope

이번 작업은 smell detection logic을 TypeScript MCP 프로젝트 내부로 복사하지 않았다.

대신 다음 구조로 `advanced_pyexamine`을 독립 분석 엔진처럼 호출한다.

```text
MCP client
  -> code-smell-detection-mcp
  -> analyze_python_smells
  -> python -m advanced_pyexamine <projectPath> --json
  -> stdout JSON parse
  -> MCP response
```

이 방식은 다음 이유로 선택했다.

- `advanced_pyexamine`에 이미 JSON CLI interface가 존재함
- 기존 Python detector, AST index, threshold, test 구조를 그대로 재사용 가능함
- MCP 서버 책임을 "tool adapter"로 유지할 수 있음
- 분석 엔진 원본과 MCP 복사본이 갈라지는 문제를 피할 수 있음
- 추후 FastAPI 기반 HTTP service로 분리하기 쉬움

## Implemented Files

이번 작업에서 추가 또는 수정된 파일은 다음과 같다.

- `src/clients/advanced-pyexamine-client.ts`
- `src/tools/advanced-pyexamine-tools.ts`
- `src/server.ts`
- `src/tools/metrics-tools.ts`
- `src/tools/pyexamine-tools.ts`
- `.env.example`
- `README.md`

관련 커밋:

```text
7cd3ab5 feat: add advanced pyexamine smell analysis tool
```

## Tool Contract

추가된 MCP tool:

```text
analyze_python_smells
```

입력 예시:

```json
{
  "id": "py-smell-1",
  "tool": "analyze_python_smells",
  "params": {
    "projectPath": "/path/to/python/project"
  }
}
```

선택 옵션:

```json
{
  "id": "py-smell-2",
  "tool": "analyze_python_smells",
  "params": {
    "projectPath": "/path/to/python/project",
    "only": "long_method,data_clumps"
  }
}
```

응답 구조:

```json
{
  "id": "py-smell-1",
  "result": {
    "ok": true,
    "result": {
      "tool": "advanced_pyexamine",
      "language": "python",
      "projectPath": "/path/to/python/project",
      "smellGroups": {},
      "summary": {
        "total": 0,
        "bySeverity": {},
        "byName": {}
      }
    }
  }
}
```

## Environment Variables

`advanced_pyexamine` CLI bridge는 다음 환경 변수를 사용한다.

```env
ADVANCED_PYEXAMINE_BIN=python
ADVANCED_PYEXAMINE_ARGS=-m,advanced_pyexamine
ADVANCED_PYEXAMINE_CWD=
ADVANCED_PYEXAMINE_TIMEOUT_MS=30000
```

검증 시에는 `advanced_pyexamine` 레포 루트를 `ADVANCED_PYEXAMINE_CWD`로 지정했다.

`ADVANCED_PYEXAMINE_ARGS`는 comma-separated 형식이다.

```text
-m,advanced_pyexamine
```

이는 실제 실행 시 다음 명령으로 해석된다.

```bash
python -m advanced_pyexamine <projectPath> --json
```

## Safety Notes

subprocess 실행은 `child_process.exec`가 아니라 `spawn` 기반으로 구현했다.

이유:

- shell string interpolation 회피
- project path 공백 처리 안정화
- command injection 위험 감소
- timeout 및 stderr 처리 명확화

구현 정책:

- `shell: false`
- stdout JSON parse
- stderr 포함 error message 반환
- non-zero exit code는 MCP error 응답으로 변환
- timeout 발생 시 child process 종료

## Lazy Client Initialization

이번 검증 중 기존 서버 구조에서 다음 문제가 확인되었다.

```text
Fatal error starting server: Error: ANALYSIS_API_BASE_URL is required for code-analysis tools.
```

원인:

- 서버 시작 시 `registerPyexamineTools`가 즉시 `CodeAnalysisApiClient`를 생성함
- `analyze_python_smells`만 실행하려는 경우에도 기존 CodeVi code-analysis 환경 변수가 없으면 서버가 시작되지 않음

해결:

- `src/tools/pyexamine-tools.ts`에서 `CodeAnalysisApiClient`를 tool 호출 시점에 lazy 생성하도록 변경
- `src/tools/metrics-tools.ts`에서도 `MetricsApiClient`를 tool 호출 시점에 lazy 생성하도록 변경

결과:

- `analyze_python_smells`는 `ANALYSIS_API_BASE_URL`, `METRICS_API_BASE_URL` 없이 실행 가능
- 기존 metrics/code-analysis tool은 실제 호출 시에만 각 환경 변수를 요구함

## Verification Commands

### Build

```bash
npm run build
```

결과:

```text
tsc -p tsconfig.json
```

TypeScript build 성공.

### Advanced PyExamine Tool

실제 검증 명령:

```bash
printf '%s\n' '{"id":"py-smell-1","tool":"analyze_python_smells","params":{"projectPath":"/path/to/pyexamine 2/advanced_pyexamine"}}' \
| ADVANCED_PYEXAMINE_BIN=python \
  ADVANCED_PYEXAMINE_ARGS=-m,advanced_pyexamine \
  ADVANCED_PYEXAMINE_CWD="/path/to/pyexamine 2" \
  node dist/server.js
```

검증 결과:

```json
{
  "id": "py-smell-1",
  "result": {
    "ok": true,
    "result": {
      "tool": "advanced_pyexamine",
      "language": "python",
      "summary": {
        "total": 112,
        "bySeverity": {
          "high": 25,
          "medium": 87
        }
      }
    }
  }
}
```

탐지된 대표 smell group:

- `long_method`
- `large_class_size2`
- `switch_statements`
- `high_cyclomatic_complexity`
- `too_many_branches`
- `scattered_functionality`
- `dead_code`
- `excessive_comments`
- `data_clumps`
- `primitive_obsession`
- `shotgun_surgery`

### Existing Stdio Smoke Test

```bash
npm run test:stdio
```

결과:

```text
stdio smoke test success (detected valid response).
```

주의:

- local mock metrics API가 `127.0.0.1`에 bind되므로 sandbox 환경에서는 권한 상승이 필요할 수 있다.

### Diff Check

```bash
git diff --check
```

결과:

```text
no whitespace errors
```

## Final Result

최종적으로 다음 흐름이 정상 동작함을 확인했다.

1. MCP server build
2. `analyze_python_smells` tool registration
3. `advanced_pyexamine` subprocess execution
4. JSON stdout parsing
5. smell group preservation
6. summary generation
7. MCP response wrapping
8. existing stdio smoke test regression

기능적으로는 다음 상태가 되었다.

```text
Before:
MCP server -> CodeVi backend API proxy

After:
MCP server -> CodeVi backend API proxy
MCP server -> advanced_pyexamine Python smell engine
```

즉, MCP 서버가 CodeVi backend와 독립적으로 Python code smell detection engine을 실행할 수 있게 되었다.

## Remaining Work

다음 작업은 선택 사항이다.

### 1. Response Size Control

현재는 `smellGroups` 전체를 반환하므로 큰 프로젝트에서는 응답이 매우 길 수 있다.

추가 후보:

```json
{
  "summaryOnly": true,
  "limitPerGroup": 10
}
```

### 2. Small Fixture Smoke Test

현재 end-to-end 검증은 `advanced_pyexamine` 프로젝트 자체를 분석했다.

추후에는 작은 fixture project를 두고 다음을 검증하는 smoke test를 추가하는 것이 좋다.

- tool 실행 성공 여부
- JSON parse 성공 여부
- summary shape 유지 여부

### 3. HTTP Service Split

더 서비스 지향적인 구조가 필요하면 다음 단계로 전환한다.

```text
code-smell-detection-mcp
  -> advanced-pyexamine-service
  -> advanced_pyexamine.analyzer.analyze_project
```

후보 API:

```http
POST /analyze
```

요청:

```json
{
  "projectPath": "/path/to/project",
  "only": "long_method,data_clumps"
}
```

응답:

```json
{
  "summary": {},
  "smellGroups": {}
}
```

현재 CLI bridge 방식은 이 HTTP service 전환 전의 1차 검증 단계로 볼 수 있다.

