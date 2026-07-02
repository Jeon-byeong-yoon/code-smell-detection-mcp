# code-smell-detection-mcp

MCP server for static analysis / code smell detection. Minimal TypeScript stdio transport implementation and tool registration stubs.

## 목표
- CodeVi 내부의 `codevi-metrics-server.ts` 단일 파일 중심 구현을 분리하여, 독립적인 MCP 도구 서버로 전환.
- NestJS, TypeORM, MySQL, Docker 구성 등 CodeVi 본체 종속 항목은 제외.
- 우선 npm 배포/사용을 목표로 함. (PyPI는 추후 Python 포팅 시 고려)

## 사용법
1. 설치

```bash
npm install
```

2. 개발 모드

```bash
npm run dev
```

3. 빌드

```bash
npm run build
```

4. 테스트

```bash
npm run test:stdio
npm run test:advanced-pyexamine
npm run test:advanced-pyexamine:http
```

5. 실행 (빌드 후)

```bash
npm start
```

## 환경 변수
복사하여 `.env`로 사용:
- `ANALYSIS_API_BASE_URL` (예: http://localhost:13000/api)
- `REQUEST_TIMEOUT_MS`
- `METRICS_API_BASE_URL` (예: http://localhost:14000)
- `METRICS_API_KEY` (필요 시)
- `METRICS_DEFAULT_TEAM_PROJECT_ID`
- `METRICS_REQUEST_TIMEOUT_MS`
- `ADVANCED_PYEXAMINE_BIN` (기본값: `python`)
- `ADVANCED_PYEXAMINE_ARGS` (기본값: `-m,advanced_pyexamine`)
- `ADVANCED_PYEXAMINE_CWD` (예: advanced_pyexamine 레포 루트)
- `ADVANCED_PYEXAMINE_TIMEOUT_MS`
- `ADVANCED_PYEXAMINE_MODE` (`cli` 또는 `http`, 기본값: `cli`)
- `ADVANCED_PYEXAMINE_SERVICE_URL` (HTTP mode, 예: http://localhost:18080)
- `ADVANCED_PYEXAMINE_SERVICE_TIMEOUT_MS`

## 제공 도구

### Metrics Analysis

- `list_metric_analyses`: CodeVi metric analysis 이력 목록 조회
- `run_metric_analysis`: CodeVi metric analysis 실행 및 저장
- `get_metric_analysis`: 저장된 metric analysis 단건 조회

### PyExamine / Code Analysis

- `get_latest_pyexamine_result`: 최신 PyExamine 결과 조회
- `get_pyexamine_result_by_commit`: commit hash 기준 PyExamine 결과 조회
- `get_high_severity_smells`: high severity smell 조회
- `get_smells_by_file`: 파일 경로 기준 smell 조회

### Advanced PyExamine

- `analyze_python_smells`: Python 프로젝트 smell 결과를 JSON으로 반환
  - `ADVANCED_PYEXAMINE_MODE=cli`: `advanced_pyexamine` CLI를 subprocess로 실행
  - `ADVANCED_PYEXAMINE_MODE=http`: `services/advanced-pyexamine` HTTP service의 `/analyze` 호출

CLI mode 예시:

```bash
printf '%s\n' '{"id":"py-smell-1","tool":"analyze_python_smells","params":{"projectPath":"/path/to/python/project"}}' \
| ADVANCED_PYEXAMINE_MODE=cli \
  ADVANCED_PYEXAMINE_BIN=python \
  ADVANCED_PYEXAMINE_ARGS=-m,advanced_pyexamine \
  ADVANCED_PYEXAMINE_CWD="/path/to/pyexamine 2" \
  node dist/server.js
```

HTTP mode 예시:

```bash
printf '%s\n' '{"id":"py-smell-5","tool":"analyze_python_smells","params":{"projectPath":"/path/to/python/project","summaryOnly":true}}' \
| ADVANCED_PYEXAMINE_MODE=http \
  ADVANCED_PYEXAMINE_SERVICE_URL=http://localhost:18080 \
  node dist/server.js
```

특정 detector만 실행하려면 `only`를 전달합니다.

```json
{ "id": "py-smell-2", "tool": "analyze_python_smells", "params": { "projectPath": "/path/to/python/project", "only": "orphan_module,data_clumps" } }
```

응답이 너무 큰 경우 `summaryOnly` 또는 `limitPerGroup`을 사용할 수 있습니다.

```json
{ "id": "py-smell-3", "tool": "analyze_python_smells", "params": { "projectPath": "/path/to/python/project", "summaryOnly": true } }
```

```json
{ "id": "py-smell-4", "tool": "analyze_python_smells", "params": { "projectPath": "/path/to/python/project", "limitPerGroup": 5 } }
```

`summary`는 항상 전체 탐지 결과 기준이며, `limitPerGroup`은 반환되는 `smellGroups`만 제한합니다.

`test:advanced-pyexamine`은 실제 `advanced_pyexamine` 레포 없이 mock CLI로 `summary`, `summaryOnly`, `limitPerGroup` 응답 처리를 검증합니다.
`test:advanced-pyexamine:http`는 mock HTTP service로 MCP HTTP mode forwarding과 응답 처리를 검증합니다.

## 원본 코드 분리 가이드
- 복사할 파일: `code-vi-internal/code-vi-back/src/mcp/codevi-metrics-server.ts`
- 옮겨야 할 항목:
  - axios 기반 REST 호출 로직 → `src/clients/analysis-client.ts`로 이동
  - 도구(tool) 등록 부분 → `src/tools/*.ts`로 분리
  - 타입 정의(인터페이스)만 `src/types/*`로 이동
  - stdio transport 또는 MCP SDK 초기화 부분 → `src/stdio/stdio-transport.ts`
- 제외할 항목:
  - NestJS 모듈/컨트롤러 전체
  - TypeORM 엔티티 / DB 설정
  - Docker/Jenkins 구성
  - 기존 CodeVi 프론트/백엔드 의존성

## Cursor / Codex / Claude 실행 예시
- Cursor/Codex 등의 도구에서 이 MCP를 사용할 때는 stdio를 통해 JSON 메시지를 주고받는 방식을 사용합니다.
- 메시지 형식 예:

```json
{ "id": "uuid-1234", "tool": "get_latest_pyexamine_result", "params": { "repo": "owner/repo", "ref": "main" } }
```

- 응답 형식 예:

```json
{ "id": "uuid-1234", "result": { /* result payload */ } }
```

## 향후 작업
- 원본 `codevi-metrics-server.ts`에서 실제 핸들러 로직을 옮겨 오기
- 오류/타입 재검토, 테스트 케이스 추가
- 필요 시 MCP 공식 SDK(stdio 외)로 transport 전환
- npm 패키지화 및 배포
