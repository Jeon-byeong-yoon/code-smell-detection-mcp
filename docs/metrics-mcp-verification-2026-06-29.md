# Metrics MCP Verification - 2026-06-29

## Summary

2026-06-29 기준 `code-smell-detection-mcp`의 메트릭 분석 MCP 호출 흐름을 CodeVi backend 및 parser 서비스와 함께 검증했다.

최종 결론은 다음과 같다.

- MCP 서버 빌드 및 stdio smoke test 통과
- `list_metric_analyses` 호출 성공
- `run_metric_analysis` 호출 성공
- `get_metric_analysis` 호출 성공
- `source_code` 입력이 CodeVi backend를 거쳐 parser `/analyze-source`로 변환되는 흐름 성공
- 분석 결과 저장 및 재조회 성공

따라서 `list_metric_analyses -> run_metric_analysis -> get_metric_analysis` 전체 플로우는 정상 동작으로 확인했다.

## Verified Environment

검증 시 사용한 주요 서비스와 포트는 다음과 같다.

- MCP project: `code-smell-detection-mcp`
- CodeVi backend API: `http://localhost:13000/api`
- CodeVi frontend: `http://localhost:5176`
- Parser tree-sitter service: `http://host.docker.internal:3001`
- Parser endpoint used by backend: `/analyze-source`
- Auth method: CodeVi JWT via `METRICS_API_KEY="$JWT"`

민감 정보인 JWT/API key 값은 문서에 남기지 않는다.

## MCP Project Verification

MCP 프로젝트 자체에서는 다음 검증을 완료했다.

```bash
npm run build
npm run test:stdio
git diff --check
```

확인 결과:

- TypeScript build 성공
- stdio smoke test 성공
- whitespace diff check 성공
- handler 예외 발생 시 stdio 응답이 timeout 대신 `{ "id": "...", "error": "..." }` 형태로 반환되도록 안정화됨

관련 커밋:

```text
82811a7 Stabilize metrics stdio smoke test
```

## Initial Issues

검증 중 다음 문제가 확인되었다.

### Wrong API Port

초기에는 `localhost:14000`으로 호출했으나 연결 실패가 발생했다.

```text
curl: (7) Failed to connect to localhost port 14000
```

실제 CodeVi backend API는 다음 주소였다.

```text
http://localhost:13000/api
```

### Authentication Required

`/api/analyses` 직접 호출 시 인증 헤더가 없으면 401이 반환되었다.

```text
Authorization header is required
```

해결:

- CodeVi 로그인 후 발급된 JWT를 사용
- MCP 호출 시 `METRICS_API_KEY="$JWT"`로 전달
- 직접 API 호출 시 `Authorization: Bearer $JWT` 헤더 사용

### Team Project Access

초기에는 `teamProjectId=1`에 대해 접근 권한 오류가 발생했다.

```text
No access to the requested team project or analysis.
```

DB 확인 결과 `team_project_users_user` 조인 테이블이 비어 있었다.

해결:

```sql
INSERT INTO team_project_users_user (teamProjectId, userId)
VALUES (1, 2);
```

이후 `teamProjectId=1`에 대한 MCP 목록 조회가 정상 동작했다.

### Parser Service Misconfiguration

`sourceType:"source_code"` 실행 시 parser 관련 오류가 발생했다.

```text
Parser service is unavailable or misconfigured.
```

원인:

- CodeVi backend의 `PARSER_URL`이 실행 중인 parser service와 맞지 않았음
- parser container가 `/analyze-source` endpoint를 제공하는 최신 상태로 재생성되어 있지 않았음

CodeVi backend `.env`는 로컬 설정으로 다음 형태가 필요했다.

```env
PARSER_URL=http://host.docker.internal:3001/analyze
PARSER_SOURCE_URL=http://host.docker.internal:3001/analyze-source
```

단, `.env`는 로컬 환경 파일이므로 커밋 대상에서 제외한다.

## Parser Endpoint Verification

parser `/analyze-source` endpoint를 backend container 내부에서 직접 검증했다.

```bash
docker exec codevi-backend node -e "fetch('http://host.docker.internal:3001/analyze-source',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({language:'typescript',sourceCode:'class UserService { getUser() { return 1; } }',fileName:'sample.ts'})}).then(async r=>console.log(r.status, await r.text())).catch(console.error)"
```

최종 결과:

```text
200
```

응답에는 CodeVi backend가 기대하는 `nodes[0].ast`가 포함되었다.

## MCP Tool Verification

아래 명령들은 `code-smell-detection-mcp` 프로젝트에서 실행했다.

공통 환경 변수:

```bash
ANALYSIS_API_BASE_URL=http://localhost:13000/api
METRICS_API_BASE_URL=http://localhost:13000/api
METRICS_API_KEY="$JWT"
```

### 1. list_metric_analyses

명령:

```bash
printf '%s\n' '{"id":"list-1","tool":"list_metric_analyses","params":{"teamProjectId":1}}' \
| ANALYSIS_API_BASE_URL=http://localhost:13000/api \
  METRICS_API_BASE_URL=http://localhost:13000/api \
  METRICS_API_KEY="$JWT" \
  node dist/server.js
```

결과:

```json
{
  "id": "list-1",
  "result": {
    "ok": true,
    "result": {
      "items": [],
      "total": 0
    }
  }
}
```

이후 실패/성공 분석 이력이 누적된 뒤에는 `/api/analyses`에서 `jobId` 목록이 정상 조회되었다.

### 2. run_metric_analysis with ast_json

parser 문제를 분리하기 위해 `ast_json` 입력으로 먼저 분석 저장 흐름을 확인했다.

명령:

```bash
printf '%s\n' '{"id":"run-1","tool":"run_metric_analysis","params":{"teamProjectId":1,"analysisType":"full","sourceType":"ast_json","filePath":"sample.ts","astData":{"type":"Program","body":[],"sourceType":"module"}}}' \
| ANALYSIS_API_BASE_URL=http://localhost:13000/api \
  METRICS_API_BASE_URL=http://localhost:13000/api \
  METRICS_API_KEY="$JWT" \
  node dist/server.js
```

결과:

```json
{
  "jobId": 2,
  "status": "SUCCESS",
  "teamProjectId": 1,
  "analysisType": "full"
}
```

### 3. get_metric_analysis for ast_json result

명령:

```bash
printf '%s\n' '{"id":"get-1","tool":"get_metric_analysis","params":{"jobId":2}}' \
| ANALYSIS_API_BASE_URL=http://localhost:13000/api \
  METRICS_API_BASE_URL=http://localhost:13000/api \
  METRICS_API_KEY="$JWT" \
  node dist/server.js
```

결과:

```json
{
  "jobId": 2,
  "status": "SUCCESS",
  "teamProjectId": 1,
  "analysisType": "full",
  "filePath": "sample.ts",
  "errorMessage": null
}
```

### 4. run_metric_analysis with source_code

parser `/analyze-source` 복구 후 실제 `source_code` 입력 경로를 검증했다.

명령:

```bash
printf '%s\n' '{"id":"run-source-1","tool":"run_metric_analysis","params":{"teamProjectId":1,"analysisType":"full","sourceType":"source_code","language":"typescript","filePath":"sample.ts","sourceCode":"class UserService { getUser() { return 1; } }"}}' \
| ANALYSIS_API_BASE_URL=http://localhost:13000/api \
  METRICS_API_BASE_URL=http://localhost:13000/api \
  METRICS_API_KEY="$JWT" \
  node dist/server.js
```

결과:

```json
{
  "id": "run-source-1",
  "result": {
    "ok": true,
    "result": {
      "jobId": 5,
      "status": "SUCCESS",
      "teamProjectId": 1,
      "analysisType": "full"
    }
  }
}
```

주요 분석 결과:

```json
{
  "summary": {
    "classCount": 2,
    "codeSmellCount": 0
  },
  "classic": {
    "cyclomaticComplexity": 1,
    "size": {
      "loc": 1,
      "sloc": 1,
      "cloc": 0,
      "ncloc": 1
    }
  },
  "smells": []
}
```

### 5. get_metric_analysis for source_code result

명령:

```bash
printf '%s\n' '{"id":"get-source-1","tool":"get_metric_analysis","params":{"jobId":5}}' \
| ANALYSIS_API_BASE_URL=http://localhost:13000/api \
  METRICS_API_BASE_URL=http://localhost:13000/api \
  METRICS_API_KEY="$JWT" \
  node dist/server.js
```

결과:

```json
{
  "id": "get-source-1",
  "result": {
    "ok": true,
    "result": {
      "jobId": 5,
      "status": "SUCCESS",
      "teamProjectId": 1,
      "analysisType": "full",
      "filePath": "sample.ts",
      "errorMessage": null
    }
  }
}
```

조회 결과에는 다음 필드가 모두 포함되었다.

- `summary`
- `classic`
- `ck`
- `oo`
- `smells`

## Direct Backend Verification

JWT가 정상인지 확인하기 위해 CodeVi backend API도 직접 호출했다.

```bash
curl -i http://localhost:13000/api/analyses \
  -H "Authorization: Bearer $JWT"
```

최종 결과:

```text
HTTP/1.1 200 OK
```

응답에는 성공/실패 분석 이력이 함께 반환되었다.

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Metric analyses retrieved successfully",
  "meta": {
    "total": 4
  }
}
```

## Final Result

최종적으로 다음 순서의 검증이 모두 성공했다.

1. CodeVi backend 인증 확인
2. team project 접근 권한 확인
3. parser `/analyze-source` 직접 호출 확인
4. MCP `list_metric_analyses` 호출 확인
5. MCP `run_metric_analysis` with `ast_json` 확인
6. MCP `get_metric_analysis` 확인
7. MCP `run_metric_analysis` with `source_code` 확인
8. MCP `get_metric_analysis` for `source_code` 확인

따라서 MCP client에서 CodeVi backend를 거쳐 parser 및 metrics analysis 저장 결과를 조회하는 전체 통합 흐름은 검증 완료 상태다.

## Remaining Cleanup

기능 검증과 별개로 남은 정리 사항은 다음과 같다.

- CodeVi backend `.env`의 parser URL 설정은 로컬 환경에 유지하되 커밋하지 않는다.
- parser 프로젝트는 현재 git 변경사항 없이 컨테이너 재빌드/재생성으로 `/analyze-source` 동작을 확인했다.
- CodeVi 쪽 변경사항은 별도 커밋으로 정리한다.
  - `codevi-metrics-server.ts`: MCP client 호환성 개선
  - `docs/history/byoon/06(agent)/2026-06-04_metrics_api_mvp_progress.md`: 검증 기록 추가
  - `.cursor/mcp.json`: 개인 로컬 설정이면 커밋하지 않는 것을 권장
- 테스트 과정에서 생성된 실패 job은 필요 시 DB에서 정리할 수 있다.

