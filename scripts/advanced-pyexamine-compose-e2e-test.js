const { spawn } = require('child_process');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const composeFile = path.join(repoRoot, 'docker-compose.example.yml');
const fixtureSourceDir = path.join(repoRoot, 'test-fixtures', 'advanced-pyexamine-source');

const sourceDir = process.env.ADVANCED_PYEXAMINE_HOST_SOURCE_DIR || fixtureSourceDir;
const projectPath = process.env.ADVANCED_PYEXAMINE_COMPOSE_PROJECT_PATH || '/opt/advanced-pyexamine-source/sample-project';
const only = process.env.ADVANCED_PYEXAMINE_COMPOSE_ONLY || 'long_method,data_clumps';

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, {
      cwd: repoRoot,
      env: {
        ...process.env,
        ADVANCED_PYEXAMINE_HOST_SOURCE_DIR: sourceDir,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      ...options,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.setEncoding('utf8');
    proc.stderr.setEncoding('utf8');

    proc.stdout.on('data', (chunk) => {
      stdout += chunk;
      process.stdout.write(chunk);
    });

    proc.stderr.on('data', (chunk) => {
      stderr += chunk;
      process.stderr.write(chunk);
    });

    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });

    if (options.input) {
      proc.stdin.write(options.input);
    }
    proc.stdin.end();
  });
}

function parseMcpResponse(output) {
  const jsonLines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('{') && line.endsWith('}'));

  for (const line of jsonLines.reverse()) {
    try {
      const message = JSON.parse(line);
      if (message.id === 'compose-e2e') {
        return message;
      }
    } catch {
      // Ignore non-MCP JSON logs.
    }
  }

  throw new Error(`Could not find compose-e2e MCP response in output:\n${output}`);
}

function assertMcpResponse(message) {
  assert(!message.error, `expected no MCP error, got ${message.error}`);
  assert(message.result?.ok === true, 'expected result.ok=true');

  const result = message.result.result;
  assert(result.tool === 'advanced_pyexamine', 'expected tool=advanced_pyexamine');
  assert(result.language === 'python', 'expected language=python');
  assert(result.projectPath === projectPath, `expected projectPath=${projectPath}`);
  assert(result.only === only, `expected only=${only}`);
  assert(result.response?.summaryOnly === true, 'expected summaryOnly=true');
  assert(result.response?.returnedTotal === 0, 'expected returnedTotal=0');
  assert(result.response?.truncated === true, 'expected truncated=true');
  assert(result.summary?.total === 3, `expected summary.total=3, got ${result.summary?.total}`);
  assert(result.summary?.bySeverity?.high === 1, 'expected high severity count=1');
  assert(result.summary?.bySeverity?.medium === 2, 'expected medium severity count=2');
  assert(result.summary?.byName?.long_method === 2, 'expected long_method count=2');
  assert(result.summary?.byName?.data_clumps === 1, 'expected data_clumps count=1');
}

async function cleanup() {
  try {
    await runCommand('docker', ['compose', '-f', composeFile, 'down']);
  } catch (error) {
    console.error(`Cleanup failed: ${error.message}`);
  }
}

async function run() {
  console.log('Starting advanced_pyexamine Compose E2E test...');
  console.log(`ADVANCED_PYEXAMINE_HOST_SOURCE_DIR=${sourceDir}`);
  console.log(`ADVANCED_PYEXAMINE_COMPOSE_PROJECT_PATH=${projectPath}`);

  try {
    await runCommand('docker', ['compose', '-f', composeFile, 'build']);

    const request = {
      id: 'compose-e2e',
      tool: 'analyze_python_smells',
      params: {
        projectPath,
        only,
        summaryOnly: true,
      },
    };

    const { stdout } = await runCommand(
      'docker',
      ['compose', '-f', composeFile, 'run', '--rm', '-T', 'mcp-server'],
      { input: `${JSON.stringify(request)}\n` },
    );

    const message = parseMcpResponse(stdout);
    assertMcpResponse(message);

    console.log('advanced_pyexamine Compose E2E test success.');
    console.log(`summary=${JSON.stringify(message.result.result.summary)}`);
  } finally {
    await cleanup();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
