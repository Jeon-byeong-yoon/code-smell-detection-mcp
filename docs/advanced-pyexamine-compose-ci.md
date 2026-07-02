# Advanced PyExamine Compose CI 검증

## 목적

이 문서는 `advanced-pyexamine-service`와 MCP 서버를 Docker Compose로 함께 실행하는
E2E 검증을 CI에서 수행하기 위한 구성 내용을 정리한다.

로컬 검증만으로는 다음 문제가 생길 수 있다.

- 개발자 로컬 경로(`/Users/...`)에만 의존할 수 있다.
- Dockerfile 또는 Compose 설정이 변경되어도 PR에서 바로 발견하지 못할 수 있다.
- MCP tool contract와 HTTP service contract가 어긋나도 늦게 발견할 수 있다.

따라서 PR마다 다음 흐름을 자동으로 검증한다.

```text
GitHub Actions
  -> Docker Compose build
  -> advanced-pyexamine-service container 실행
  -> mcp-server container 실행
  -> MCP stdio 요청 전달
  -> smell summary 응답 검증
```

## 추가된 구성

### Workflow

```text
.github/workflows/advanced-pyexamine-compose-e2e.yml
```

동작 조건:

- PR에서 관련 파일이 변경될 때 실행
- `main` push에서 관련 파일이 변경될 때 실행

주요 단계:

1. repository checkout
2. Node.js 20 설정
3. `npm ci`
4. `npm run build`
5. `npm run test:advanced-pyexamine:compose`

### E2E Script

```text
scripts/advanced-pyexamine-compose-e2e-test.js
```

역할:

- `docker compose -f docker-compose.example.yml build` 실행
- `docker compose run --rm -T mcp-server` 실행
- MCP stdio 요청을 container stdin으로 전달
- MCP JSON 응답 파싱
- smell summary 값 검증
- 검증 후 `docker compose down`으로 정리

### Test Fixture

```text
test-fixtures/advanced-pyexamine-source/
  advanced_pyexamine/
    __init__.py
    analyzer.py
  sample-project/
    sample.py
```

CI는 실제 개발자 로컬의 `advanced_pyexamine` repository 경로를 사용할 수 없다.
따라서 CI contract 검증용 최소 fixture package를 repository 안에 둔다.

이 fixture는 실제 detector 전체 구현을 복사한 것이 아니다.
MCP 서버, HTTP service wrapper, Docker Compose 연결, 응답 정규화가 깨지지 않는지
검증하기 위한 최소 analyzer contract 구현이다.

## 검증 기준

CI에서 기대하는 MCP 응답 요약:

```json
{
  "summary": {
    "total": 3,
    "bySeverity": {
      "high": 1,
      "medium": 2
    },
    "byName": {
      "long_method": 2,
      "data_clumps": 1
    }
  }
}
```

이 값이 바뀌면 다음 중 하나를 의심해야 한다.

- service wrapper가 `advanced_pyexamine.analyzer.analyze_project()` contract를 잘못 호출함
- response transformer가 smell group을 잘못 집계함
- MCP HTTP mode가 service 응답을 잘못 전달함
- Docker Compose volume mount 또는 service URL 설정이 깨짐

## 로컬 실행

repository root에서 실행한다.

```bash
npm run test:advanced-pyexamine:compose
```

기본값:

```text
ADVANCED_PYEXAMINE_HOST_SOURCE_DIR=test-fixtures/advanced-pyexamine-source
ADVANCED_PYEXAMINE_COMPOSE_PROJECT_PATH=/opt/advanced-pyexamine-source/sample-project
ADVANCED_PYEXAMINE_COMPOSE_ONLY=long_method,data_clumps
```

실제 로컬 `advanced_pyexamine` repository로도 검증할 수 있다.

```bash
ADVANCED_PYEXAMINE_HOST_SOURCE_DIR="/path/to/pyexamine 2" \
ADVANCED_PYEXAMINE_COMPOSE_PROJECT_PATH="/opt/advanced-pyexamine-source/advanced_pyexamine" \
npm run test:advanced-pyexamine:compose
```

## 현재 한계

- 이 CI는 실제 전체 `advanced_pyexamine` detector 정확도를 검증하지 않는다.
- 목적은 MCP 서버, service wrapper, Docker Compose wiring, 응답 contract 검증이다.
- 실제 detector 품질 검증은 원본 `advanced_pyexamine` repository의 테스트에서 담당하는
  것이 맞다.
