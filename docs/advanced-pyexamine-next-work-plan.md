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

## 다음 추천 작업

### 1. CI에 Docker Compose E2E 검증 추가

가장 먼저 할 작업은 로컬에서 검증한 Docker Compose 흐름을 CI로 옮기는 것이다.

목표:

- PR이 올라올 때마다 MCP 서버가 `advanced-pyexamine-service`를 정상 호출하는지
  자동 검증한다.
- MCP tool contract, HTTP service contract, Docker build, Compose service 연결이
  깨지면 CI에서 바로 실패하도록 만든다.

추천 브랜치 이름:

```text
ci-advanced-pyexamine-compose-e2e
```

예상 추가 파일:

```text
.github/workflows/advanced-pyexamine-compose-e2e.yml
test-fixtures/
  python-smells/
    ...
```

예상 CI 흐름:

```text
code-smell-detection-mcp checkout
  -> advanced_pyexamine source 준비
  -> docker compose -f docker-compose.example.yml build
  -> docker compose -f docker-compose.example.yml run --rm -T mcp-server
  -> MCP 응답 JSON에서 smell summary 값 검증
```

결정해야 할 점:

- CI 환경에서도 `advanced_pyexamine` source가 필요하다.
- 개발자 로컬 경로인 `/Users/...`에 의존하면 안 된다.
- 따라서 CI에서는 다음 중 하나를 선택해야 한다.
  - workflow 안에서 `advanced_pyexamine` repository를 checkout한다.
  - 테스트용 fixture를 이 repository 안에 둔다.
  - 장기적으로는 `advanced_pyexamine`을 package 또는 submodule로 관리한다.

현재 단계에서는 workflow에서 분석기 source를 준비하는 방식이 가장 현실적이다.

### 2. 에러 케이스 테스트 보강

CI E2E가 들어간 뒤에는 실패 상황에 대한 테스트를 추가하는 것이 좋다.

검증할 케이스:

- 존재하지 않는 `projectPath`
- advanced-pyexamine service 미실행
- HTTP service timeout
- service가 잘못된 응답을 반환하는 경우
- 잘못된 `limitPerGroup`
- 지원하지 않는 mode 값

목표는 단순히 실패시키는 것이 아니라, MCP client가 이해할 수 있는 안정적인
에러 응답 형태를 보장하는 것이다.

### 3. CodeVi backend 연동 contract 정리

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

1. CI Docker Compose E2E workflow 추가
2. CI에서 사용할 안정적인 Python smell fixture 또는 analyzer source 준비
3. MCP 응답 summary 검증 추가
4. 에러 케이스 테스트 추가
5. CodeVi backend 연동 contract 문서 작성
6. backend 저장/API 구현 시작
7. TypeScript, Java, C analyzer adapter 설계

## 커밋 단위 제안

다음 브랜치에서는 커밋을 작게 나누는 것이 좋다.

```text
ci: add advanced pyexamine compose e2e workflow
test: add python smell fixture for compose e2e
docs: document advanced pyexamine ci verification
```

CI 작업과 backend 저장/API 작업은 분리하는 것이 좋다.

CI 작업은 현재 MCP/service 통합이 계속 정상 동작하는지 검증하는 작업이고,
backend 작업은 제품 동작과 데이터 모델을 바꾸는 작업이기 때문에 별도 PR로
검토하는 편이 안전하다.
