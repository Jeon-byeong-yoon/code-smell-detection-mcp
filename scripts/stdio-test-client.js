/**
 * MCP stdio smoke test (docs/mcp-sdk-migration-spec.md §6.1).
 *
 * 검증 항목:
 *   1. stdout 순수성 — 모든 stdout 라인이 JSON-RPC 2.0 메시지여야 한다
 *   2. initialize 응답에 serverInfo / capabilities.tools 존재
 *   3. tools/list 응답에 도구 13종, 각각 inputSchema 보유
 *   4. tools/call(list_metric_analyses) 이 mock backend 응답을 반환
 */
const { spawn } = require('child_process');
const http = require('http');
const { createMcpTestClient } = require('./mcp-test-client');

const EXPECTED_TOOLS = [
  'get_code_analysis_results',
  'get_latest_pyexamine_result',
  'get_pyexamine_result_by_commit',
  'get_high_severity_smells',
  'get_smells_by_file',
  'run_metric_analysis',
  'list_metric_analyses',
  'get_metric_analysis',
  'analyze_python_smells',
  'save_smell_analysis',
  'list_smell_analyses',
  'get_smell_analysis',
  'list_smell_findings',
];

function startMockMetricsApi() {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url.startsWith('/analyses')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, data: [{ jobId: 1, status: 'SUCCESS' }], meta: { total: 1 } }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, message: 'Not found', statusCode: 404 }));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((closeResolve) => server.close(closeResolve)),
      });
    });
  });
}

async function run() {
  console.log('Starting MCP stdio smoke test...');
  const mockMetricsApi = await startMockMetricsApi();

  const server = spawn('node', ['dist/server.js'], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: {
      ...process.env,
      ANALYSIS_API_BASE_URL: process.env.ANALYSIS_API_BASE_URL || 'http://127.0.0.1:13000',
      METRICS_API_BASE_URL: mockMetricsApi.baseUrl,
    },
  });

  server.stdout.setEncoding('utf8');

  const failures = [];
  const responses = new Map(); // id -> message
  let buffer = '';

  const timeoutHandle = setTimeout(() => {
    failures.push('timed out waiting for responses');
    finish();
  }, 15000);

  // ADVANCED_PYEXAMINE_TOOL_ENABLED=false 시 로컬 분석 도구가 빠진 12종만 노출돼야 한다
  async function verifyToolFlagDisabled() {
    const server2 = spawn('node', ['dist/server.js'], {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, ADVANCED_PYEXAMINE_TOOL_ENABLED: 'false' },
    });

    try {
      const client = createMcpTestClient(server2);
      server2.on('error', (err) => client.rejectAll(err));
      await client.initialize();

      const list = await client.listTools();
      const names = (list.result?.tools ?? []).map((tool) => tool.name);
      if (names.length !== EXPECTED_TOOLS.length - 1 || names.includes('analyze_python_smells')) {
        failures.push(`TOOL_ENABLED=false expected 12 tools without analyze_python_smells, got: ${names.join(', ')}`);
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
    await mockMetricsApi.close();

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
    const text = msg.result?.content?.[0]?.text;
    if (typeof text !== 'string' || !text.includes('items')) {
      failures.push(`tools/call(list_metric_analyses) returned unexpected content: ${text}`);
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
          params: { name: 'list_metric_analyses', arguments: {} },
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
