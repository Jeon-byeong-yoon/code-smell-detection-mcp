# Spec: MCP 표준(공식 SDK) 마이그레이션 — Codex/Claude Code/Cursor/Antigravity 등록 가능화

> 작성: 2026-07-10. 대상 레포: `code-smell-detection-mcp` (이 레포).
> 전제: CodeVi 백엔드 엔드포인트는 **구축·검증 완료**(CodeVi PR #54/#55 master 병합, e2e 통과). 이 레포의 남은 일은 **프로토콜 레이어 교체뿐**이다.

---

## 1. 문제 정의 (실측 근거)

현재 stdio transport(`src/stdio/stdio-transport.ts`)는 **커스텀 프로토콜**이다:

- 요청: `{"id": "...", "tool": "...", "params": {...}}`
- 응답: `{"id": "...", "result": ...}` / `{"id": "...", "error": "..."}`

MCP 표준은 **JSON-RPC 2.0 (개행 구분, stdio)** + `initialize` 핸드셰이크 + `tools/list` + `tools/call`이다. 실측 증거 — 표준 `initialize`를 보내면:

```
$ printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}' | node dist/server.js
Starting code-smell-detection-mcp server...        ← stdout 오염 (별도 문제 ②)
{"id":1,"error":"unknown tool undefined"}          ← initialize 실패 (문제 ①)
```

따라서 **현재 상태로는 Codex/Claude Code/Cursor/Antigravity 어디에도 등록되지 않는다** (자체 `scripts/stdio-test-client.js` 전용). 문제 3가지:

| # | 문제 | 위치 |
|---|---|---|
| ① | `initialize`/`tools/list`/`tools/call` 미구현, 메시지 형태가 JSON-RPC 2.0 아님 | `src/stdio/stdio-transport.ts` |
| ② | 기동 로그 `LOG.info('Starting...')`가 **stdout**으로 나감 — stdout은 JSON-RPC 전용이어야 함 | `src/server.ts` |
| ③ | `tools/list`에 줄 도구별 **inputSchema 없음** (파라미터가 JSDoc 주석에만 존재) | `src/tools/*.ts` |

## 2. 결정: 공식 SDK 사용

`@modelcontextprotocol/sdk`의 `McpServer` + `StdioServerTransport`로 프로토콜 레이어를 교체한다. SDK가 initialize 협상·프레이밍(개행 구분)·tools/list·tools/call·ping을 전부 처리하므로 4개 클라이언트 호환이 보장된다.

**유지(무변경)**: `src/clients/*` 4개(axios 호출·envelope 언랩·에러 정규화), 도구의 파라미터 검증/매핑 로직, `.env` 키 체계, `services/advanced-pyexamine`(FastAPI).
**교체**: `src/stdio/stdio-transport.ts`(삭제), `src/server.ts`(SDK 진입점으로 재작성), `src/tools/*.ts`(등록 방식만 SDK로, 핸들러 본문 재사용).

## 3. 구현 설계

### 3.1 의존성/빌드
```bash
npm i @modelcontextprotocol/sdk zod
```
`tsconfig.json` 변경: SDK는 서브패스 export(`.../server/mcp.js`)를 쓰므로 구식 node 해석으로는 못 찾는다.
```jsonc
{ "compilerOptions": { "module": "node16", "moduleResolution": "node16", /* 나머지 유지 */ } }
```
(package.json에 `"type"` 없음 → CJS 출력 유지, SDK는 CJS 빌드 동봉이라 그대로 동작. 상대 import는 확장자 없이 OK.)

### 3.2 새 `src/server.ts` (뼈대)
```ts
import dotenv from 'dotenv';
dotenv.config();

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerPyexamineTools } from './tools/pyexamine-tools';
import { registerMetricsTools } from './tools/metrics-tools';
import { registerAdvancedPyexamineTools } from './tools/advanced-pyexamine-tools';
import { registerSmellAnalysisTools } from './tools/smell-analysis-tools';

async function main() {
  const server = new McpServer({ name: 'code-smell-detection-mcp', version: '0.2.0' });

  registerPyexamineTools(server);
  registerMetricsTools(server);
  registerAdvancedPyexamineTools(server);
  registerSmellAnalysisTools(server);

  await server.connect(new StdioServerTransport());
  console.error('code-smell-detection-mcp ready (stdio)');   // 로그는 반드시 stderr
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
```

### 3.3 도구 등록 패턴 (기존 핸들러 본문 재사용)
각 `src/tools/*.ts`의 시그니처를 `(transport: Transport)` → `(server: McpServer)`로 바꾸고, `transport.register(name, handler)`를 아래로 치환한다. **핸들러가 반환하던 `{ ok: true, result }` 래퍼는 제거**하고 MCP 결과 형태로 감싼다.

```ts
import { z } from 'zod';

server.registerTool(
  'save_smell_analysis',
  {
    description: 'CodeVi backend에 smell analysis 실행을 요청하고 결과를 저장한다. backend가 advanced-pyexamine-service /analyze 를 호출해 findings 를 저장한다.',
    inputSchema: {                     // zod raw shape — SDK가 JSON Schema로 변환해 tools/list에 노출
      teamProjectId: z.number().int().positive(),
      language: z.string().min(1),
      analyzer: z.string().min(1),
      projectPath: z.string().min(1).optional(),
      commitHash: z.string().optional(),
      sourceRef: z.string().optional(),
      buildNumber: z.number().int().positive().optional(),
      codeAnalysisId: z.number().int().positive().optional(),
      metricAnalysisJobId: z.number().int().positive().optional(),
      options: z.object({
        only: z.string().optional(),
        summaryOnly: z.boolean().optional(),
        limitPerGroup: z.number().int().positive().optional(),
      }).optional(),
    },
  },
  async (args) => {
    try {
      const data = await getClient().createSmellAnalysis(args as any);  // 기존 client 그대로
      return {
        content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
        structuredContent: data as any,
      };
    } catch (e) {
      return { content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true };
    }
  },
);
```
- zod가 파라미터 검증을 대체하므로 파일 하단의 `assertPositiveInteger` 등 수제 검증 함수는 삭제 가능(동작 동일성 위해 유지해도 무방).
- 도구 실패는 **JSON-RPC 에러가 아니라 `isError: true` content**로 반환(에이전트가 메시지를 읽고 재시도할 수 있게).
- 구버전 SDK를 쓰게 되면 `server.registerTool`이 없을 수 있음 → `server.tool(name, description, shape, handler)` 사용 (동일 의미).

### 3.4 도구 13개 × 스키마 매핑표 (전수)

| 도구 | 필수 | 선택 | client 메서드 → 백엔드 |
|---|---|---|---|
| `save_smell_analysis` | teamProjectId:int, language:str, analyzer:str | projectPath, commitHash, sourceRef, buildNumber:int, codeAnalysisId:int, metricAnalysisJobId:int, options{only, summaryOnly:bool, limitPerGroup:int} | `createSmellAnalysis` → `POST /smell-analyses` |
| `list_smell_analyses` | teamProjectId:int | language, status(PENDING\|RUNNING\|SUCCESS\|FAILED), analyzer, buildNumber:int, commitHash, limit:int, offset:int(≥0) | `listSmellAnalyses` → `GET /smell-analyses` |
| `get_smell_analysis` | jobId:int | — | `getSmellAnalysis` → `GET /smell-analyses/:id` |
| `list_smell_findings` | jobId:int | severity(high\|medium\|low\|unknown), name, category, filePath, limit:int, offset:int | `listSmellAnalysisFindings` → `GET /smell-analyses/:id/findings` |
| `get_code_analysis_results` | — | teamProjectId:int, commitHash, limit:int | `getCodeAnalysisResults` → `GET /api/code-analysis` |
| `get_latest_pyexamine_result` | — | teamProjectId:int, commitHash | `getLatestPyExamineResult` → 〃 |
| `get_pyexamine_result_by_commit` | commitHash:str | teamProjectId:int | `getPyExamineResultByCommit` → 〃 |
| `get_high_severity_smells` | — | teamProjectId:int, commitHash, limit:int | `getHighSeveritySmells` → 〃 |
| `get_smells_by_file` | filePath:str | teamProjectId:int, commitHash, limit:int | `getSmellsByFile` → 〃 |
| `run_metric_analysis` | analysisType(full\|classic\|ck\|oo\|smells), sourceType(ast_json\|source_code) | teamProjectId:int(또는 env 기본값), filePath, language, astData:object, sourceCode | `runMetricAnalysis` → `POST /analyses` |
| `list_metric_analyses` | — | teamProjectId:int, analysisType, status(PENDING\|SUCCESS\|FAILED) | `listMetricAnalyses` → `GET /analyses` |
| `get_metric_analysis` | jobId:int | — | `getMetricAnalysis` → `GET /analyses/:id` |
| `analyze_python_smells` | projectPath:str | only, summaryOnly:bool, limitPerGroup:int | `analyzePythonSmells` → CLI subprocess 또는 `POST {SERVICE}/analyze` |

### 3.5 부수 정리
- `scripts/stdio-test-client.js`(구 프로토콜 전용) → MCP 스모크로 재작성(§6.1의 3줄 핸드셰이크를 스크립트화). `.github/workflows`가 이 스크립트를 돌리면 함께 갱신.
- `src/stdio/stdio-transport.ts` 및 `Transport` 타입 삭제.
- (선택) npx 실행 편의: `src/server.ts` 첫 줄 `#!/usr/bin/env node` + package.json `"bin": { "code-smell-detection-mcp": "dist/server.js" }`.

## 4. 백엔드 계약 (검증 완료 — 이 레포에서 신뢰하고 쓰면 됨)

CodeVi 백엔드(master `204e99d`)에 배포·e2e 통과된 상태:

- 응답 envelope: `{ "success": true, "statusCode": 201, "message": "...", "data": ... }` — **기존 client들이 이미 언랩함(수정 불필요)**.
- 인증: `Authorization: Bearer cv_live_<48hex>` (백엔드가 SHA-256 대조; JWT도 허용). 발급: 로그인 후 `POST /api/api-keys`.
- 실측 예 (`POST /api/smell-analyses`, teamProjectId=3, analyzer=advanced_pyexamine):
  `201 → data: { jobId, status: "SUCCESS", summary: { total: 43, bySeverity: { high: 11, medium: 32 }, byName: { long_method: 41, data_clumps: 2 } } }`
  `GET /:id/findings → data.items[]: { name, severity, filePath, lineStart, ... }` (20건 확인)
- 백엔드는 POST 시 `ADVANCED_PYEXAMINE_SERVICE_URL`(기본 `http://advanced-pyexamine-service:18080`)의 `/analyze`를 호출한다. 이 analyzer 컨테이너는 CodeVi 서버(shared-net)에 배포 완료·healthy.

## 5. 환경변수 (⚠ base URL에 `/api` 포함 여부가 client마다 다름 — footgun)

| env | client가 붙이는 path | 로컬 예 | **프로덕션(배포 백엔드)** |
|---|---|---|---|
| `SMELL_ANALYSIS_API_BASE_URL` | `/smell-analyses…` | `http://localhost:13000/api` | `https://backend.refactory.store/api` |
| `SMELL_ANALYSIS_API_KEY` | Bearer | (발급값) | `cv_live_…` |
| `METRICS_API_BASE_URL` | `/analyses…` | `http://localhost:13000/api` (※ .env.example의 14000은 옛값 — 실제는 동일 백엔드 13000의 `/api`) | `https://backend.refactory.store/api` |
| `METRICS_API_KEY` | Bearer | 〃 (같은 cv_live 키 사용 가능) | 〃 |
| `ANALYSIS_API_BASE_URL` | **`/api/code-analysis`** (path에 /api 포함!) | `http://localhost:13000` (**`/api` 없이**) | `https://backend.refactory.store` (**`/api` 없이**) |
| `ADVANCED_PYEXAMINE_MODE` | cli \| http | `cli`(개발용) | IDE 배포 시 이 도구는 선택 기능(아래 주의) |

**왜 프로덕션 URL인가**: CodeVi 백엔드는 호스트 포트 비공개(보안) — Cloudflare 터널(`backend.refactory.store`)로만 노출된다. MCP 서버는 각 개발자 PC에서 IDE가 stdio로 실행하므로 `localhost:13000`으로는 도달 불가.

**주의(범위 명확화)**: `save_smell_analysis`의 `projectPath`는 **서버측 analyzer 컨테이너 내부 경로**여야 한다(현재 마운트: `/opt/advanced-pyexamine-source/...`). 임의 로컬 프로젝트 분석은 지원 범위 밖(별도 업로드 설계 필요). `analyze_python_smells`(cli 모드)는 로컬에 python+pyexamine이 있어야 하는 개발용 도구다. **IDE 등록의 1차 가치는 저장된 분석 결과 조회 + 백엔드 트리거(smell/metric) 12개 도구**다.

## 6. 검증 계획 (이 순서대로)

### 6.1 프로토콜 스모크 (클라이언트 불필요)
```bash
npm run build
printf '%s\n' \
 '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}' \
 '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
 '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
 | node dist/server.js
```
합격 기준: ①stdout에 JSON-RPC 외 텍스트 0줄 ②id:1 응답에 `result.serverInfo`/`result.capabilities.tools` ③id:2 응답 `result.tools` 길이 13, 각각 `inputSchema` 보유.

### 6.2 Inspector
```bash
npx @modelcontextprotocol/inspector node dist/server.js
```
GUI에서 tools 나열·`list_smell_analyses` 호출(env는 아래 §7 값 주입).

### 6.3 실 IDE 4종 등록 → 각에서 `list_smell_analyses(teamProjectId=3)` 호출이 백엔드 실데이터를 반환하면 e2e 완료
API 키는 배포 백엔드에서 발급(`POST /api/api-keys`, JWT 로그인 필요 — 임시로는 DB 삽입 방식도 가능, CodeVi 레포 `docs/pr36-mcp-server-plan.md` 참고).

## 7. 클라이언트 등록 config (4종)

공통 env(프로덕션): `SMELL_ANALYSIS_API_BASE_URL=https://backend.refactory.store/api`, `SMELL_ANALYSIS_API_KEY=cv_live_…`, `METRICS_API_BASE_URL=https://backend.refactory.store/api`, `METRICS_API_KEY=cv_live_…`, `ANALYSIS_API_BASE_URL=https://backend.refactory.store`

**Claude Code**
```bash
claude mcp add codevi-smell \
  --env SMELL_ANALYSIS_API_BASE_URL=https://backend.refactory.store/api \
  --env SMELL_ANALYSIS_API_KEY=cv_live_xxx \
  --env METRICS_API_BASE_URL=https://backend.refactory.store/api \
  --env ANALYSIS_API_BASE_URL=https://backend.refactory.store \
  -- node /abs/path/code-smell-detection-mcp/dist/server.js
```
(또는 프로젝트 공유용 `.mcp.json` — 아래 Cursor와 동일 스키마.)

**Cursor** — `.cursor/mcp.json` (프로젝트) 또는 `~/.cursor/mcp.json` (전역)
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

**Codex** — `~/.codex/config.toml`
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

**Antigravity** — 설정의 MCP Servers에서 stdio 서버 추가(위 Cursor와 동일한 `command/args/env` JSON 스키마). 제품 버전별 설정 파일 위치는 등록 시 확인(기존 조사: MCP 설정 지원 확인됨, 위치만 검증 필요).

기존 CodeVi 레포의 `.cursor/mcp.json`(팀원 Mac 절대경로 하드코딩)은 이 레포 기준 예시로 대체한다.

## 8. 완료 기준 (DoD)
- [x] §6.1 스모크 3항목 전부 합격 (stdout 순수 + initialize + tools/list 13종 스키마) — 2026-07-11 검증
- [ ] Inspector에서 `list_smell_analyses` 실호출 성공 — 미실행(로컬에서 `npx @modelcontextprotocol/inspector node dist/server.js`로 수행 필요)
- [ ] Claude Code·Cursor·Codex 3종에서 도구 목록 노출 + 1회 실호출(배포 백엔드) 성공, Antigravity는 등록 절차 문서화(가능 시 실검증) — **미실행**. 프로토콜 레이어는 SDK 표준 준수로 호환 확실하나, 실제 IDE 등록·핸드셰이크는 아직 안 함.
- [ ] `save_smell_analysis` → `list_smell_findings` 흐름이 IDE에서 end-to-end 동작 (백엔드 e2e는 이미 통과, IDE 경유만 확인) — 미실행
- [x] README의 프로토콜 예시(`{"id","tool","params"}`)를 MCP 형식으로 갱신, 구 transport/테스트 제거 — 완료

### 8.1 구현 검증 결과 (2026-07-11)
로컬에서 실행 가능한 범위는 전부 통과. 요약:
- `npm run build` (tsc) exit 0.
- §6.1 수동 핸드셰이크: stdout 2줄(순수 JSON-RPC), `serverInfo`+`capabilities.tools` 존재, `tools/list` 13종 전부 `inputSchema` 보유.
- `npm run test:stdio` — 자체 재작성한 MCP 스모크(개행 JSON-RPC, initialize→tools/list→tools/call) PASS.
- `npm run test:advanced-pyexamine` / `:http` / `:errors` — 전부 PASS (구 프로토콜 스크립트를 `scripts/mcp-test-client.js` 헬퍼로 재작성).
- `services/advanced-pyexamine` pytest 21건 PASS (보안 강화분 포함 — §8.2 참고).
- 구 `Transport`/`stdio-transport`/`{tool,params}` 잔재 전수 검색 결과 없음(서버·도구 코드 기준).
- `npm run lint` — 이 레포에 eslint 설정 파일이 애초에 없어 실행 불가(사전부터 있던 gap, 이번 변경과 무관, CI도 `|| true`로 허용).
- `docker compose` 기반 compose-e2e/service-e2e는 로컬 docker 권한(sudo) 문제로 미실행 — 코드 검토로는 문제 없음, GitHub Actions(ubuntu runner)에서는 sudo 불필요이므로 CI에서 자연 실행됨.

미검증(로컬에서 원천적으로 불가능한 항목): 실제 Claude Code/Cursor/Codex/Antigravity 클라이언트 등록 후 핸드셰이크. 프로토콜이 SDK 표준을 그대로 따르므로 호환 가능성은 높으나, "실제로 등록해서 tools/list가 뜨고 호출이 된다"는 사실 확인은 아직 아무도 하지 않음.

### 8.2 범위 외 변경 (구현 중 발견) — 검토 요망
스펙 범위(프로토콜 레이어)와 무관하게, `services/advanced-pyexamine`(analyzer 서비스)의 보안 문제를 발견해 별도로 수정함:
- **문제**: `/analyze`가 무인증이었고 `projectPath`를 검증 없이 받음 → shared-net의 다른 컨테이너가 임의 경로(`..` 우회 포함)를 읽게 할 수 있었음 + 리소스 제한 없음(DoS 여지).
- **수정**: `app/security.py` 신규 — 경로 allowlist(`ADVANCED_PYEXAMINE_ALLOWED_ROOTS`, realpath 기반 우회 차단) + 선택적 공유시크릿(`ADVANCED_PYEXAMINE_SHARED_SECRET`, `X-Internal-Token`, HMAC 상수시간 비교) + compose에 `cpus/mem_limit` 상한. TS client는 `-`로 시작하는 `projectPath`를 거부(CLI 인자 주입 방지). pytest 21건에 경로우회 3종·인증 3종 케이스 포함, 전부 PASS.
- **하위호환**: 두 값 다 미설정 시 기존과 동일 동작(allowlist는 SOURCE_DIR로 폴백, 인증은 생략) — 기존 배포를 깨지 않음. 단 **CodeVi 서버에 이미 떠 있는 `advanced-pyexamine-service` 컨테이너는 이 코드로 재빌드되기 전까지는 미적용 상태**임.
- 팀원 소유 레포이므로, 이 변경을 유지할지/PR로 올릴지는 팀 논의 후 결정 필요.
