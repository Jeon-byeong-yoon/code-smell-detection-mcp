/**
 * http 모드 스모크 — MCP가 로컬 소스를 zip으로 묶어 analyzer service에 올리고,
 * service 응답(`{summary, results[]}`)을 MCP 형태로 정규화하는지 검증한다.
 *
 * 대상 계약은 codevi-pyexamine의 `POST /analyze` (multipart/form-data, file=zip)다.
 */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const zlib = require('zlib');
const { createMcpTestClient, unwrapToolResult } = require('./mcp-test-client');

const repoRoot = path.resolve(__dirname, '..');
const serverPath = path.join(repoRoot, 'dist', 'server.js');
const fixturePath = path.join(repoRoot, 'test-fixtures', 'advanced-pyexamine-source', 'sample-project');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const SHARED_SECRET = 'http-smoke-shared-secret';

/** 업로드된 zip에서 파일명 목록을 뽑는다 (local file header만 훑는다). */
function listZipEntries(buffer) {
  const names = [];
  let offset = 0;

  while (offset + 30 <= buffer.length) {
    if (buffer.readUInt32LE(offset) !== 0x04034b50) break;

    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);

    const name = buffer.slice(offset + 30, offset + 30 + nameLength).toString('utf8');
    const dataStart = offset + 30 + nameLength + extraLength;
    const data = buffer.slice(dataStart, dataStart + compressedSize);

    // zip이 실제로 풀리는지까지 확인한다 — 헤더만 맞고 본문이 깨지면 service에서 터진다
    const content = method === 8 ? zlib.inflateRawSync(data) : data;
    names.push({ name, content: content.toString('utf8') });

    offset = dataStart + compressedSize;
  }

  return names;
}

/** multipart 본문에서 파일 파트의 바이트를 꺼낸다. */
function extractZipFromMultipart(buffer, contentType) {
  const match = /boundary=(.+)$/.exec(contentType || '');
  assert(match, 'expected multipart boundary in Content-Type');
  const boundary = Buffer.from(`--${match[1]}`, 'utf8');

  const start = buffer.indexOf(boundary);
  assert(start !== -1, 'expected opening multipart boundary');

  const headerEnd = buffer.indexOf('\r\n\r\n', start);
  assert(headerEnd !== -1, 'expected multipart header terminator');

  const end = buffer.indexOf(boundary, headerEnd);
  assert(end !== -1, 'expected closing multipart boundary');

  // 본문과 종료 경계 사이의 CRLF를 제외한다
  return buffer.slice(headerEnd + 4, end - 2);
}

function startMockAnalyzerService() {
  let lastUpload = null;
  let lastHeaders = null;

  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/analyze') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ detail: 'Not found' }));
      return;
    }

    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      lastHeaders = req.headers;
      const zip = extractZipFromMultipart(Buffer.concat(chunks), req.headers['content-type']);
      lastUpload = listZipEntries(zip);

      // codevi-pyexamine의 실제 응답 형태
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        summary: { total: 3, by_category: { size_metric: 2, abstraction_misuse_metric: 1 }, classCount: 1 },
        results: [
          {
            type: 'size_metric',
            name: 'long_method',
            description: 'lines=45, threshold=30',
            file: 'sample.py',
            'Module/Class': 'UserService.get_user',
            lineNumber: 1,
            severity: 'high',
          },
          {
            type: 'size_metric',
            name: 'long_method',
            description: 'lines=33, threshold=30',
            file: 'sample.py',
            'Module/Class': 'OrderService.create_order',
            lineNumber: 10,
            severity: 'medium',
          },
          {
            type: 'abstraction_misuse_metric',
            name: 'data_clumps',
            description: 'name, email, phone',
            file: 'sample.py',
            'Module/Class': 'User',
            lineNumber: 20,
            severity: 'medium',
          },
        ],
      }));
    });
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      resolve({
        baseUrl: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done) => server.close(done)),
        getLastUpload: () => lastUpload,
        getLastHeaders: () => lastHeaders,
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
  const mockService = await startMockAnalyzerService();
  const server = startServer(mockService.baseUrl);
  const client = createMcpTestClient(server);

  server.on('error', (error) => client.rejectAll(error));

  try {
    await client.initialize();

    const result = unwrapToolResult(await client.callTool('analyze_python_smells', {
      projectPath: fixturePath,
      summaryOnly: false,
      limitPerGroup: 1,
    }));

    // ── 업로드 검증
    const headers = mockService.getLastHeaders();
    assert(headers['x-internal-token'] === SHARED_SECRET, 'expected X-Internal-Token header to be forwarded');
    assert(
      (headers['content-type'] || '').startsWith('multipart/form-data'),
      `expected multipart upload, got ${headers['content-type']}`,
    );

    const uploaded = mockService.getLastUpload();
    assert(Array.isArray(uploaded) && uploaded.length > 0, 'expected uploaded zip to contain files');
    assert(uploaded.every((f) => f.name.endsWith('.py')), `expected only .py files, got ${uploaded.map((f) => f.name)}`);
    assert(uploaded.some((f) => f.name === 'sample.py'), `expected sample.py in upload, got ${uploaded.map((f) => f.name)}`);
    assert(uploaded[0].content.length > 0, 'expected uploaded file content to survive the zip round-trip');

    // ── 응답 정규화 검증
    assert(result.tool === 'advanced_pyexamine', 'expected advanced_pyexamine tool');
    assert(result.projectPath === fixturePath, 'expected caller projectPath to be preserved');
    assert(result.summary.total === 3, `expected summary total=3, got ${result.summary.total}`);
    assert(result.summary.byName.long_method === 2, 'expected byName to be derived from results');
    assert(result.summary.bySeverity.high === 1, 'expected bySeverity to be derived from results');
    assert(result.smellGroups.long_method.length === 1, 'expected limitPerGroup to cap the group');
    assert(result.smellGroups.long_method[0].location.file === 'sample.py', 'expected file to be mapped into location');
    assert(result.smellGroups.long_method[0].location.line_start === 1, 'expected lineNumber to be mapped');
    assert(result.response.truncated === true, 'expected truncated response');

    // ── only 필터는 service가 지원하지 않으므로 client가 적용해야 한다
    const filtered = unwrapToolResult(await client.callTool('analyze_python_smells', {
      projectPath: fixturePath,
      only: 'data_clumps',
    }));
    assert(filtered.summary.total === 1, `expected only-filter to keep 1 finding, got ${filtered.summary.total}`);
    assert(!filtered.smellGroups.long_method, 'expected long_method to be filtered out');

    console.log('advanced_pyexamine HTTP mode smoke test success.');
  } finally {
    try { server.kill(); } catch { /* ignore */ }
    await mockService.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
