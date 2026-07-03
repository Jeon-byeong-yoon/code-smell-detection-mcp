const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

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

function createJsonLineReader(proc) {
  let buffer = '';
  const pending = new Map();

  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    buffer += chunk;
    let newlineIndex;

    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;

      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }

      const entry = pending.get(message.id);
      if (entry) {
        pending.delete(message.id);
        entry.resolve(message);
      }
    }
  });

  return {
    request(id, params) {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`Timed out waiting for response id=${id}`));
        }, 10000);

        pending.set(id, {
          resolve: (message) => {
            clearTimeout(timeout);
            resolve(message);
          },
          reject,
        });

        proc.stdin.write(JSON.stringify({
          id,
          tool: 'analyze_python_smells',
          params: {
            projectPath: '/mock/project',
            summaryOnly: true,
            ...params,
          },
        }) + '\n');
      });
    },
    rejectAll(error) {
      for (const [id, entry] of pending.entries()) {
        pending.delete(id);
        entry.reject?.(error);
      }
    },
  };
}

async function withMcpServer(serviceUrl, callback, extraEnv = {}) {
  const server = startMcpServer(serviceUrl, extraEnv);
  const reader = createJsonLineReader(server);

  server.on('error', (error) => {
    reader.rejectAll(error);
  });

  try {
    await new Promise((resolve) => setTimeout(resolve, 500));
    await callback(reader);
  } finally {
    try { server.kill(); } catch { }
  }
}

function assertErrorIncludes(message, expected) {
  assert(message.error, `expected MCP error containing "${expected}"`);
  assert(
    message.error.includes(expected),
    `expected error to include "${expected}", got "${message.error}"`,
  );
}

async function testServiceHttpError() {
  const service = await startMockService((req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ detail: 'analyzer exploded' }));
  });

  try {
    await withMcpServer(service.baseUrl, async (reader) => {
      const message = await reader.request('http-500');
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
    await withMcpServer(service.baseUrl, async (reader) => {
      const message = await reader.request('invalid-json');
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
    await withMcpServer(service.baseUrl, async (reader) => {
      const message = await reader.request('invalid-schema');
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
    await withMcpServer(service.baseUrl, async (reader) => {
      const message = await reader.request('timeout');
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
    await withMcpServer(service.baseUrl, async (reader) => {
      const message = await reader.request('invalid-limit', { limitPerGroup: 0 });
      assertErrorIncludes(message, 'limitPerGroup must be a positive integer.');
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
