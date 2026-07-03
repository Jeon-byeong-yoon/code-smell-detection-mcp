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

## 다음 추천 작업

### 1. CodeVi backend 연동 contract 정리

MCP와 service 단독 검증은 완료된 상태다.

다음 product-level 작업은 CodeVi backend에서 smell 분석 결과를 어떻게 저장하고
조회할지 정하는 것이다.

정리해야 할 질문:

- smell 분석 결과를 기존 `metric-analysis` 기록에 붙일 것인가?
- 아니면 별도의 `smell-analysis` domain으로 분리할 것인가?
- DB에 저장할 최소 단위는 무엇인가?
  - `teamProjectId`
  - `jobId`
  - `language`
  - summary total
  - severity별 개수
  - smell name별 개수
  - 상세 smell 목록
  - 원본 analyzer response
- 실패한 smell 분석 job은 어떻게 표현할 것인가?

이 부분은 backend 코드를 작성하기 전에 문서로 먼저 합의하는 것이 좋다.

### 2. 다국어 분석기 확장 설계

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

1. CodeVi backend 연동 contract 문서 작성
2. backend 저장/API 구현 시작
3. TypeScript, Java, C analyzer adapter 설계
4. 실제 운영 배포 방식 결정
   - analyzer repository checkout
   - package dependency
   - submodule
   - image 내부 vendoring

## 커밋 단위 제안

다음 backend contract 브랜치에서는 커밋을 작게 나누는 것이 좋다.

```text
docs: define codevi smell analysis integration contract
docs: document smell analysis persistence options
```

contract 문서 작업과 backend 저장/API 구현은 분리하는 것이 좋다.

contract 문서는 팀 합의를 위한 작업이고, backend 구현은 제품 동작과 데이터 모델을
바꾸는 작업이기 때문에 별도 PR로 검토하는 편이 안전하다.
