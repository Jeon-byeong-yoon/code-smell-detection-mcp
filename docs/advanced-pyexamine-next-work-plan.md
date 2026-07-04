# Advanced PyExamine 다음 작업 계획

## 현재 상태

`code-smell-detection-mcp`는 현재 `advanced_pyexamine`을 이용해 Python 코드
스멜 분석을 실행할 수 있다.

완료된 범위:

- `analyze_python_smells` MCP 도구 추가
- `advanced_pyexamine` CLI subprocess 실행 모드 추가
- `advanced-pyexamine-service`를 통한 HTTP 실행 모드 추가
- `services/advanced-pyexamine` 아래 FastAPI wrapper service 추가
- advanced-pyexamine service Docker 이미지 실행 흐름 추가
- Docker Compose 기반 통합 실행 흐름 추가
  - `mcp-server`
  - `advanced-pyexamine-service`
- MCP stdio 요청부터 Python smell summary 응답까지 로컬 E2E 검증 완료
- Docker Compose E2E CI workflow 추가
- MCP HTTP mode와 service wrapper 에러 케이스 테스트 추가
- CodeVi backend smell-analysis 저장/조회 module 구현
- MCP `save_smell_analysis`, `list_smell_analyses`, `get_smell_analysis`,
  `list_smell_findings` 도구 추가
- MCP -> CodeVi backend -> advanced-pyexamine-service -> DB 저장 -> MCP 조회
  E2E 검증 완료
- CodeVi backend에서 호출 가능한 analyzer runtime compose 추가
- runtime compose 기반 CodeVi 저장 E2E 검증 완료

중요한 점은, 실제 smell 탐지 규칙과 분석 로직은 여전히 원본
`advanced_pyexamine` repository가 소유한다는 점이다.

이 repository는 다음 역할을 담당한다.

- MCP tool interface 제공
- `advanced_pyexamine` 실행 wrapper 제공
- 응답 형식 정규화
- HTTP service wrapper 제공
- Docker / Docker Compose 실행 흐름 제공
- 검증 문서와 테스트 흐름 제공

## 현재 검증된 동작

현재 검증된 흐름은 다음과 같다.

```text
MCP stdio 요청
  -> code-smell-detection-mcp 컨테이너
  -> analyze_python_smells 도구
  -> advanced-pyexamine-service로 HTTP 요청
  -> volume mount된 advanced_pyexamine repository
  -> smell 분석 실행
  -> MCP 응답 형태로 정규화
```

대표 로컬 E2E 결과:

```json
{
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
  }
}
```

즉, MCP 서버가 Docker Compose 내부에서 Python smell 분석 service를 호출하고,
정상적으로 분석 결과를 받아오는 것까지 확인된 상태다.

CodeVi backend 저장 흐름도 추가로 검증했다.

```text
MCP save_smell_analysis
  -> CodeVi backend /api/smell-analyses
  -> advanced-pyexamine-service /analyze
  -> volume mount된 advanced_pyexamine repository
  -> smell 분석 실행
  -> CodeVi DB 저장
  -> MCP get_smell_analysis / list_smell_findings 조회
```

대표 CodeVi 저장 E2E 결과:

```json
{
  "jobId": 2,
  "status": "SUCCESS",
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

## 완료된 검증 보강

### Docker Compose E2E CI

로컬에서 검증한 Docker Compose 흐름을 CI에 추가했다.

검증 흐름:

```text
code-smell-detection-mcp checkout
  -> test fixture 기반 advanced_pyexamine source 준비
  -> docker compose -f docker-compose.example.yml build
  -> docker compose -f docker-compose.example.yml run --rm -T mcp-server
  -> MCP 응답 JSON에서 smell summary 값 검증
```

관련 파일:

```text
.github/workflows/advanced-pyexamine-compose-e2e.yml
scripts/advanced-pyexamine-compose-e2e-test.js
test-fixtures/advanced-pyexamine-source/
docs/advanced-pyexamine-compose-ci.md
```

### 에러 케이스 테스트

MCP HTTP mode와 service wrapper의 실패 응답을 검증하는 테스트를 추가했다.

검증한 케이스:

- advanced-pyexamine service HTTP 500
- service가 JSON object가 아닌 응답을 반환하는 경우
- service 응답에 필수 필드가 없는 경우
- HTTP service timeout
- 잘못된 `limitPerGroup`
- service wrapper의 404, 400, 500, 422 응답 변환

관련 파일:

```text
scripts/advanced-pyexamine-error-cases-test.js
services/advanced-pyexamine/tests/test_main.py
docs/advanced-pyexamine-error-handling.md
```

## 완료된 CodeVi backend 연동 작업

CodeVi backend에서 smell 분석 결과를 저장하고 조회하는 흐름은 1차 구현 및
검증을 완료했다.

관련 문서:

```text
docs/codevi-smell-analysis-contract.md
docs/codevi-smell-analysis-backend-2026-07-03.md
```

현재 반영된 결정:

- smell 분석 결과는 별도 `smell-analysis` domain으로 분리
- summary와 상세 finding을 분리 저장
- raw analyzer response 보존
- FAILED job 저장
- CodeVi backend가 `advanced-pyexamine-service`를 직접 HTTP 호출
- MCP는 CodeVi backend API를 호출하는 client/tool 역할 담당

## 다음 추천 작업

### 1. Analyzer container 실행 방식 고정

CodeVi backend가 호출하는 analyzer container 실행 조건은
`docker-compose.codevi-runtime.yml`로 고정했다.

```text
network: shared-net
network alias: advanced-pyexamine-service
volume:
  host pyexamine repo
  -> /opt/advanced-pyexamine-source:ro
```

실행 명령:

```bash
ADVANCED_PYEXAMINE_HOST_SOURCE_DIR="/path/to/pyexamine 2" \
npm run compose:codevi-runtime:up
```

관련 문서:

```text
docs/advanced-pyexamine-codevi-runtime.md
```

해당 runtime compose로 다음 흐름도 검증 완료했다.

```text
runtime compose up
  -> analyzer service healthy
  -> MCP save_smell_analysis
  -> CodeVi DB 저장
  -> get_smell_analysis / list_smell_findings 조회
```

검증 결과:

- `jobId: 3`
- `status: SUCCESS`
- `summary.total: 43`
- `summary.byName.long_method: 41`
- `summary.byName.data_clumps: 2`
- `list_smell_findings.total: 7`

남은 선택지는 이 runtime compose를 CodeVi repository의 운영 compose에 흡수할지,
별도 compose로 유지할지 결정하는 것이다.

### 2. CodeVi frontend dashboard 연동

backend 저장/조회 API가 동작하므로 다음 product-level 작업은 frontend 표시다.

필요 화면:

- smell analysis 실행 버튼 또는 Jenkins build 후 자동 실행 상태 표시
- latest smell summary 카드
  - total
  - severity별 개수
  - smell name별 개수
- finding table
  - severity
  - name
  - category
  - filePath
  - lineStart/lineEnd
  - entity
  - message
- 필터
  - severity
  - name
  - category
  - filePath

### 3. CodeVi backend integration/e2e test 추가

현재는 로컬 수동 E2E로 검증했다.

추가하면 좋은 테스트:

- `POST /api/smell-analyses` 성공 시 SUCCESS job 저장
- analyzer 404/500 시 FAILED job 저장
- `GET /api/smell-analyses` pagination 및 filter 검증
- `GET /api/smell-analyses/:id/findings` pagination 및 filter 검증
- 권한 없는 teamProjectId 접근 시 403 검증

이 테스트는 analyzer service를 실제로 띄우기보다 mock HTTP server 또는 service
client mock으로 시작하는 것이 빠르다.

### 4. 다국어 분석기 확장 설계

현재 구현은 Python 분석기인 `advanced_pyexamine`만 대상으로 한다.

추후 `advanced_examine`의 다른 언어 분석기를 붙이려면 언어별 실행 방식이 다르기
때문에 별도 설계가 필요하다.

언어별 예상 차이:

- TypeScript: Node 기반 CLI/runtime
- Java: JavaParser 또는 jar 실행 흐름
- C: libclang 의존성 및 native library 설정 필요
- Python: 현재 `advanced_pyexamine` service로 검증 완료

추천 구조:

```text
언어별 analyzer adapter
  -> 공통 smell response contract로 정규화
  -> MCP tool 응답 형태로 반환
```

현재 단계에서는 모든 detector 로직을 이 repository로 복사하지 않는 것이 좋다.
이 repository는 MCP orchestration과 service wrapper 역할을 유지하고, 탐지 규칙의
소유권은 각 analyzer repository에 두는 편이 안전하다.

## 추천 작업 순서

1. CodeVi backend integration/e2e test 추가
2. CodeVi frontend dashboard 연동
3. TypeScript, Java, C analyzer adapter 설계
4. 실제 운영 배포 방식 결정
   - analyzer repository checkout
   - package dependency
   - submodule
   - image 내부 vendoring

## 커밋 단위 제안

다음 작업도 커밋을 작게 나누는 것이 좋다.

```text
chore: add advanced pyexamine service runtime compose
test: add smell analysis backend integration coverage
feat: connect smell analysis dashboard summary
```

compose/runtime 정리, backend test, frontend 연동은 변경 범위가 다르므로 별도 PR로
나누는 편이 안전하다.
