import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { AdvancedPyexamineClient } from '../clients/advanced-pyexamine-client';
import { runTool } from './tool-result';

/**
 * advanced_pyexamine 직접 실행 tool 등록 (개발용).
 *
 * 환경 변수 (advanced-pyexamine-client.ts 참고):
 *   ADVANCED_PYEXAMINE_MODE (cli | http)
 *   ADVANCED_PYEXAMINE_BIN / ARGS / CWD (cli mode)
 *   ADVANCED_PYEXAMINE_SERVICE_URL (http mode)
 *   ADVANCED_PYEXAMINE_TOOL_ENABLED — 'false'면 이 도구를 노출하지 않음
 *     (IDE 등록 시 권장: 로컬 파일시스템을 읽는 개발용 도구 제외)
 */
export function registerAdvancedPyexamineTools(server: McpServer) {
  if ((process.env.ADVANCED_PYEXAMINE_TOOL_ENABLED ?? 'true').trim().toLowerCase() === 'false') {
    return;
  }

  let client: AdvancedPyexamineClient | undefined;

  const getClient = () => {
    client ??= new AdvancedPyexamineClient();
    return client;
  };

  server.registerTool(
    'analyze_python_smells',
    {
      description:
        'Python 프로젝트를 advanced_pyexamine으로 분석해 smell 결과를 JSON으로 반환한다. ' +
        'cli 모드는 로컬 python + advanced_pyexamine 설치가 필요한 개발용 도구다.',
      inputSchema: {
        projectPath: z.string().min(1).describe('분석 대상 Python project path'),
        only: z.string().optional().describe('comma-separated detector names (ex: "long_method,data_clumps")'),
        summaryOnly: z.boolean().optional().describe('true이면 smellGroups 생략, summary만 반환'),
        limitPerGroup: z.number().int().positive().optional().describe('group당 최대 반환 항목 수'),
      },
    },
    async (args) => runTool(() => getClient().analyzePythonSmells(args)),
  );
}
