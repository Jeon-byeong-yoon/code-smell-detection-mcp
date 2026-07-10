const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const { createMcpTestClient, unwrapToolResult } = require('./mcp-test-client');

const repoRoot = path.resolve(__dirname, '..');
const serverPath = path.join(repoRoot, 'dist', 'server.js');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const SHARED_SECRET = 'http-smoke-shared-secret';

function startMockAdvancedPyexamineService() {
  let lastRequestBody = null;
  let lastRequestHeaders = null;

  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/analyze') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ detail: 'Not found' }));
      return;
    }

    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      lastRequestBody = JSON.parse(body);
      lastRequestHeaders = req.headers;

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        tool: 'advanced_pyexamine',
        language: 'python',
        projectPath: lastRequestBody.projectPath,
        only: lastRequestBody.only,
        smellGroups: lastRequestBody.summaryOnly ? undefined : {
          long_method: [
            {
              name: 'long_method',
              severity: 'high',
              location: { file: 'sample.py', line_start: 1, line_end: 45 },
            },
          ],
        },
        summary: {
          total: 3,
          bySeverity: { high: 2, medium: 1 },
          byName: { long_method: 2, data_clumps: 1 },
        },
        response: {
          summaryOnly: Boolean(lastRequestBody.summaryOnly),
          limitPerGroup: lastRequestBody.limitPerGroup,
          returnedTotal: lastRequestBody.summaryOnly ? 0 : 1,
          truncated: true,
        },
      }));
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close: () => new Promise((closeResolve) => server.close(closeResolve)),
        getLastRequestBody: () => lastRequestBody,
        getLastRequestHeaders: () => lastRequestHeaders,
      });
    });
  });
}

function startServer(serviceUrl) {
  return spawn(process.execPath, [serverPath], {
    cwd: repoRoot,
    stdio: ['pipe', 'pipe', 'inherit'],
    env: {
      ...process.env,
      ADVANCED_PYEXAMINE_MODE: 'http',
      ADVANCED_PYEXAMINE_SERVICE_URL: serviceUrl,
      ADVANCED_PYEXAMINE_SERVICE_TIMEOUT_MS: '10000',
      ADVANCED_PYEXAMINE_SHARED_SECRET: SHARED_SECRET,
    },
  });
}

async function run() {
  console.log('Starting advanced_pyexamine HTTP mode smoke test...');
  const mockService = await startMockAdvancedPyexamineService();
  const server = startServer(mockService.baseUrl);
  const client = createMcpTestClient(server);

  server.on('error', (error) => {
    client.rejectAll(error);
  });

  try {
    await client.initialize();

    const result = unwrapToolResult(await client.callTool('analyze_python_smells', {
      projectPath: '/mock/project',
      only: 'long_method,data_clumps',
      summaryOnly: false,
      limitPerGroup: 1,
    }));

    const requestHeaders = mockService.getLastRequestHeaders();
    assert(requestHeaders['x-internal-token'] === SHARED_SECRET, 'expected X-Internal-Token header to be forwarded');

    const requestBody = mockService.getLastRequestBody();
    assert(requestBody.projectPath === '/mock/project', 'expected projectPath to be forwarded');
    assert(requestBody.only === 'long_method,data_clumps', 'expected only to be forwarded');
    assert(requestBody.summaryOnly === false, 'expected summaryOnly to be forwarded');
    assert(requestBody.limitPerGroup === 1, 'expected limitPerGroup to be forwarded');

    assert(result.tool === 'advanced_pyexamine', 'expected advanced_pyexamine tool');
    assert(result.summary.total === 3, `expected summary total=3, got ${result.summary.total}`);
    assert(result.smellGroups.long_method.length === 1, 'expected service smellGroups to be returned');
    assert(result.response.limitPerGroup === 1, 'expected limitPerGroup in response');
    assert(result.response.truncated === true, 'expected truncated response');

    console.log('advanced_pyexamine HTTP mode smoke test success.');
  } finally {
    try { server.kill(); } catch { }
    await mockService.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
