# Advanced PyExamine HTTP Mode E2E Verification

검증일: 2026-07-02

## 목적

`analyze_python_smells`가 신규 HTTP mode에서 실제 `advanced_pyexamine` 탐지 규칙을 호출하는지 검증한다.

검증 대상 흐름:

```text
MCP analyze_python_smells
  -> ADVANCED_PYEXAMINE_MODE=http
  -> services/advanced-pyexamine POST /analyze
  -> advanced_pyexamine.analyzer.analyze_project()
  -> 실제 detector 실행
  -> MCP response 반환
```

## 구현 요약

- `analyze_python_smells`는 두 실행 모드를 지원한다.
  - `ADVANCED_PYEXAMINE_MODE=cli`: 기존 `python -m advanced_pyexamine ... --json` subprocess 실행
  - `ADVANCED_PYEXAMINE_MODE=http`: `services/advanced-pyexamine` FastAPI service의 `POST /analyze` 호출
- `services/advanced-pyexamine`는 탐지 규칙을 복사하지 않는다.
- 실제 탐지 규칙은 `ADVANCED_PYEXAMINE_SOURCE_DIR`로 연결한 원본 `advanced_pyexamine` repository에서 import한다.
- service wrapper는 `advanced_pyexamine.analyzer.analyze_project()`를 호출하고, 반환된 `Smell` 객체를 MCP response shape로 normalize한다.

## 검증 환경

- MCP repository: `code-smell-detection-mcp`
- HTTP service URL: `http://localhost:18080`
- 분석 대상:

```text
/Users/jeonbyeong-yoon/Desktop/.무제 폴더/종합설계 관련/종합설계 프로젝트/pyexamine 2/advanced_pyexamine
```

- detector filter:

```text
long_method,data_clumps
```

- request option:

```json
{
  "summaryOnly": true
}
```

## 1. Service Health Check

명령어:

```bash
curl http://localhost:18080/health
```

결과:

```json
{"ok":true,"service":"advanced-pyexamine-service"}
```

판정:

- FastAPI service가 정상 기동 중이다.

## 2. Service Direct Analyze API

명령어:

```bash
curl -X POST http://localhost:18080/analyze \
  -H "Content-Type: application/json" \
  -d '{"projectPath":"/Users/jeonbyeong-yoon/Desktop/.무제 폴더/종합설계 관련/종합설계 프로젝트/pyexamine 2/advanced_pyexamine","only":"long_method,data_clumps","summaryOnly":true}'
```

결과 요약:

```json
{
  "tool": "advanced_pyexamine",
  "language": "python",
  "summary": {
    "total": 43,
    "bySeverity": {
      "high": 11,
      "medium": 32
    },
    "byName": {
      "long_method": 41,
      "data_clumps": 2
    }
  },
  "response": {
    "summaryOnly": true,
    "returnedTotal": 0,
    "truncated": true
  },
  "only": "long_method,data_clumps"
}
```

판정:

- HTTP service가 실제 `advanced_pyexamine` detector를 호출했다.
- 총 smell `43`건이 탐지됐다.
- severity 기준 결과:
  - `high`: 11
  - `medium`: 32
- detector 기준 결과:
  - `long_method`: 41
  - `data_clumps`: 2
- `summaryOnly=true`이므로 상세 `smellGroups`가 생략된 것이 정상이다.

## 3. MCP HTTP Mode E2E

명령어:

```bash
printf '%s\n' '{"id":"py-http-real-1","tool":"analyze_python_smells","params":{"projectPath":"/Users/jeonbyeong-yoon/Desktop/.무제 폴더/종합설계 관련/종합설계 프로젝트/pyexamine 2/advanced_pyexamine","only":"long_method,data_clumps","summaryOnly":true}}' \
| ADVANCED_PYEXAMINE_MODE=http \
  ADVANCED_PYEXAMINE_SERVICE_URL=http://localhost:18080 \
  node dist/server.js
```

결과 요약:

```json
{
  "id": "py-http-real-1",
  "result": {
    "ok": true,
    "result": {
      "tool": "advanced_pyexamine",
      "language": "python",
      "summary": {
        "total": 43,
        "bySeverity": {
          "high": 11,
          "medium": 32
        },
        "byName": {
          "long_method": 41,
          "data_clumps": 2
        }
      },
      "response": {
        "summaryOnly": true,
        "returnedTotal": 0,
        "truncated": true
      },
      "only": "long_method,data_clumps"
    }
  }
}
```

판정:

- MCP server가 HTTP mode로 `services/advanced-pyexamine`의 `/analyze`를 호출했다.
- service direct analyze API와 동일한 summary가 MCP response로 반환됐다.
- `MCP -> HTTP service -> advanced_pyexamine 실제 detector -> MCP response` 흐름이 정상 동작한다.

## 추가 자동 검증

아래 검증도 통과했다.

```bash
python -m unittest discover -s tests
npm run build
npm run test:advanced-pyexamine
npm run test:advanced-pyexamine:http
npm run test:stdio
git diff --check
```

## 결론

`analyze_python_smells`는 기존 CLI subprocess 방식과 신규 HTTP service 방식을 모두 지원한다.

이번 검증으로 다음 흐름이 실제 환경에서 정상 동작함을 확인했다.

```text
code-smell-detection-mcp
  -> analyze_python_smells
  -> ADVANCED_PYEXAMINE_MODE=http
  -> services/advanced-pyexamine
  -> advanced_pyexamine.analyzer.analyze_project()
  -> 실제 code smell detector 실행
  -> MCP response
```

따라서 현재 구조는 탐지 규칙을 이 repository로 복사하지 않고도, 외부 `advanced_pyexamine` repository의 실제 detector를 service wrapper를 통해 사용할 수 있다.
