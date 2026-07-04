# Advanced PyExamine CodeVi Runtime

## 목적

CodeVi backend의 `smell-analysis` module은 Python smell 분석 시
`advanced-pyexamine-service`를 HTTP로 호출한다.

이 문서는 CodeVi backend container가 항상 같은 이름으로 analyzer service를 찾을 수
있도록 Docker runtime을 고정하는 방법을 정리한다.

## Runtime Model

```text
CodeVi backend container
  ADVANCED_PYEXAMINE_SERVICE_URL=http://advanced-pyexamine-service:18080
  -> Docker network: shared-net
  -> advanced-pyexamine-service
       network alias: advanced-pyexamine-service
       ADVANCED_PYEXAMINE_SOURCE_DIR=/opt/advanced-pyexamine-source
       volume:
         host pyexamine repo
         -> /opt/advanced-pyexamine-source:ro
```

중요한 점은 `projectPath`가 host path가 아니라
`advanced-pyexamine-service` container 내부에서 보이는 path여야 한다는 것이다.

검증에 사용한 Python project path:

```text
/opt/advanced-pyexamine-source/advanced_pyexamine
```

## 전제 조건

`shared-net` Docker network가 있어야 한다.

CodeVi backend compose가 이미 `shared-net`을 사용한다면 별도 생성은 필요 없다.

확인:

```bash
docker network ls | grep shared-net
```

없으면 생성:

```bash
docker network create shared-net
```

## 실행

repository root에서 실행한다.

```bash
ADVANCED_PYEXAMINE_HOST_SOURCE_DIR="/path/to/pyexamine 2" \
npm run compose:codevi-runtime:up
```

이 명령은 다음 조건으로 service를 실행한다.

| 항목 | 값 |
| --- | --- |
| compose file | `docker-compose.codevi-runtime.yml` |
| image | `advanced-pyexamine-service:local` |
| Docker network | `shared-net` |
| network alias | `advanced-pyexamine-service` |
| source mount | `${ADVANCED_PYEXAMINE_HOST_SOURCE_DIR}:/opt/advanced-pyexamine-source:ro` |

## 상태 확인

```bash
ADVANCED_PYEXAMINE_HOST_SOURCE_DIR="/path/to/pyexamine 2" \
docker compose -f docker-compose.codevi-runtime.yml ps
```

```bash
ADVANCED_PYEXAMINE_HOST_SOURCE_DIR="/path/to/pyexamine 2" \
docker compose -f docker-compose.codevi-runtime.yml exec advanced-pyexamine-service sh -lc \
  'test -d /opt/advanced-pyexamine-source/advanced_pyexamine && echo ok'
```

CodeVi backend container에서 health 확인:

```bash
docker exec codevi-backend node -e "fetch('http://advanced-pyexamine-service:18080/health').then(async r=>console.log(r.status, await r.text())).catch(console.error)"
```

예상 결과:

```text
200 {"ok":true,"service":"advanced-pyexamine-service"}
```

## Analyzer 직접 검증

CodeVi backend container에서 analyzer `/analyze`를 직접 호출한다.

```bash
docker exec codevi-backend node -e "fetch('http://advanced-pyexamine-service:18080/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({projectPath:'/opt/advanced-pyexamine-source/advanced_pyexamine',only:'long_method,data_clumps',summaryOnly:true,limitPerGroup:5})}).then(async r=>console.log(r.status, await r.text())).catch(console.error)"
```

예상 결과:

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
    "truncated": true,
    "limitPerGroup": 5
  }
}
```

## MCP -> CodeVi 저장 검증

MCP repo에서 실행한다.

```bash
printf '%s\n' '{"id":"save-smell-1","tool":"save_smell_analysis","params":{"teamProjectId":1,"language":"python","analyzer":"advanced_pyexamine","projectPath":"/opt/advanced-pyexamine-source/advanced_pyexamine","options":{"only":"long_method,data_clumps","summaryOnly":false,"limitPerGroup":5}}}' \
| SMELL_ANALYSIS_API_BASE_URL=http://localhost:13000/api \
  SMELL_ANALYSIS_API_KEY="$JWT" \
  node dist/server.js
```

예상 결과:

```json
{
  "ok": true,
  "result": {
    "status": "SUCCESS",
    "summary": {
      "total": 43
    },
    "response": {
      "returnedTotal": 7,
      "truncated": true
    }
  }
}
```

## 검증 완료 기록

2026-07-04 기준으로 `docker-compose.codevi-runtime.yml` 기반 runtime에서
아래 E2E를 검증했다.

```text
MCP save_smell_analysis
  -> CodeVi backend /api/smell-analyses
  -> advanced-pyexamine-service /analyze
  -> mounted advanced_pyexamine repository
  -> CodeVi DB 저장
  -> MCP get_smell_analysis / list_smell_findings 조회
```

검증 전 상태:

- `advanced-pyexamine-service` container status: `Up ... (healthy)`
- CodeVi backend에서 health 확인:

```text
200 {"ok":true,"service":"advanced-pyexamine-service"}
```

저장 실행 결과:

```json
{
  "jobId": 3,
  "status": "SUCCESS",
  "teamProjectId": 1,
  "language": "python",
  "analyzer": "advanced_pyexamine",
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
    "summaryOnly": false,
    "returnedTotal": 7,
    "truncated": true,
    "limitPerGroup": 5
  }
}
```

상세 조회 결과:

- `get_smell_analysis` 성공
- `jobId: 3`
- `status: SUCCESS`
- `summaryTotal: 43`
- `summaryBySeverity.high: 11`
- `summaryBySeverity.medium: 32`
- 저장된 findings 7개 확인
- `errorMessage: null`
- `errorCode: null`

finding 페이지 조회 결과:

```json
{
  "total": 7,
  "limit": 5,
  "offset": 0
}
```

따라서 CodeVi runtime compose 기반으로도 다음 흐름은 정상 동작으로 확인했다.

- analyzer service health
- CodeVi backend -> analyzer service alias 접근
- MCP -> CodeVi backend 저장 요청
- 실제 advanced_pyexamine detector 실행
- CodeVi DB 저장
- MCP 상세 및 finding pagination 조회

## 중지

```bash
ADVANCED_PYEXAMINE_HOST_SOURCE_DIR="/path/to/pyexamine 2" \
npm run compose:codevi-runtime:down
```

## Troubleshooting

### `ANALYZER_SERVICE_FAILED: Analyzer service returned HTTP 404`

대부분 `projectPath`가 container 내부에 없는 경우다.

잘못된 예:

```text
/Users/.../pyexamine 2/advanced_pyexamine
/app/test-fixtures/advanced-pyexamine-source/sample_project
```

올바른 예:

```text
/opt/advanced-pyexamine-source/advanced_pyexamine
```

### `getaddrinfo ENOTFOUND advanced-pyexamine-service`

CodeVi backend와 analyzer service가 같은 Docker network에 없거나 alias가 없는 상태다.

확인:

```bash
docker inspect codevi-backend --format '{{json .NetworkSettings.Networks}}'
docker inspect advanced-pyexamine-service --format '{{json .NetworkSettings.Networks}}'
```

둘 다 `shared-net`에 있어야 한다.

### `ECONNREFUSED`

service container가 떠 있지 않거나 health check가 실패한 상태다.

```bash
ADVANCED_PYEXAMINE_HOST_SOURCE_DIR="/path/to/pyexamine 2" \
docker compose -f docker-compose.codevi-runtime.yml ps

ADVANCED_PYEXAMINE_HOST_SOURCE_DIR="/path/to/pyexamine 2" \
docker compose -f docker-compose.codevi-runtime.yml logs advanced-pyexamine-service
```
