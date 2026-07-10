import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * client 호출을 MCP CallToolResult로 감싼다.
 *
 * - 성공: JSON pretty-print text content (+ 객체 결과면 structuredContent 동봉)
 * - 실패: JSON-RPC 에러가 아닌 isError content로 반환해
 *   에이전트가 메시지를 읽고 재시도할 수 있게 한다.
 */
export async function runTool(fn: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    const data = await fn();
    const result: CallToolResult = {
      content: [{ type: 'text', text: JSON.stringify(data ?? null, null, 2) }],
    };
    // structuredContent는 object shape만 허용되므로 배열/null 결과는 text로만 반환
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      result.structuredContent = data as Record<string, unknown>;
    }
    return result;
  } catch (e) {
    return {
      content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }],
      isError: true,
    };
  }
}
