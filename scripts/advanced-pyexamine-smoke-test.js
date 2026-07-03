const { spawn } = require('child_process');
const path = require('path');

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
  console.log('Starting advanced_pyexamine smoke test...');
  const server = startServer();
  const reader = createJsonLineReader(server);

  server.on('error', (error) => {
    reader.rejectAll(error);
  });

  try {
    await new Promise((resolve) => setTimeout(resolve, 500));

    const full = unwrapOk(await reader.request('full', 'analyze_python_smells', {
      projectPath: '/mock/project',
    }));
    assert(full.summary.total === 4, `expected full summary total=4, got ${full.summary.total}`);
    assert(full.summary.bySeverity.high === 2, 'expected high severity count=2');
    assert(full.summary.bySeverity.medium === 2, 'expected medium severity count=2');
    assert(full.smellGroups.long_method.length === 2, 'expected full long_method group length=2');
    assert(full.response.returnedTotal === 4, `expected returnedTotal=4, got ${full.response.returnedTotal}`);
    assert(full.response.truncated === false, 'expected full response not truncated');

    const summaryOnly = unwrapOk(await reader.request('summary-only', 'analyze_python_smells', {
      projectPath: '/mock/project',
      summaryOnly: true,
    }));
    assert(summaryOnly.summary.total === 4, `expected summaryOnly total=4, got ${summaryOnly.summary.total}`);
    assert(!summaryOnly.smellGroups, 'expected summaryOnly response to omit smellGroups');
    assert(summaryOnly.response.summaryOnly === true, 'expected response.summaryOnly=true');
    assert(summaryOnly.response.returnedTotal === 0, 'expected summaryOnly returnedTotal=0');
    assert(summaryOnly.response.truncated === true, 'expected summaryOnly response truncated');

    const limited = unwrapOk(await reader.request('limited', 'analyze_python_smells', {
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

    console.log('advanced_pyexamine smoke test success.');
  } finally {
    try { server.kill(); } catch { }
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
