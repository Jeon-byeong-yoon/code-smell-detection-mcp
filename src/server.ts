#!/usr/bin/env node
import dotenv from 'dotenv';
// stdout은 JSON-RPC 전용이므로 dotenv 로그를 억제한다 (quiet 미지원 버전은 무시)
dotenv.config({ quiet: true } as Record<string, unknown>);

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerAdvancedPyexamineTools } from './tools/advanced-pyexamine-tools';

async function main() {
  const server = new McpServer({ name: 'code-smell-detection-mcp', version: '0.3.0' });

  registerAdvancedPyexamineTools(server);

  await server.connect(new StdioServerTransport());
  console.error('code-smell-detection-mcp ready (stdio)');
}

main().catch((err) => {
  console.error('Fatal error starting server:', err);
  process.exit(1);
});
