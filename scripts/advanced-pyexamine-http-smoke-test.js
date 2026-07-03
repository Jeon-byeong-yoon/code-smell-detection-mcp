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

function startMockAdvancedPyexamineService() {
  let lastRequestBody = null;

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
    request(id, tool, params) {
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

        proc.stdin.write(JSON.stringify({ id, tool, params }) + '\n');
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

function unwrapOk(message) {
  assert(!message.error, `expected no error, got ${message.error}`);
  assert(message.result?.ok === true, `expected ok=true for ${message.id}`);
  return message.result.result;
}

async function run() {
  console.log('Starting advanced_pyexamine HTTP mode smoke test...');
  const mockService = await startMockAdvancedPyexamineService();
  const server = startServer(mockService.baseUrl);
  const reader = createJsonLineReader(server);

  server.on('error', (error) => {
    reader.rejectAll(error);
  });

  try {
    await new Promise((resolve) => setTimeout(resolve, 500));

    const result = unwrapOk(await reader.request('http-mode', 'analyze_python_smells', {
      projectPath: '/mock/project',
      only: 'long_method,data_clumps',
      summaryOnly: false,
      limitPerGroup: 1,
    }));

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
