import readline from 'readline';

export type ToolHandler = (params: any) => Promise<any>;

export type Transport = {
  start: () => void;
  register: (name: string, handler: ToolHandler) => void;
  sendResponse: (id: string, result: any) => void;
};

export function createStdIoTransport(): Transport {
  const handlers: Record<string, ToolHandler> = {};

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  rl.on('line', async (line) => {
    let id: string | undefined;

    try {
      const msg = JSON.parse(line);
      // expected shape { id, tool, params }
      const { tool, params } = msg;
      id = msg.id;
      const h = handlers[tool];
      if (!h) {
        const resp = { id, error: `unknown tool ${tool}` };
        process.stdout.write(JSON.stringify(resp) + '\n');
        return;
      }
      const result = await h(params);
      const resp = { id, result };
      process.stdout.write(JSON.stringify(resp) + '\n');
    } catch (e) {
      console.error('stdin parse error', e);
      const message = e instanceof Error ? e.message : String(e);
      if (id) {
        process.stdout.write(JSON.stringify({ id, error: message }) + '\n');
      }
    }
  });

  return {
    start: () => {
      // nothing else required for stdio
    },
    register: (name: string, handler: ToolHandler) => {
      handlers[name] = handler;
    },
    sendResponse: (id: string, result: any) => {
      process.stdout.write(JSON.stringify({ id, result }) + '\n');
    }
  };
}
