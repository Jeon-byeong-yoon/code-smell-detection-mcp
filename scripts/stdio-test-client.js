/**
 * MCP stdio smoke test.
 *
 * 검증 항목:
 *   1. stdout 순수성 — 모든 stdout 라인이 JSON-RPC 2.0 메시지여야 한다
 *   2. initialize 응답에 serverInfo / capabilities.tools 존재
 *   3. tools/list 응답에 analyze_python_smells 1종, inputSchema 보유
 *   4. tools/call(analyze_python_smells) 이 mock analyzer 결과를 정규화해 반환
 *   5. ADVANCED_PYEXAMINE_TOOL_ENABLED=false 면 도구가 0종
 */
const { spawn } = require('child_process');
const path = require('path');
const { createMcpTestClient } = require('./mcp-test-client');

const EXPECTED_TOOLS = ['analyze_python_smells'];

const repoRoot = path.join(__dirname, '..');
const mockPath = path.join(repoRoot, 'scripts', 'mock-advanced-pyexamine.js');
const fixturePath = path.join(repoRoot, 'test-fixtures', 'advanced-pyexamine-source', 'sample-project');

// mock analyzer를 CLI 모드로 물려 실제 백엔드 없이 프록시 경로를 검증한다
const analyzerEnv = {
  ADVANCED_PYEXAMINE_MODE: 'cli',
  ADVANCED_PYEXAMINE_BIN: process.execPath,
  ADVANCED_PYEXAMINE_ARGS: mockPath,
  ADVANCED_PYEXAMINE_CWD: repoRoot,
};

async function run() {
  console.log('Starting MCP stdio smoke test...');

  const server = spawn('node', ['dist/server.js'], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env, ...analyzerEnv },
  });

  server.stdout.setEncoding('utf8');

  const failures = [];
  const responses = new Map(); // id -> message
  let buffer = '';

  const timeoutHandle = setTimeout(() => {
    failures.push('timed out waiting for responses');
    finish();
  }, 15000);

  // ADVANCED_PYEXAMINE_TOOL_ENABLED=false 시 도구가 노출되지 않아야 한다
  async function verifyToolFlagDisabled() {
    const server2 = spawn('node', ['dist/server.js'], {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, ...analyzerEnv, ADVANCED_PYEXAMINE_TOOL_ENABLED: 'false' },
    });

    try {
      const client = createMcpTestClient(server2);
      server2.on('error', (err) => client.rejectAll(err));
      await client.initialize();

      const list = await client.listTools();
      const names = (list.result?.tools ?? []).map((tool) => tool.name);
      if (names.length !== 0) {
        failures.push(`TOOL_ENABLED=false expected 0 tools, got: ${names.join(', ')}`);
      }
    } catch (e) {
      failures.push(`TOOL_ENABLED=false check failed: ${e.message}`);
    } finally {
      try { server2.kill(); } catch (e) { /* ignore */ }
    }
  }

  let finished = false;
  async function finish() {
    if (finished) return;
    finished = true;
    clearTimeout(timeoutHandle);
    try { server.kill(); } catch (e) { /* ignore */ }

    await verifyToolFlagDisabled();

    if (failures.length > 0) {
      console.error('MCP stdio smoke test FAILED:');
      for (const failure of failures) console.error(`  - ${failure}`);
      process.exit(1);
    }
    console.log('MCP stdio smoke test PASSED.');
    process.exit(0);
  }

  function writeLine(obj) {
    server.stdin.write(JSON.stringify(obj) + '\n');
  }

  function checkInitialize(msg) {
    if (!msg.result?.serverInfo) failures.push('initialize response is missing result.serverInfo');
    if (!msg.result?.capabilities?.tools) failures.push('initialize response is missing result.capabilities.tools');
  }

  function checkToolsList(msg) {
    const tools = msg.result?.tools;
    if (!Array.isArray(tools)) {
      failures.push('tools/list response has no result.tools array');
      return;
    }

    const names = tools.map((tool) => tool.name).sort();
    const expected = [...EXPECTED_TOOLS].sort();
    if (JSON.stringify(names) !== JSON.stringify(expected)) {
      failures.push(`tools/list mismatch — expected ${expected.length} tools, got: ${names.join(', ')}`);
    }

    for (const tool of tools) {
      if (!tool.inputSchema || typeof tool.inputSchema !== 'object') {
        failures.push(`tool ${tool.name} has no inputSchema`);
      }
    }
  }

  function checkToolCall(msg) {
    if (msg.error) {
      failures.push(`tools/call returned JSON-RPC error: ${JSON.stringify(msg.error)}`);
      return;
    }
    if (msg.result?.isError) {
      failures.push(`tools/call returned isError content: ${JSON.stringify(msg.result.content)}`);
      return;
    }
    const summary = msg.result?.structuredContent?.summary;
    if (!summary || typeof summary.total !== 'number') {
      failures.push(`tools/call(analyze_python_smells) has no summary.total: ${JSON.stringify(msg.result)}`);
      return;
    }
    if (summary.total <= 0) {
      failures.push(`tools/call(analyze_python_smells) expected findings, got total=${summary.total}`);
    }
  }

  server.stdout.on('data', (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;

      let msg;
      try {
        msg = JSON.parse(line);
      } catch (e) {
        failures.push(`stdout is not pure JSON-RPC — offending line: ${line.slice(0, 120)}`);
        continue;
      }

      if (msg.jsonrpc !== '2.0') {
        failures.push(`stdout line is not JSON-RPC 2.0: ${line.slice(0, 120)}`);
        continue;
      }

      if (msg.id !== undefined) responses.set(msg.id, msg);

      if (msg.id === 1) {
        checkInitialize(msg);
        writeLine({ jsonrpc: '2.0', method: 'notifications/initialized' });
        writeLine({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
      } else if (msg.id === 2) {
        checkToolsList(msg);
        writeLine({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'analyze_python_smells', arguments: { projectPath: fixturePath } },
        });
      } else if (msg.id === 3) {
        checkToolCall(msg);
        finish();
      }
    }
  });

  server.on('error', (err) => {
    failures.push(`failed to start server: ${err.message}`);
    finish();
  });

  server.on('exit', (code) => {
    if (!finished && !responses.has(3)) {
      failures.push(`server exited early with code ${code}`);
      finish();
    }
  });

  writeLine({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'smoke', version: '1' },
    },
  });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
