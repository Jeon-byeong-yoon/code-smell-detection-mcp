const { spawn } = require('child_process');
const path = require('path');
const { createMcpTestClient, unwrapToolResult } = require('./mcp-test-client');

const repoRoot = path.resolve(__dirname, '..');
const serverPath = path.join(repoRoot, 'dist', 'server.js');

const serviceUrl = (process.env.ADVANCED_PYEXAMINE_SERVICE_URL || 'http://localhost:18080').replace(/\/$/, '');
const projectPath = process.env.ADVANCED_PYEXAMINE_E2E_PROJECT_PATH;
const only = process.env.ADVANCED_PYEXAMINE_E2E_ONLY || 'long_method,data_clumps';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function printSetupHelp() {
  console.error('Required setup:');
  console.error('  1. Start the FastAPI service in another terminal:');
  console.error('     ADVANCED_PYEXAMINE_SOURCE_DIR="/path/to/pyexamine 2" npm run service:advanced-pyexamine');
  console.error('  2. Run this test with a target Python project path:');
  console.error('     ADVANCED_PYEXAMINE_E2E_PROJECT_PATH="/path/to/python/project" npm run test:advanced-pyexamine:service');
  console.error('  Note: the service only analyzes paths under its allowed roots.');
  console.error('  If the target is outside ADVANCED_PYEXAMINE_SOURCE_DIR, start the service with:');
  console.error('     ADVANCED_PYEXAMINE_ALLOWED_ROOTS="/path/to/python/project" (comma-separated)');
}

async function fetchJson(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    throw new Error(`Failed to reach ${url}: ${error.message}`);
  }

  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Expected JSON from ${url}, got: ${text}`);
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${url}: ${JSON.stringify(body)}`);
  }

  return body;
}

function startMcpServer() {
  return spawn(process.execPath, [serverPath], {
    cwd: repoRoot,
    stdio: ['pipe', 'pipe', 'inherit'],
    env: {
      ...process.env,
      ADVANCED_PYEXAMINE_MODE: 'http',
      ADVANCED_PYEXAMINE_SERVICE_URL: serviceUrl,
    },
  });
}

function assertAnalysisResult(result, label) {
  assert(result.tool === 'advanced_pyexamine', `${label}: expected tool=advanced_pyexamine`);
  assert(result.language === 'python', `${label}: expected language=python`);
  assert(result.summary && Number.isInteger(result.summary.total), `${label}: expected integer summary.total`);
  assert(result.summary.total > 0, `${label}: expected at least one smell`);
  assert(result.summary.byName && typeof result.summary.byName === 'object', `${label}: expected summary.byName`);
  assert(result.response?.summaryOnly === true, `${label}: expected response.summaryOnly=true`);
  assert(result.response?.returnedTotal === 0, `${label}: expected returnedTotal=0`);
  assert(result.response?.truncated === true, `${label}: expected truncated=true`);
}

async function verifyMcpHttpMode() {
  const server = startMcpServer();
  const client = createMcpTestClient(server, { timeoutMs: 30000 });

  server.on('error', (error) => {
    client.rejectAll(error);
  });

  try {
    await client.initialize();
    const result = unwrapToolResult(await client.callTool('analyze_python_smells', {
      projectPath,
      only,
      summaryOnly: true,
    }));

    assertAnalysisResult(result, 'mcp-http-mode');
    return result;
  } finally {
    try { server.kill(); } catch { }
  }
}

async function run() {
  console.log('Starting advanced_pyexamine service E2E test...');

  if (!projectPath) {
    printSetupHelp();
    throw new Error('ADVANCED_PYEXAMINE_E2E_PROJECT_PATH is required.');
  }

  const health = await fetchJson(`${serviceUrl}/health`);
  assert(health.ok === true, 'health response should have ok=true');

  const serviceResult = await fetchJson(`${serviceUrl}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectPath,
      only,
      summaryOnly: true,
    }),
  });

  assertAnalysisResult(serviceResult, 'service-direct');

  const mcpResult = await verifyMcpHttpMode();
  assert(mcpResult.summary.total === serviceResult.summary.total, 'MCP and service totals should match');

  console.log('advanced_pyexamine service E2E test success.');
  console.log(`summary.total=${mcpResult.summary.total}`);
  console.log(`summary.byName=${JSON.stringify(mcpResult.summary.byName)}`);
}

run().catch((error) => {
  console.error(error.message);
  printSetupHelp();
  process.exit(1);
});
