const { spawn } = require('child_process');

function writeLine(proc, obj) {
  proc.stdin.write(JSON.stringify(obj) + '\n');
}

async function run() {
  console.log('Starting stdio smoke test...');

  // Start the built server and explicitly pass current env (so ANALYSIS_API_BASE_URL etc. are forwarded)
  const server = spawn('node', ['dist/server.js'], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: { ...process.env },
  });

  server.stdout.setEncoding('utf8');

  let buffer = '';

  // Timeout handle so we can clear it on success/failure
  const timeoutMs = 10000;
  const timeoutHandle = setTimeout(() => {
    console.error('stdio test timed out waiting for response');
    try { server.kill(); } catch (e) { }
    process.exit(3);
  }, timeoutMs);

  function finish(code = 0) {
    clearTimeout(timeoutHandle);
    try { server.kill(); } catch (e) { }
    process.exit(code);
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
        // ignore non-json lines
        continue;
      }

      console.log('Received:', msg);

      // --- Robust success/error detection ---
      // Candidate result locations to handle multiple possible response shapes
      const candidateResults = [
        msg?.result,                 // { ok: true, result: { items: [] } } or similar
        msg?.result?.result,         // nested result
        msg?.result?.data,           // data field
        msg?.result?.items,          // direct items
        msg?.result?.tools,          // tools list
        msg?.data,                   // { success: true, data: ... }
        msg?.result?.result?.items,  // deeper nesting
      ];

      // Detect arrays or non-empty response shapes
      const hasItemsArray = candidateResults.some(r => Array.isArray(r?.items) || Array.isArray(r));
      const hasNonEmptyItems = candidateResults.some(r => Array.isArray(r?.items) && r.items.length > 0);
      const successFlag = Boolean(msg?.result?.ok) || Boolean(msg?.ok) || Boolean(msg?.success);

      // Remote error detection (various possible fields)
      const remoteError = msg?.error ?? msg?.result?.error ?? msg?.result?.message ?? msg?.message;
      if (remoteError) {
        console.error('stdio smoke test failed (remote error):', remoteError);
        finish(2);
        return;
      }

      // Consider success if any reasonable indicator is present
      if (hasItemsArray || hasNonEmptyItems || successFlag) {
        console.log('stdio smoke test success (detected valid response).');
        finish(0);
        return;
      }

      // If tool returned explicit 'unknown tool' or similar, surface it as failure
      if (msg?.error && typeof msg.error === 'string' && msg.error.toLowerCase().includes('unknown tool')) {
        console.error('stdio smoke test failed (unknown tool):', msg.error);
        finish(2);
        return;
      }

      // Otherwise: not a terminal message for test — keep waiting until timeout or terminal message arrives.
    }
  });

  server.on('error', (err) => {
    console.error('Failed to start server:', err);
    finish(1);
  });

  // Wait briefly for server to be ready
  await new Promise((r) => setTimeout(r, 700));

  // Request a real registered tool (list_metric_analyses)
  writeLine(server, { id: 'tools-list-test', tool: 'list_metric_analyses', params: {} });
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});