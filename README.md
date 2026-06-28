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

4. 실행 (빌드 후)

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
