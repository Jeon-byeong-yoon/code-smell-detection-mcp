import dotenv from 'dotenv';
dotenv.config();

import { registerPyexamineTools } from './tools/pyexamine-tools';
import { registerMetricsTools } from './tools/metrics-tools';
import { registerAdvancedPyexamineTools } from './tools/advanced-pyexamine-tools';
import { createStdIoTransport } from './stdio/stdio-transport';

const LOG = console;

async function main() {
  LOG.info('Starting code-smell-detection-mcp server...');
  // stdio transport starts and manages MCP messages
  const transport = createStdIoTransport();

  // Register tool handlers (transport에 이벤트 핸들러 등록)
  registerPyexamineTools(transport);
  registerMetricsTools(transport);
  registerAdvancedPyexamineTools(transport);

  // Keep process alive while transport works
  transport.start();
}

main().catch(err => {
  console.error('Fatal error starting server:', err);
  process.exit(1);
});
