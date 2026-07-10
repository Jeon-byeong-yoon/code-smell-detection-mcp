# code-smell-detection-mcp

MCP server for static analysis / code smell detection. 공식 `@modelcontextprotocol/sdk`
기반 **표준 MCP stdio 서버**로, Claude Code / Cursor / Codex / Antigravity에 등록해
사용할 수 있다. (JSON-RPC 2.0, `initialize` / `tools/list` / `tools/call`)

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
npm run test:stdio                    # MCP 핸드셰이크 + tools/list + tools/call 스모크
npm run test:advanced-pyexamine
npm run test:advanced-pyexamine:http
```

5. 실행 (빌드 후)

```bash
npm start
```

## MCP 프로토콜 스모크 (수동)

```bash
npm run build
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
 | node dist/server.js
```

합격 기준: stdout에 JSON-RPC 외 텍스트 0줄, `id:1` 응답에 `result.serverInfo`,
`id:2` 응답에 도구 13종(각각 `inputSchema` 보유).

GUI 검증은 MCP Inspector 사용:

```bash
npx @modelcontextprotocol/inspector node dist/server.js
```

## 환경 변수

⚠ **base URL에 `/api` 포함 여부가 client마다 다름** — `.env.example` 참고.

| env | client가 붙이는 path | 로컬 예 | 프로덕션(배포 백엔드) |
|---|---|---|---|
| `SMELL_ANALYSIS_API_BASE_URL` | `/smell-analyses…` | `http://localhost:13000/api` | `https://backend.refactory.store/api` |
| `SMELL_ANALYSIS_API_KEY` | Bearer | (발급값) | `cv_live_…` |
| `METRICS_API_BASE_URL` | `/analyses…` | `http://localhost:13000/api` | `https://backend.refactory.store/api` |
| `METRICS_API_KEY` | Bearer | 〃 | 〃 |
| `ANALYSIS_API_BASE_URL` | **`/api/code-analysis`** (path에 /api 포함!) | `http://localhost:13000` (**`/api` 없이**) | `https://backend.refactory.store` (**`/api` 없이**) |
| `ADVANCED_PYEXAMINE_MODE` | cli \| http | `cli`(개발용) | IDE 배포 시 선택 기능 |
| `ADVANCED_PYEXAMINE_TOOL_ENABLED` | — | `true` | **IDE 등록 시 `false` 권장** (로컬 FS를 읽는 개발용 도구 제외 → 12개 노출) |
| `ADVANCED_PYEXAMINE_SHARED_SECRET` | `X-Internal-Token` | (미설정=인증 생략) | analyzer service 인증용 — service와 동일 값 |

API 키 발급: 배포 백엔드 로그인 후 `POST /api/api-keys` → `cv_live_<48hex>`.
**키는 최소 권한으로**: IDE에 등록한 키의 접근 범위가 곧 에이전트의 접근 범위다(조회 + `save_smell_analysis`/`run_metric_analysis` 쓰기 포함). 가능하면 프로젝트 단위로 스코프된 키를 발급하고 주기적으로 로테이션한다.

advanced_pyexamine 관련 나머지 변수(`ADVANCED_PYEXAMINE_BIN/ARGS/CWD/TIMEOUT_MS`,
`ADVANCED_PYEXAMINE_SERVICE_URL` 등)는 `.env.example` 참고.

## IDE 등록 (4종)

공통 env(프로덕션): `SMELL_ANALYSIS_API_BASE_URL=https://backend.refactory.store/api`,
`SMELL_ANALYSIS_API_KEY=cv_live_…`, `METRICS_API_BASE_URL=https://backend.refactory.store/api`,
`METRICS_API_KEY=cv_live_…`, `ANALYSIS_API_BASE_URL=https://backend.refactory.store`

### Claude Code

```bash
claude mcp add codevi-smell \
  --env SMELL_ANALYSIS_API_BASE_URL=https://backend.refactory.store/api \
  --env SMELL_ANALYSIS_API_KEY=cv_live_xxx \
  --env METRICS_API_BASE_URL=https://backend.refactory.store/api \
  --env METRICS_API_KEY=cv_live_xxx \
  --env ANALYSIS_API_BASE_URL=https://backend.refactory.store \
  -- node /abs/path/code-smell-detection-mcp/dist/server.js
```

(프로젝트 공유용으로는 `.mcp.json` — 아래 Cursor와 동일 스키마.)

### Cursor — `.cursor/mcp.json` (프로젝트) 또는 `~/.cursor/mcp.json` (전역)

```json
{
  "mcpServers": {
    "codevi-smell": {
      "command": "node",
      "args": ["/abs/path/code-smell-detection-mcp/dist/server.js"],
      "env": {
        "SMELL_ANALYSIS_API_BASE_URL": "https://backend.refactory.store/api",
        "SMELL_ANALYSIS_API_KEY": "cv_live_xxx",
        "METRICS_API_BASE_URL": "https://backend.refactory.store/api",
        "METRICS_API_KEY": "cv_live_xxx",
        "ANALYSIS_API_BASE_URL": "https://backend.refactory.store"
      }
    }
  }
}
```

### Codex — `~/.codex/config.toml`

```toml
[mcp_servers.codevi-smell]
command = "node"
args = ["/abs/path/code-smell-detection-mcp/dist/server.js"]

[mcp_servers.codevi-smell.env]
SMELL_ANALYSIS_API_BASE_URL = "https://backend.refactory.store/api"
SMELL_ANALYSIS_API_KEY = "cv_live_xxx"
METRICS_API_BASE_URL = "https://backend.refactory.store/api"
METRICS_API_KEY = "cv_live_xxx"
ANALYSIS_API_BASE_URL = "https://backend.refactory.store"
```

### Antigravity

설정의 MCP Servers에서 stdio 서버 추가 — 위 Cursor와 동일한 `command/args/env`
JSON 스키마를 사용한다. (제품 버전별 설정 파일 위치는 등록 시 확인.)

**범위 주의**: `save_smell_analysis`의 `projectPath`는 서버측 analyzer 컨테이너
내부 경로(`/opt/advanced-pyexamine-source/...`)여야 한다. 임의 로컬 프로젝트 분석은
지원 범위 밖. `analyze_python_smells`(cli 모드)는 로컬에 python + advanced_pyexamine이
필요한 개발용 도구다. IDE 등록의 1차 가치는 저장된 분석 결과 조회 + 백엔드 트리거
(smell/metric) 12개 도구다 — 그래서 IDE 등록 시에는 각 config의 `env`에
`"ADVANCED_PYEXAMINE_TOOL_ENABLED": "false"`를 추가해 로컬 분석 도구를 빼는 것을 권장한다.

## 보안 설계 요약

- **analyzer service 인가**: `/analyze`는 `ADVANCED_PYEXAMINE_ALLOWED_ROOTS`
  (미설정 시 `ADVANCED_PYEXAMINE_SOURCE_DIR`) 하위 경로만 분석한다. realpath 정규화로
  `..`·심링크 우회를 차단하며, 허용 루트 밖은 403.
- **analyzer service 인증**: `ADVANCED_PYEXAMINE_SHARED_SECRET` 설정 시 `/analyze`가
  `X-Internal-Token` 헤더를 요구한다(상수시간 비교). MCP server(http 모드)는 같은 env를
  헤더로 전송한다. 호출자인 CodeVi backend에도 같은 헤더 전송 설정이 필요하다.
- **자원 제한**: compose에서 analyzer service에 `cpus`/`mem_limit` 상한 적용.
- **cli 인자 가드**: `analyze_python_smells`(cli 모드)는 `-`로 시작하는 `projectPath`를
  거부한다(플래그 주입 방지, `shell: false`라 셸 주입은 원천 불가).
- **프롬프트 주입 주의**: 도구 결과에 실리는 파일 경로·식별자 등은 분석 대상 코드에서
  유래한다. 신뢰할 수 없는 코드를 분석하지 말고, IDE 에이전트의 자동 승인(YOLO) 모드
  운용을 피할 것.

## 제공 도구 (13종)

### Smell Analysis (CodeVi backend)

- `save_smell_analysis`: smell analysis 실행 요청 및 결과 저장 (backend가 analyzer 호출)
- `list_smell_analyses`: 저장된 smell analysis 목록 조회
- `get_smell_analysis`: 단건 상세 조회 (findings 포함)
- `list_smell_findings`: finding 필터 조회 (severity, name, filePath 등)

### Metrics Analysis

- `run_metric_analysis`: CodeVi metric analysis 실행 및 저장
- `list_metric_analyses`: metric analysis 이력 목록 조회
- `get_metric_analysis`: 저장된 metric analysis 단건 조회

### PyExamine / Code Analysis

- `get_code_analysis_results`: 저장된 code-analysis 결과 목록 조회 (최신순)
- `get_latest_pyexamine_result`: 최신 PyExamine 결과 조회
- `get_pyexamine_result_by_commit`: commit hash 기준 PyExamine 결과 조회
- `get_high_severity_smells`: high severity smell 조회
- `get_smells_by_file`: 파일 경로 기준 smell 조회

### Advanced PyExamine (개발용)

- `analyze_python_smells`: Python 프로젝트 smell 결과를 JSON으로 반환
  - `ADVANCED_PYEXAMINE_MODE=cli`: `advanced_pyexamine` CLI를 subprocess로 실행
  - `ADVANCED_PYEXAMINE_MODE=http`: `services/advanced-pyexamine` HTTP service의 `/analyze` 호출

도구 호출은 표준 MCP `tools/call`로 이루어진다. 수동 테스트 예:

```bash
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"cli","version":"1"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"analyze_python_smells","arguments":{"projectPath":"/path/to/python/project","summaryOnly":true}}}' \
 | ADVANCED_PYEXAMINE_MODE=http ADVANCED_PYEXAMINE_SERVICE_URL=http://localhost:18080 node dist/server.js
```

`only`(detector 필터), `summaryOnly`, `limitPerGroup` 파라미터를 지원한다.
`summary`는 항상 전체 탐지 결과 기준이며, `limitPerGroup`은 반환되는 `smellGroups`만 제한한다.

## advanced-pyexamine HTTP service

HTTP service 실행:

```bash
ADVANCED_PYEXAMINE_SOURCE_DIR="/path/to/pyexamine 2" npm run service:advanced-pyexamine
```

HTTP service Docker 실행:

```bash
docker build -t advanced-pyexamine-service:local services/advanced-pyexamine

docker run --rm \
  -p 18080:18080 \
  -e ADVANCED_PYEXAMINE_SOURCE_DIR=/opt/advanced-pyexamine-source \
  -v "/path/to/pyexamine 2:/opt/advanced-pyexamine-source:ro" \
  advanced-pyexamine-service:local
```

자세한 Docker workflow는 `docs/advanced-pyexamine-service-docker.md`를 참고합니다.

CodeVi backend에서 `advanced-pyexamine-service`를 호출할 수 있도록 runtime service만
고정 실행:

```bash
ADVANCED_PYEXAMINE_HOST_SOURCE_DIR="/path/to/pyexamine 2" \
npm run compose:codevi-runtime:up
```

이 compose는 `advanced-pyexamine-service`를 외부 Docker network `shared-net`에
연결하고, CodeVi backend가 `http://advanced-pyexamine-service:18080`으로 호출할 수
있게 network alias를 고정합니다.

CodeVi backend에 전달할 분석 경로는 host path가 아니라 container path를 사용합니다.

```text
/opt/advanced-pyexamine-source/advanced_pyexamine
```

중지:

```bash
ADVANCED_PYEXAMINE_HOST_SOURCE_DIR="/path/to/pyexamine 2" \
npm run compose:codevi-runtime:down
```

자세한 CodeVi runtime workflow는 `docs/advanced-pyexamine-codevi-runtime.md`를 참고합니다.

실제 HTTP service E2E 검증:

```bash
ADVANCED_PYEXAMINE_SERVICE_URL=http://localhost:18080 \
ADVANCED_PYEXAMINE_E2E_PROJECT_PATH="/path/to/python/project" \
npm run test:advanced-pyexamine:service
```

`test:advanced-pyexamine`은 실제 `advanced_pyexamine` 레포 없이 mock CLI로 `summary`, `summaryOnly`, `limitPerGroup` 응답 처리를 검증합니다.
`test:advanced-pyexamine:http`는 mock HTTP service로 HTTP mode forwarding과 응답 처리를 검증합니다.
`test:advanced-pyexamine:service`는 이미 실행 중인 실제 FastAPI service를 대상으로 `/health`, `/analyze`를 함께 검증합니다.

CodeVi backend 연동 contract는 `docs/codevi-smell-analysis-contract.md`를 참고합니다.
MCP SDK 마이그레이션 배경/설계는 `docs/mcp-sdk-migration-spec.md`를 참고합니다.

## 향후 작업
- npm 패키지화 및 배포 (`bin`: `code-smell-detection-mcp`)
- 오류/타입 재검토, 테스트 케이스 추가
- CodeVi backend smell analysis contract에 맞춘 저장/API 구현은 별도 backend repo에서 진행
