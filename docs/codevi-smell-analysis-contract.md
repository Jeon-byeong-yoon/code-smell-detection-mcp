# CodeVi Smell Analysis Integration Contract

## 목적

이 문서는 `code-smell-detection-mcp`에서 실행한 `advanced_pyexamine`
code smell 분석 결과를 CodeVi backend에 저장하고 조회하기 위한 contract를
정의한다.

현재 MCP repository는 다음 범위까지 검증되어 있다.

- `analyze_python_smells` MCP tool
- CLI subprocess mode
- HTTP service mode
- `advanced-pyexamine-service` FastAPI wrapper
- Docker Compose 기반 MCP server + analyzer service 통합 실행
- Docker Compose E2E CI
- HTTP/service 실패 응답 테스트

다음 단계는 이 분석 결과를 CodeVi 제품 데이터로 저장하는 것이다.
따라서 backend 구현 전에 저장 단위, API payload, 상태 전이, 조회 응답을 먼저
합의해야 한다.

## 결론

1차 구현은 `smell-analysis`를 별도 domain으로 분리하는 것을 권장한다.

기존 `metric-analysis`는 complexity, CK, OO, size, Halstead 같은 정량 metric
결과를 저장하는 흐름이다. 반면 `advanced_pyexamine` 결과는 rule별 smell 목록,
severity, file/line 위치, message, detector-specific metrics를 포함한다.

따라서 두 결과를 같은 job/entity에 강하게 묶으면 다음 문제가 생긴다.

- metric 결과와 smell 결과의 schema 변경 주기가 다르다.
- smell 상세 목록은 크기가 커질 수 있어 summary 조회와 상세 조회를 분리해야 한다.
- Python 외 TypeScript, Java, C analyzer가 붙으면 언어별 상세 필드 차이가 커진다.
- 실패 원인이 parser/metric 계산 실패인지 smell detector 실패인지 구분하기 어렵다.

다만 화면에서 "한 빌드의 종합 분석 결과"로 보여야 하므로 `teamProjectId`,
`buildNumber`, `commitHash`, `sourceRef` 같은 공통 식별자는 공유한다.

## 전체 흐름

```text
CodeVi frontend 또는 backend trigger
  -> CodeVi backend smell-analysis API
  -> code-smell-detection-mcp analyze_python_smells 호출
  -> advanced-pyexamine-service
  -> advanced_pyexamine analyzer repository
  -> smellGroups + summary 반환
  -> CodeVi backend 저장
  -> dashboard/detail API로 조회
```

초기 구현에서는 Python만 대상으로 한다.
다국어 분석기는 같은 `smell-analysis` contract로 정규화한 뒤 확장한다.

## MCP 결과 Contract

현재 `analyze_python_smells`의 성공 응답은 다음 형태다.

```json
{
  "tool": "advanced_pyexamine",
  "language": "python",
  "projectPath": "/path/to/project",
  "only": "long_method,data_clumps",
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
  },
  "smellGroups": {
    "long_method": [
      {
        "name": "long_method",
        "category": "size_metric",
        "entity": "UserService.getUser",
        "location": {
          "file": "src/user_service.py",
          "line_start": 10,
          "line_end": 70
        },
        "severity": "high",
        "metrics": {
          "loc": 61,
          "threshold": 50
        },
        "related_locations": [],
        "message": "Extract Method"
      }
    ]
  }
}
```

`summaryOnly=true`인 경우 `smellGroups`는 생략될 수 있다.
CodeVi backend 저장 API는 summary와 상세 저장을 모두 지원해야 한다.

## Backend Domain

권장 module 이름:

```text
smell-analysis
```

권장 entity:

```text
SmellAnalysisJob
SmellAnalysisFinding
```

초기 구현에서 상세 finding을 별도 table로 분리하지 않고 JSON column으로 저장할 수도
있다. 하지만 dashboard에서 file, severity, smell name 기준 필터링이 필요해지면
별도 table이 유리하다.

1차 구현 권장안은 다음과 같다.

- `SmellAnalysisJob`: job metadata, summary, raw result 저장
- `SmellAnalysisFinding`: 상세 smell 목록 저장

## 저장 모델

### SmellAnalysisJob

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| `id` | number | yes | smell analysis job id |
| `teamProjectId` | number | yes | CodeVi team project id |
| `codeAnalysisId` | number | no | Jenkins/Sonar 기반 code analysis와 연결할 경우 사용 |
| `metricAnalysisJobId` | number | no | metric-analysis job과 연결할 경우 사용 |
| `buildNumber` | number | no | Jenkins build number |
| `commitHash` | string | no | 분석 대상 commit |
| `sourceRef` | string | no | branch, tag, PR ref 등 |
| `language` | string | yes | `python`, 이후 `typescript`, `java`, `c` |
| `analyzer` | string | yes | `advanced_pyexamine` |
| `analyzerVersion` | string | no | analyzer package 또는 image version |
| `status` | string | yes | `PENDING`, `RUNNING`, `SUCCESS`, `FAILED` |
| `requestedAt` | datetime | yes | 요청 시각 |
| `startedAt` | datetime | no | 실행 시작 시각 |
| `completedAt` | datetime | no | 완료 시각 |
| `durationMs` | number | no | 실행 시간 |
| `summaryTotal` | number | yes | 전체 smell 개수 |
| `summaryBySeverity` | json | yes | severity별 개수 |
| `summaryByName` | json | yes | smell name별 개수 |
| `requestOptions` | json | no | `only`, `summaryOnly`, `limitPerGroup` 등 |
| `rawResult` | json | no | MCP/service 원본 응답 |
| `errorMessage` | text | no | 실패 메시지 |
| `errorCode` | string | no | 실패 분류 |

### SmellAnalysisFinding

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | --- | --- |
| `id` | number | yes | finding id |
| `smellAnalysisJobId` | number | yes | parent job id |
| `teamProjectId` | number | yes | query 최적화를 위해 중복 저장 |
| `language` | string | yes | 분석 언어 |
| `name` | string | yes | smell rule name |
| `category` | string | no | analyzer category |
| `severity` | string | yes | `high`, `medium`, `low`, `unknown` |
| `filePath` | string | no | source relative file path |
| `lineStart` | number | no | 시작 line |
| `lineEnd` | number | no | 종료 line |
| `entity` | string | no | class, function, module 등 |
| `message` | text | no | remediation message |
| `metrics` | json | no | detector-specific metric |
| `relatedLocations` | json | no | 연관 위치 |
| `rawFinding` | json | no | analyzer 원본 finding |

## 상태 전이

```text
PENDING
  -> RUNNING
  -> SUCCESS
  -> FAILED
```

### 상태 정의

- `PENDING`: backend에 job이 생성됐지만 analyzer 호출 전
- `RUNNING`: MCP 또는 analyzer service 호출 중
- `SUCCESS`: summary와 finding 저장 완료
- `FAILED`: analyzer 호출, 응답 파싱, 저장 중 하나가 실패

`FAILED` job도 저장해야 한다. 실패 이력을 저장하지 않으면 dashboard와 MCP 호출
문제 추적이 어려워진다.

## API Contract

### 분석 실행

```http
POST /api/smell-analyses
Authorization: Bearer <jwt or api key>
Content-Type: application/json
```

요청:

```json
{
  "teamProjectId": 1,
  "codeAnalysisId": 55,
  "metricAnalysisJobId": 5,
  "buildNumber": 102,
  "commitHash": "d42f609c6f6e121eb6667449cc19d97401b0dcfb",
  "sourceRef": "main",
  "language": "python",
  "projectPath": "/opt/advanced-pyexamine-source/sample-project",
  "analyzer": "advanced_pyexamine",
  "options": {
    "only": "long_method,data_clumps",
    "summaryOnly": false,
    "limitPerGroup": 20
  }
}
```

응답:

```json
{
  "success": true,
  "statusCode": 201,
  "message": "Smell analysis created successfully",
  "data": {
    "jobId": 10,
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
      "returnedTotal": 43,
      "truncated": false
    }
  }
}
```

### 목록 조회

```http
GET /api/smell-analyses?teamProjectId=1&language=python&status=SUCCESS
Authorization: Bearer <jwt or api key>
```

응답:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Smell analyses retrieved successfully",
  "data": [
    {
      "jobId": 10,
      "status": "SUCCESS",
      "teamProjectId": 1,
      "codeAnalysisId": 55,
      "buildNumber": 102,
      "commitHash": "d42f609c6f6e121eb6667449cc19d97401b0dcfb",
      "language": "python",
      "analyzer": "advanced_pyexamine",
      "summaryTotal": 43,
      "summaryBySeverity": {
        "high": 11,
        "medium": 32
      },
      "requestedAt": "2026-07-03T10:00:00.000Z",
      "completedAt": "2026-07-03T10:00:12.000Z"
    }
  ],
  "meta": {
    "total": 1
  }
}
```

### 상세 조회

```http
GET /api/smell-analyses/:jobId
Authorization: Bearer <jwt or api key>
```

응답:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "Smell analysis retrieved successfully",
  "data": {
    "jobId": 10,
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
    "findings": [
      {
        "id": 100,
        "name": "long_method",
        "category": "size_metric",
        "severity": "high",
        "filePath": "src/user_service.py",
        "lineStart": 10,
        "lineEnd": 70,
        "entity": "UserService.getUser",
        "message": "Extract Method",
        "metrics": {
          "loc": 61,
          "threshold": 50
        }
      }
    ],
    "requestedAt": "2026-07-03T10:00:00.000Z",
    "completedAt": "2026-07-03T10:00:12.000Z",
    "errorMessage": null
  }
}
```

### Finding 조회

대시보드 필터를 위해 상세 finding은 별도 조회 API가 필요하다.

```http
GET /api/smell-analyses/:jobId/findings?severity=high&name=long_method&filePath=src/
Authorization: Bearer <jwt or api key>
```

지원 필터:

- `severity`
- `name`
- `category`
- `filePath`
- `limit`
- `offset`

## MCP Tool 확장 Contract

현재 MCP tool은 `analyze_python_smells`만 제공한다.
CodeVi backend 저장까지 연결하려면 다음 중 하나를 선택한다.

### Option A: Backend가 MCP를 직접 호출

CodeVi backend가 MCP server에 `analyze_python_smells`를 호출하고, 반환 결과를
backend DB에 저장한다.

장점:

- MCP tool contract를 그대로 활용한다.
- CodeVi backend는 analyzer별 실행 방식을 몰라도 된다.

단점:

- backend에서 MCP stdio/HTTP client 관리가 필요하다.
- 운영 환경에서 MCP server lifecycle을 관리해야 한다.

### Option B: Backend가 advanced-pyexamine-service를 직접 호출

CodeVi backend가 `advanced-pyexamine-service`의 `/analyze`를 직접 호출한다.

장점:

- HTTP service contract가 단순하다.
- backend 구현이 MCP transport에 의존하지 않는다.

단점:

- MCP wrapper와 backend wrapper가 analyzer 호출 정책을 중복 구현할 수 있다.
- 다국어 analyzer adapter가 늘어나면 backend 쪽 분기가 커진다.

### 권장

초기 제품 연동은 Option A를 권장한다.

`code-smell-detection-mcp`가 analyzer adapter와 응답 정규화 책임을 이미 갖고
있기 때문이다. CodeVi backend는 저장, 권한, 조회 API에 집중하고, analyzer 실행
방식은 MCP repository가 담당하는 구조가 더 안정적이다.

## Error Contract

실패한 smell analysis job은 다음 형식으로 저장한다.

```json
{
  "jobId": 11,
  "status": "FAILED",
  "teamProjectId": 1,
  "language": "python",
  "analyzer": "advanced_pyexamine",
  "summary": {
    "total": 0,
    "bySeverity": {},
    "byName": {}
  },
  "errorCode": "ANALYZER_SERVICE_FAILED",
  "errorMessage": "advanced_pyexamine service failed: analyzer exploded",
  "requestedAt": "2026-07-03T10:00:00.000Z",
  "completedAt": "2026-07-03T10:00:01.000Z"
}
```

권장 error code:

| 코드 | 설명 |
| --- | --- |
| `ANALYZER_NOT_CONFIGURED` | analyzer service URL, binary, source dir 설정 누락 |
| `ANALYZER_SERVICE_FAILED` | analyzer service가 4xx/5xx 반환 |
| `ANALYZER_TIMEOUT` | timeout |
| `ANALYZER_INVALID_RESPONSE` | 응답 JSON 구조가 contract와 다름 |
| `PROJECT_NOT_FOUND` | 분석 대상 path 또는 source가 없음 |
| `UNAUTHORIZED_PROJECT` | user/api key가 teamProject 접근 권한 없음 |
| `PERSISTENCE_FAILED` | 분석은 성공했지만 DB 저장 실패 |

## 권한 정책

CodeVi backend는 기존 `JwtOrApiKeyGuard`와 같은 정책을 유지한다.

권장 접근 규칙:

- JWT user는 `team_project_users_user` 관계를 통해 `teamProjectId` 접근 가능해야 한다.
- API key는 연결된 `teamProjectId`에 대해서만 실행/조회 가능해야 한다.
- `jobId` 단건 조회도 내부적으로 `teamProjectId` 접근 권한을 재검증한다.

## Dashboard Contract

frontend dashboard는 summary와 finding detail을 분리해서 조회한다.

요약 카드:

- total smell count
- high/medium/low/unknown count
- top smell names
- latest status
- last successful analysis time

상세 테이블:

- severity
- smell name
- category
- file path
- line range
- entity
- message
- metrics

## 다국어 확장 기준

향후 TypeScript, Java, C analyzer를 붙일 때도 backend 저장 contract는 유지한다.
언어별 analyzer adapter가 다음 공통 finding 형태로 정규화해야 한다.

```json
{
  "name": "long_method",
  "category": "size_metric",
  "entity": "UserService.getUser",
  "location": {
    "file": "src/user_service.ts",
    "line_start": 10,
    "line_end": 70
  },
  "severity": "high",
  "metrics": {},
  "related_locations": [],
  "message": "Extract Method"
}
```

언어별 원본 필드는 `rawFinding`에 보존한다.

## 구현 순서

1. CodeVi backend에 `smell-analysis` module skeleton 추가
2. `SmellAnalysisJob`, `SmellAnalysisFinding` entity 추가
3. create/list/detail/findings DTO 작성
4. 권한 검증을 기존 metric-analysis 정책과 맞춤
5. MCP 호출 client 추가
6. 성공/실패 job 저장 구현
7. dashboard summary API 연결
8. API smoke test와 integration test 추가

## 결정 필요 사항

backend 구현 전에 팀에서 다음을 결정해야 한다.

- `smell-analysis`를 별도 domain으로 분리하는 데 동의하는가?
- `codeAnalysisId`와 `metricAnalysisJobId` 중 어떤 연결을 필수로 둘 것인가?
- raw analyzer response를 항상 저장할 것인가, summary/detail만 저장할 것인가?
- 상세 finding을 별도 table로 저장할 것인가, JSON column으로 시작할 것인가?
- analyzer 실행은 MCP server를 통해 할 것인가, HTTP service를 직접 호출할 것인가?

## 이번 문서의 범위 밖

다음 항목은 이 contract 문서 이후 별도 PR에서 다룬다.

- CodeVi backend 실제 entity/service/controller 구현
- frontend dashboard UI 수정
- TypeScript, Java, C analyzer adapter 구현
- 운영 배포 방식 결정
  - analyzer repository checkout
  - submodule
  - package dependency
  - image vendoring
