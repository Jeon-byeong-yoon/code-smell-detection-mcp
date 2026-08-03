# code-smell-detection-mcp

IDE에서 Python 코드 스멜 정적 분석을 돌리기 위한 **MCP stdio 서버**.
공식 `@modelcontextprotocol/sdk` 기반이라 Claude Code / Cursor / Codex / Antigravity에
그대로 등록된다. (JSON-RPC 2.0, `initialize` / `tools/list` / `tools/call`)

```text
IDE (MCP client)  ──stdio──▶  code-smell-detection-mcp  ──HTTP──▶  codevi-pyexamine
   엔드유저 PC                    엔드유저 PC (프록시)                서버 :3003
```

이 레포가 하는 일은 **프로토콜 변환뿐**이다:

1. IDE가 `analyze_python_smells(projectPath)`를 호출한다
2. 로컬 `.py` 소스를 모아 zip으로 묶는다
3. analyzer service의 `POST /analyze` (multipart)로 올린다
4. 응답을 MCP 도구 결과 형태로 정규화해 돌려준다

**엔드유저는 analyzer의 존재를 모른다.** Python도, 분석기도 설치하지 않는다.
스멜 탐지 규칙과 분석 로직은 전부
[pyexamine](https://github.com/rlawogh1005/pyexamine)이 소유한다.

## 사용법

```bash
npm install
npm run build
npm start          # 보통은 IDE가 대신 띄운다
npm run dev
```

테스트:

```bash
npm run test:stdio                    # MCP 핸드셰이크 + tools/list + tools/call
npm run test:advanced-pyexamine       # cli 모드 (mock 분석기)
npm run test:advanced-pyexamine:http  # http 모드 — zip 업로드 + 응답 정규화
npm run test:advanced-pyexamine:errors
```

## IDE 등록

필요한 건 analyzer service 주소뿐이다.

### Claude Code

```bash
claude mcp add code-smell \
  --env ADVANCED_PYEXAMINE_MODE=http \
  --env ADVANCED_PYEXAMINE_SERVICE_URL=http://127.0.0.1:3003 \
  -- node /abs/path/code-smell-detection-mcp/dist/server.js
```

### Cursor — `.cursor/mcp.json` (프로젝트) 또는 `~/.cursor/mcp.json` (전역)

```json
{
  "mcpServers": {
    "code-smell": {
      "command": "node",
      "args": ["/abs/path/code-smell-detection-mcp/dist/server.js"],
      "env": {
        "ADVANCED_PYEXAMINE_MODE": "http",
        "ADVANCED_PYEXAMINE_SERVICE_URL": "http://127.0.0.1:3003"
      }
    }
  }
}
```

### Codex — `~/.codex/config.toml`

```toml
[mcp_servers.code-smell]
command = "node"
args = ["/abs/path/code-smell-detection-mcp/dist/server.js"]

[mcp_servers.code-smell.env]
ADVANCED_PYEXAMINE_MODE = "http"
ADVANCED_PYEXAMINE_SERVICE_URL = "http://127.0.0.1:3003"
```

### Antigravity

설정의 MCP Servers에서 stdio 서버 추가 — 위 Cursor와 동일한 `command/args/env` 스키마.

## 제공 도구 (1종)

### `analyze_python_smells`

| 파라미터 | 필수 | 설명 |
|---|---|---|
| `projectPath` | ✅ | 분석 대상 Python project path (엔드유저 로컬 경로) |
| `only` | | comma-separated detector 이름 (`"long_method,data_clumps"`) |
| `summaryOnly` | | `true`면 `smellGroups` 생략, `summary`만 반환 |
| `limitPerGroup` | | group당 최대 반환 항목 수 |

`summary`는 항상 전체 탐지 결과 기준이며, `limitPerGroup`은 반환되는 `smellGroups`만
제한한다. `only` / `summaryOnly` / `limitPerGroup`은 analyzer service가 지원하지
않으므로 이 서버가 적용한다.

`ADVANCED_PYEXAMINE_TOOL_ENABLED=false`면 도구를 노출하지 않는다.

## 환경 변수

| env | 설명 | 기본값 |
|---|---|---|
| `ADVANCED_PYEXAMINE_MODE` | `http` (analyzer service) \| `cli` (로컬 subprocess) | `cli` |
| `ADVANCED_PYEXAMINE_SERVICE_URL` | analyzer service 주소 | — (http 모드 필수) |
| `ADVANCED_PYEXAMINE_SERVICE_TIMEOUT_MS` | 업로드+분석 타임아웃 | `30000` |
| `ADVANCED_PYEXAMINE_SHARED_SECRET` | 설정 시 `X-Internal-Token` 헤더 전송 | (미설정) |
| `ADVANCED_PYEXAMINE_MAX_UPLOAD_FILES` / `_BYTES` | 업로드 상한 | `2000` / `20000000` |
| `ADVANCED_PYEXAMINE_TOOL_ENABLED` | `false`면 도구 미노출 | `true` |
| `ADVANCED_PYEXAMINE_BIN` / `ARGS` / `CWD` | cli 모드 실행 명령 | `python` / `-m,advanced_pyexamine` / — |

## 소스 업로드 동작

analyzer service는 엔드유저의 파일시스템을 볼 수 없으므로 경로가 아니라 **내용**을
보낸다. 수집 규칙:

- `.py`만 수집. `.git`·`__pycache__`·`venv`·`node_modules`·`dist` 등은 건너뛴다
- 심링크는 따라가지 않는다 (순환·의도치 않은 외부 반출 방지)
- 상한을 넘으면 **일부만 분석하지 않고 실패시킨다** — 조용히 잘라내면 사용자가
  "스멜이 없다"로 오해한다
- zip은 의존성 없이 직접 만든다 (`src/zip.ts`, zlib DEFLATE)

> ⚠ **분석 대상 소스가 analyzer service로 전송된다.** 사내 코드를 외부 서비스로
> 보내도 되는지 확인할 것. 코드를 반출하지 않으려면 cli 모드를 쓴다.

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
`id:2` 응답에 `analyze_python_smells` 1종(`inputSchema` 보유).

GUI 검증은 MCP Inspector:

```bash
npx @modelcontextprotocol/inspector node dist/server.js
```

## 보안

- **cli 인자 가드**: cli 모드는 `-`로 시작하는 `projectPath`를 거부한다(플래그 주입
  방지, `shell: false`라 셸 주입은 원천 불가).
- **업로드 상한**: 파일 수·총 바이트 상한을 넘으면 요청 자체를 거부한다.
- **프롬프트 주입 주의**: 도구 결과에 실리는 파일 경로·식별자 등은 분석 대상 코드에서
  유래한다. 신뢰할 수 없는 코드를 분석하지 말고, IDE 에이전트의 자동 승인(YOLO) 모드
  운용을 피할 것.

## 향후 작업

- **analyzer service 공개 주소 확정** — 현재 `codevi-pyexamine:3003`은 도커 내부
  DNS와 localhost로만 닿는다. 엔드유저 기계에서 닿는 주소가 필요하다.
- **analyzer service 인증** — 현재 `/analyze`는 인증이 없다. 공개하면 사용자별 키와
  레이트리밋이 필요하다.
- **npm 배포** — `npx`로 뜨게 해야 절대경로 없이 등록 config를 공유할 수 있다.
- Python 외 언어 지원 (현재 분석기는 Python 전용).
