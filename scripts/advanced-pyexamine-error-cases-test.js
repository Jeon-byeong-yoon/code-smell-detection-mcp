const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const { createMcpTestClient, getToolErrorText } = require('./mcp-test-client');

const repoRoot = path.resolve(__dirname, '..');
const serverPath = path.join(repoRoot, 'dist', 'server.js');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function startMockService(handler) {
  const server = http.createServer(handler);

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

function startMcpServer(serviceUrl, extraEnv = {}) {
  return spawn(process.execPath, [serverPath], {
    cwd: repoRoot,
    stdio: ['pipe', 'pipe', 'inherit'],
    env: {
      ...process.env,
      ADVANCED_PYEXAMINE_MODE: 'http',
      ADVANCED_PYEXAMINE_SERVICE_URL: serviceUrl,
      ADVANCED_PYEXAMINE_SERVICE_TIMEOUT_MS: '1000',
      ...extraEnv,
    },
  });
}

async function withMcpServer(serviceUrl, callback, extraEnv = {}) {
  const server = startMcpServer(serviceUrl, extraEnv);
  const client = createMcpTestClient(server);

  server.on('error', (error) => {
    client.rejectAll(error);
  });

  try {
    await client.initialize();
    await callback(client);
  } finally {
    try { server.kill(); } catch { }
  }
}

function callAnalyze(client, params = {}) {
  return client.callTool('analyze_python_smells', {
    projectPath: '/mock/project',
    summaryOnly: true,
    ...params,
  });
}

function assertErrorIncludes(message, expected) {
  const errorText = getToolErrorText(message);
  assert(errorText !== undefined, `expected MCP error containing "${expected}"`);
  assert(
    errorText.includes(expected),
    `expected error to include "${expected}", got "${errorText}"`,
  );
}

async function testServiceHttpError() {
  const service = await startMockService((req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ detail: 'analyzer exploded' }));
  });

  try {
    await withMcpServer(service.baseUrl, async (client) => {
      const message = await callAnalyze(client);
      assertErrorIncludes(message, 'advanced_pyexamine service failed: analyzer exploded');
    });
  } finally {
    await service.close();
  }
}

async function testServiceInvalidJsonResponse() {
  const service = await startMockService((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('not-json');
  });

  try {
    await withMcpServer(service.baseUrl, async (client) => {
      const message = await callAnalyze(client);
      assertErrorIncludes(message, 'advanced_pyexamine service response must be an object.');
    });
  } finally {
    await service.close();
  }
}

async function testServiceInvalidSchemaResponse() {
  const service = await startMockService((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      tool: 'advanced_pyexamine',
      language: 'python',
      projectPath: '/mock/project',
      response: { summaryOnly: true, returnedTotal: 0, truncated: true },
    }));
  });

  try {
    await withMcpServer(service.baseUrl, async (client) => {
      const message = await callAnalyze(client);
      assertErrorIncludes(message, 'advanced_pyexamine service response is missing summary.');
    });
  } finally {
    await service.close();
  }
}

async function testServiceTimeout() {
  const service = await startMockService((req, res) => {
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({}));
    }, 200);
  });

  try {
    await withMcpServer(service.baseUrl, async (client) => {
      const message = await callAnalyze(client);
      assertErrorIncludes(message, 'timeout');
    }, { ADVANCED_PYEXAMINE_SERVICE_TIMEOUT_MS: '50' });
  } finally {
    await service.close();
  }
}

async function testInvalidLimitPerGroup() {
  const service = await startMockService((req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ detail: 'should not be called' }));
  });

  try {
    await withMcpServer(service.baseUrl, async (client) => {
      // limitPerGroup=0은 zod inputSchema가 protocol 레벨에서 거부한다
      const message = await callAnalyze(client, { limitPerGroup: 0 });
      assertErrorIncludes(message, 'limitPerGroup');
    });
  } finally {
    await service.close();
  }
}

async function run() {
  console.log('Starting advanced_pyexamine error case tests...');
  await testServiceHttpError();
  await testServiceInvalidJsonResponse();
  await testServiceInvalidSchemaResponse();
  await testServiceTimeout();
  await testInvalidLimitPerGroup();
  console.log('advanced_pyexamine error case tests success.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
