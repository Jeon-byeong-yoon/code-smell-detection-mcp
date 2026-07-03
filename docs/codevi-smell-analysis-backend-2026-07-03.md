# CodeVi Smell Analysis Backend Implementation - 2026-07-03

## 요약

2026-07-03 기준으로 `code-smell-detection-mcp`와 `code-vi-back` 양쪽에
`smell-analysis` domain 구현을 완료했다.

완료 범위:

- MCP contract 타입 정의 (`src/types/codevi-smell-analysis.ts`)
- MCP HTTP 클라이언트 (`src/clients/smell-analysis-client.ts`)
- MCP tool 4개 (`src/tools/smell-analysis-tools.ts`)
- CodeVi backend `smell-analysis` NestJS module 전체 skeleton
- CodeVi backend와 `advanced-pyexamine-service` 간 실제 저장 E2E 검증

## 구현 환경

| 항목 | 값 |
| --- | --- |
| MCP repo | `code-smell-detection-mcp` |
| Backend repo | `code-vi-back` (code-vi-internal) |
| 참고 문서 | `docs/codevi-smell-analysis-contract.md` |
| 기준 패턴 | `metric-analysis` module |

## MCP repo 변경 내역

### 1. `src/types/codevi-smell-analysis.ts` (신규)

contract.md 전체를 TypeScript 타입으로 정의한다.

주요 타입:

- `SmellAnalysisStatus` — PENDING / RUNNING / SUCCESS / FAILED
- `SmellAnalysisErrorCode` — 7가지 에러 코드 union
- `SmellAnalysisJob` — 저장 모델 shape
- `SmellAnalysisFinding` — 개별 finding 저장 모델 shape
- `AdvancedPyexamineAnalyzeRequest/Response` — service /analyze HTTP shape
- `CreateSmellAnalysisDto` — POST /smell-analyses 요청
- `ListSmellAnalysisQuery` — GET 쿼리 파라미터
- `ListSmellAnalysisFindingQuery` — finding 필터 파라미터
- `CreateSmellAnalysisResponseDto` — POST 응답
- `SmellAnalysisListResponseDto` — GET 목록 응답
- `SmellAnalysisDetailResponseDto` — GET 단건 응답
- `SmellAnalysisFindingsResponseDto` — GET findings 응답
- `SmellAnalysisFailedJobDto` — FAILED job 저장 shape

### 2. `src/clients/smell-analysis-client.ts` (신규)

CodeVi backend `/api/smell-analyses` HTTP 클라이언트.

환경 변수:

```env
SMELL_ANALYSIS_API_BASE_URL=http://localhost:13000/api
SMELL_ANALYSIS_API_KEY=
SMELL_ANALYSIS_REQUEST_TIMEOUT_MS=15000
```

메서드:

| 메서드 | 설명 |
| --- | --- |
| `createSmellAnalysis(dto)` | POST /smell-analyses |
| `listSmellAnalyses(query)` | GET /smell-analyses |
| `getSmellAnalysis(jobId)` | GET /smell-analyses/:id |
| `listSmellAnalysisFindings(jobId, query)` | GET /smell-analyses/:id/findings |

`listSmellAnalyses`는 `teamProjectId`, `language`, `status`, `analyzer`,
`buildNumber`, `commitHash`, `limit`, `offset` 필터를 전달한다.
`listSmellAnalysisFindings` 응답은 `{ items, total, limit, offset }` 형태로
정규화된 finding 페이지를 반환한다.

### 3. `src/tools/smell-analysis-tools.ts` (신규)

MCP tool 4개 등록.

| Tool | 설명 |
| --- | --- |
| `save_smell_analysis` | 분석 실행 후 CodeVi backend에 결과 저장 |
| `list_smell_analyses` | 저장된 smell analysis 목록 조회 |
| `get_smell_analysis` | 단건 상세 조회 (findings 포함) |
| `list_smell_findings` | finding 필터 조회 (severity, name, filePath) |

### 4. `src/server.ts` (수정)

`registerSmellAnalysisTools` 등록 추가.

### 5. `.env.example` (수정)

`SMELL_ANALYSIS_API_*` 환경변수 3개 추가.

---

## CodeVi backend 변경 내역

backend 경로: `code-vi-back/src/smell-analysis/`

### 파일 구조

```text
src/smell-analysis/
├── entities/
│   ├── smell-analysis-status.enum.ts
│   ├── smell-analysis-job.entity.ts
│   └── smell-analysis-finding.entity.ts
├── dto/
│   ├── create-smell-analysis-request.dto.ts
│   ├── query-smell-analysis-request.dto.ts
│   └── smell-analysis-response.dto.ts
├── guards/
│   └── smell-analysis-jwt-or-api-key.guard.ts
├── smell-analysis.service.ts
├── smell-analysis.controller.ts
└── smell-analysis.module.ts
```

### Entities

#### SmellAnalysisJob

`metric-analysis-job.entity.ts` 패턴을 따른다.

추가 필드:

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `codeAnalysisId` | number \| null | code analysis job 연결 |
| `metricAnalysisJobId` | number \| null | metric-analysis job 연결 |
| `buildNumber` | number \| null | Jenkins build number |
| `commitHash` | varchar(64) | 분석 대상 commit |
| `sourceRef` | varchar(255) | branch, tag, PR ref |
| `language` | varchar(50) | python 등 |
| `analyzer` | varchar(100) | advanced_pyexamine 등 |
| `analyzerVersion` | varchar(100) | analyzer version |
| `startedAt` | timestamp | 실행 시작 시각 |
| `durationMs` | number | 실행 시간 |
| `summaryTotal` | number | 전체 smell 개수 |
| `summaryBySeverity` | json | severity별 개수 |
| `summaryByName` | json | smell name별 개수 |
| `requestOptions` | json | only, summaryOnly 등 |
| `rawResult` | json | 원본 응답 보존 |
| `errorCode` | varchar(100) | 실패 분류 코드 |

#### SmellAnalysisFinding

dashboard 필터링을 위해 별도 테이블로 분리한다.
`severity`, `name`, `filePath`, `teamProjectId`에 Index가 걸려 있다.

### API Endpoints

| Method | Path | Controller method |
| --- | --- | --- |
| POST | `/api/smell-analyses` | `createSmellAnalysis` |
| GET | `/api/smell-analyses` | `getSmellAnalyses` |
| GET | `/api/smell-analyses/:id` | `getSmellAnalysisDetail` |
| GET | `/api/smell-analyses/:id/findings` | `getSmellFindings` |

### 권한 정책

`metric-analysis`의 `JwtOrApiKeyGuard`와 동일한 패턴을 사용한다.

- JWT user: `team_project_users_user` 관계를 통해 teamProjectId 접근 검증
- API key: 연결된 teamProjectId에 대해서만 실행/조회 가능
- 단건 조회도 내부에서 teamProjectId 접근 권한 재검증

### Analyzer 호출 방식

초기 구현은 `advanced-pyexamine-service /analyze`를 직접 HTTP 호출한다.

```env
ADVANCED_PYEXAMINE_SERVICE_URL=http://localhost:18080
```

contract.md의 Option A (MCP server를 통한 호출)로 전환하려면
`SmellAnalysisService.callAnalyzerService`를 MCP stdio/HTTP client 호출로 교체한다.

### 빌드 확인

```bash
cd code-vi-back
npm run build
# ✅ nest build 성공 (타입 에러 없음)
```

---

## 실제 E2E 검증 결과

2026-07-03 기준으로 다음 흐름을 실제 로컬 Docker 환경에서 검증했다.

```text
MCP save_smell_analysis
  -> CodeVi backend /api/smell-analyses
  -> advanced-pyexamine-service /analyze
  -> volume mount된 advanced_pyexamine repository 분석
  -> CodeVi DB 저장
  -> MCP get/list findings 조회
```

### 실행 전제

CodeVi backend container는 analyzer service를 Docker network 내부 이름으로 호출한다.

```env
ADVANCED_PYEXAMINE_SERVICE_URL=http://advanced-pyexamine-service:18080
```

`advanced-pyexamine-service` container는 원본 pyexamine repository를 아래 경로로
read-only mount해야 한다.

```text
/opt/advanced-pyexamine-source
```

따라서 MCP/CodeVi 요청의 `projectPath`는 host path가 아니라 analyzer container
내부에서 보이는 경로를 사용해야 한다.

검증에 사용한 경로:

```text
/opt/advanced-pyexamine-source/advanced_pyexamine
```

### 검증 명령

```bash
npm run build

printf '%s\n' '{"id":"save-smell-1","tool":"save_smell_analysis","params":{"teamProjectId":1,"language":"python","analyzer":"advanced_pyexamine","projectPath":"/opt/advanced-pyexamine-source/advanced_pyexamine","options":{"only":"long_method,data_clumps","summaryOnly":false,"limitPerGroup":5}}}' \
| SMELL_ANALYSIS_API_BASE_URL=http://localhost:13000/api \
  SMELL_ANALYSIS_API_KEY="$JWT" \
  node dist/server.js
```

### 저장 실행 결과

```json
{
  "jobId": 2,
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

`summary.total`은 analyzer가 탐지한 전체 smell 수이고, `returnedTotal`은
`limitPerGroup: 5` 적용 후 응답 및 DB에 저장된 상세 finding 수다. 따라서
`summary.total: 43`, `returnedTotal: 7`, `truncated: true` 조합은 정상이다.

### 단건 조회 결과

```bash
printf '%s\n' '{"id":"get-smell-1","tool":"get_smell_analysis","params":{"jobId":2}}' \
| SMELL_ANALYSIS_API_BASE_URL=http://localhost:13000/api \
  SMELL_ANALYSIS_API_KEY="$JWT" \
  node dist/server.js
```

검증 결과:

- `jobId: 2`
- `status: SUCCESS`
- `summaryTotal: 43`
- `summaryBySeverity.high: 11`
- `summaryBySeverity.medium: 32`
- `findings` 배열 포함
- `errorMessage: null`
- `errorCode: null`

### Finding 페이지 조회 결과

```bash
printf '%s\n' '{"id":"findings-smell-1","tool":"list_smell_findings","params":{"jobId":2,"limit":5,"offset":0}}' \
| SMELL_ANALYSIS_API_BASE_URL=http://localhost:13000/api \
  SMELL_ANALYSIS_API_KEY="$JWT" \
  node dist/server.js
```

검증 결과:

```json
{
  "items": [
    {
      "name": "long_method",
      "category": "size_metric",
      "severity": "high",
      "filePath": "/opt/advanced-pyexamine-source/advanced_pyexamine/core/module_index.py",
      "lineStart": 110,
      "lineEnd": 159
    }
  ],
  "total": 7,
  "limit": 5,
  "offset": 0
}
```

### 결론

아래 흐름은 정상 동작으로 확인했다.

- MCP server build
- `save_smell_analysis` 실행
- CodeVi backend 인증 및 teamProject 접근
- backend에서 analyzer service 호출
- 실제 `advanced_pyexamine` detector 실행
- smell summary 및 finding DB 저장
- `get_smell_analysis` 상세 조회
- `list_smell_findings` pagination 조회

---

## 다음 작업

### 즉시 할 수 있는 것

1. **DB migration 실행**

   TypeORM synchronize 또는 migration 파일 생성:

   ```bash
   npm run typeorm:migration:generate -- --name=AddSmellAnalysisTables
   npm run typeorm:migration:run
   ```

2. **smoke test**

   backend 실행 후 아래 명령으로 검증:

   ```bash
   # 분석 실행
   curl -X POST http://localhost:13000/api/smell-analyses \
     -H "Authorization: Bearer $JWT" \
     -H "Content-Type: application/json" \
     -d '{
       "teamProjectId": 1,
       "language": "python",
       "analyzer": "advanced_pyexamine",
       "projectPath": "/opt/advanced-pyexamine-source/advanced_pyexamine",
       "options": { "only": "long_method,data_clumps", "summaryOnly": true }
     }'

   # 목록 조회
   curl http://localhost:13000/api/smell-analyses?teamProjectId=1 \
     -H "Authorization: Bearer $JWT"

   # 단건 조회
   curl http://localhost:13000/api/smell-analyses/1 \
     -H "Authorization: Bearer $JWT"

   # Finding 필터 조회
   curl "http://localhost:13000/api/smell-analyses/1/findings?severity=high&name=long_method" \
     -H "Authorization: Bearer $JWT"
   ```

3. **MCP tool 연동 smoke test**

   ```bash
   printf '%s\n' '{"id":"save-1","tool":"save_smell_analysis","params":{"teamProjectId":1,"language":"python","analyzer":"advanced_pyexamine","projectPath":"/opt/advanced-pyexamine-source/advanced_pyexamine","options":{"summaryOnly":true}}}' \
   | SMELL_ANALYSIS_API_BASE_URL=http://localhost:13000/api \
     SMELL_ANALYSIS_API_KEY="$JWT" \
     node dist/server.js
   ```

### 이후 작업

- analyzer container 실행 방식을 CodeVi compose 또는 별도 compose로 고정
- frontend dashboard smell analysis 카드 및 상세 테이블 연동
- CodeVi backend integration/e2e test 추가
- TypeScript, Java, C analyzer adapter 설계 (다국어 확장)

## 결정 사항 반영

contract.md의 "결정 필요 사항" 중 이번 구현에서 반영된 내용:

| 결정 사항 | 반영 내용 |
| --- | --- |
| smell-analysis 별도 domain 분리 | ✅ 별도 module로 분리 |
| 상세 finding 별도 table | ✅ SmellAnalysisFinding 별도 entity |
| rawResult 저장 | ✅ SmellAnalysisJob.rawResult json column |
| FAILED job 저장 | ✅ catch 블록에서 FAILED 상태로 저장 |
| analyzer 실행 방식 | 초기: advanced-pyexamine-service 직접 HTTP 호출 |
