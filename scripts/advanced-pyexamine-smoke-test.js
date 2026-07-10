const { spawn } = require('child_process');
const path = require('path');
const { createMcpTestClient, unwrapToolResult, getToolErrorText } = require('./mcp-test-client');

const repoRoot = path.resolve(__dirname, '..');
const serverPath = path.join(repoRoot, 'dist', 'server.js');
const mockPath = path.join(repoRoot, 'scripts', 'mock-advanced-pyexamine.js');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function startServer() {
  return spawn(process.execPath, [serverPath], {
    cwd: repoRoot,
    stdio: ['pipe', 'pipe', 'inherit'],
    env: {
      ...process.env,
      ADVANCED_PYEXAMINE_BIN: process.execPath,
      ADVANCED_PYEXAMINE_ARGS: mockPath,
      ADVANCED_PYEXAMINE_CWD: repoRoot,
    },
  });
}

async function run() {
  console.log('Starting advanced_pyexamine smoke test...');
  const server = startServer();
  const client = createMcpTestClient(server);

  server.on('error', (error) => {
    client.rejectAll(error);
  });

  try {
    await client.initialize();

    const full = unwrapToolResult(await client.callTool('analyze_python_smells', {
      projectPath: '/mock/project',
    }));
    assert(full.summary.total === 4, `expected full summary total=4, got ${full.summary.total}`);
    assert(full.summary.bySeverity.high === 2, 'expected high severity count=2');
    assert(full.summary.bySeverity.medium === 2, 'expected medium severity count=2');
    assert(full.smellGroups.long_method.length === 2, 'expected full long_method group length=2');
    assert(full.response.returnedTotal === 4, `expected returnedTotal=4, got ${full.response.returnedTotal}`);
    assert(full.response.truncated === false, 'expected full response not truncated');

    const summaryOnly = unwrapToolResult(await client.callTool('analyze_python_smells', {
      projectPath: '/mock/project',
      summaryOnly: true,
    }));
    assert(summaryOnly.summary.total === 4, `expected summaryOnly total=4, got ${summaryOnly.summary.total}`);
    assert(!summaryOnly.smellGroups, 'expected summaryOnly response to omit smellGroups');
    assert(summaryOnly.response.summaryOnly === true, 'expected response.summaryOnly=true');
    assert(summaryOnly.response.returnedTotal === 0, 'expected summaryOnly returnedTotal=0');
    assert(summaryOnly.response.truncated === true, 'expected summaryOnly response truncated');

    const limited = unwrapToolResult(await client.callTool('analyze_python_smells', {
      projectPath: '/mock/project',
      only: 'long_method,data_clumps',
      limitPerGroup: 1,
    }));
    assert(limited.summary.total === 3, `expected limited summary total=3, got ${limited.summary.total}`);
    assert(limited.smellGroups.long_method.length === 1, 'expected limited long_method group length=1');
    assert(limited.smellGroups.data_clumps.length === 1, 'expected limited data_clumps group length=1');
    assert(limited.response.limitPerGroup === 1, 'expected response.limitPerGroup=1');
    assert(limited.response.returnedTotal === 2, `expected returnedTotal=2, got ${limited.response.returnedTotal}`);
    assert(limited.response.truncated === true, 'expected limited response truncated');

    // cli 모드 인자 주입 가드: '-'로 시작하는 projectPath는 실행 전에 거부돼야 한다
    const flagInjection = await client.callTool('analyze_python_smells', {
      projectPath: '--help',
    });
    const guardError = getToolErrorText(flagInjection);
    assert(guardError !== undefined, 'expected flag-like projectPath to be rejected');
    assert(guardError.includes('must not start with "-"'), `expected guard message, got "${guardError}"`);

    console.log('advanced_pyexamine smoke test success.');
  } finally {
    try { server.kill(); } catch { }
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
