const { spawn } = require('child_process');

function writeLine(proc, obj) {
  proc.stdin.write(JSON.stringify(obj) + '\n');
}

async function run() {
  console.log('Starting stdio smoke test...');

  // Start the built server
  const server = spawn('node', ['dist/server.js'], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });

  server.stdout.setEncoding('utf8');

  let buffer = '';

  server.stdout.on('data', (chunk) => {
    buffer += chunk;
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        console.log('Received:', msg);
        if (msg.id === 'tools-list-test' && msg.result && Array.isArray(msg.result.tools)) {
          console.log('tools/list returned', msg.result.tools.length, 'tools');
          server.kill();
          process.exit(0);
        }
      } catch (e) {
        // ignore non-json
      }
    }
  });

  server.on('error', (err) => {
    console.error('Failed to start server:', err);
    process.exit(2);
  });

  // Wait briefly for server to be ready
  await new Promise((r) => setTimeout(r, 700));

  // Request tools list using our simple newline JSON protocol
  writeLine(server, { id: 'tools-list-test', tool: 'tools/list', params: {} });

  // Timeout
  setTimeout(() => {
    console.error('stdio test timed out waiting for response');
    server.kill();
    process.exit(3);
  }, 10000);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
