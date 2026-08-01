/**
 * 스모크/E2E 스크립트 공용 MCP stdio 테스트 클라이언트.
 *
 * JSON-RPC 2.0 개행 구분 메시지로 initialize 핸드셰이크와 tools/call을 수행한다.
 */

let nextId = 100;

function createMcpTestClient(proc, { timeoutMs = 10000 } = {}) {
  const pending = new Map();
  let buffer = '';

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

  function send(message) {
    proc.stdin.write(JSON.stringify(message) + '\n');
  }

  function request(method, params, requestTimeoutMs = timeoutMs) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Timed out waiting for MCP response id=${id} (${method})`));
      }, requestTimeoutMs);

      pending.set(id, {
        resolve: (message) => {
          clearTimeout(timeout);
          resolve(message);
        },
        reject,
      });

      send({ jsonrpc: '2.0', id, method, ...(params !== undefined ? { params } : {}) });
    });
  }

  return {
    async initialize() {
      const message = await request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'smoke-test', version: '1' },
      });
      if (message.error) {
        throw new Error(`initialize failed: ${JSON.stringify(message.error)}`);
      }
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      return message;
    },
    listTools() {
      return request('tools/list');
    },
    callTool(name, args = {}, requestTimeoutMs) {
      return request('tools/call', { name, arguments: args }, requestTimeoutMs);
    },
    rejectAll(error) {
      for (const [id, entry] of pending.entries()) {
        pending.delete(id);
        entry.reject?.(error);
      }
    },
  };
}

/**
 * tools/call 응답에서 에러 텍스트를 추출한다.
 * JSON-RPC 에러(스키마 검증 실패 등)와 isError content(도구 실행 실패) 모두 처리.
 * 에러가 없으면 undefined.
 */
function getToolErrorText(message) {
  if (message.error) {
    return typeof message.error === 'string'
      ? message.error
      : message.error.message ?? JSON.stringify(message.error);
  }
  if (message.result?.isError) {
    return (message.result.content ?? [])
      .map((item) => item.text ?? '')
      .join('\n');
  }
  return undefined;
}

/** tools/call 성공 응답에서 도구 결과 객체를 꺼낸다. 에러면 throw. */
function unwrapToolResult(message) {
  const errorText = getToolErrorText(message);
  if (errorText !== undefined) {
    throw new Error(`expected tool success, got error: ${errorText}`);
  }
  const result = message.result;
  if (result?.structuredContent) return result.structuredContent;
  const text = result?.content?.[0]?.text;
  if (typeof text !== 'string') {
    throw new Error(`tools/call response has no content: ${JSON.stringify(message)}`);
  }
  return JSON.parse(text);
}

module.exports = { createMcpTestClient, getToolErrorText, unwrapToolResult };
