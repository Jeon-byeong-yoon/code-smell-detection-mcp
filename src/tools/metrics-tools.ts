import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { MetricsApiClient } from '../clients/metrics-client';
import { runTool } from './tool-result';

/**
 * CodeVi metric-analysis tool 등록.
 *
 * 환경 변수 (metrics-client.ts 참고):
 *   METRICS_API_BASE_URL  — client가 /analyses 를 붙이므로 /api 포함해 지정
 *   METRICS_API_KEY
 *   METRICS_DEFAULT_TEAM_PROJECT_ID
 */
export function registerMetricsTools(server: McpServer) {
  let client: MetricsApiClient | undefined;

  const getClient = () => {
    client ??= new MetricsApiClient();
    return client;
  };

  server.registerTool(
    'run_metric_analysis',
    {
      description: 'CodeVi backend에 metric analysis 실행을 요청하고 결과를 저장한다.',
      inputSchema: {
        analysisType: z.enum(['full', 'classic', 'ck', 'oo', 'smells']).describe('실행할 분석 종류'),
        sourceType: z.enum(['ast_json', 'source_code']).describe('입력 소스 형태'),
        teamProjectId: z.number().int().positive().optional()
          .describe('CodeVi team project ID (생략 시 METRICS_DEFAULT_TEAM_PROJECT_ID 사용)'),
        filePath: z.string().optional().describe('분석 대상 파일 경로'),
        language: z.string().optional().describe('sourceType=source_code일 때 언어'),
        astData: z.record(z.unknown()).optional().describe('sourceType=ast_json일 때 AST JSON'),
        sourceCode: z.string().optional().describe('sourceType=source_code일 때 소스 코드'),
      },
    },
    async (args) => runTool(() => getClient().runMetricAnalysis(args)),
  );

  server.registerTool(
    'list_metric_analyses',
    {
      description: 'CodeVi backend에 저장된 metric analysis 이력 목록을 조회한다.',
      inputSchema: {
        teamProjectId: z.number().int().positive().optional().describe('CodeVi team project ID'),
        analysisType: z.string().optional().describe('"full" | "classic" | "ck" | "oo" | "smells"'),
        status: z.enum(['PENDING', 'SUCCESS', 'FAILED']).optional(),
      },
    },
    async (args) => runTool(() => getClient().listMetricAnalyses(args)),
  );

  server.registerTool(
    'get_metric_analysis',
    {
      description: '저장된 metric analysis 단건을 조회한다.',
      inputSchema: {
        jobId: z.number().int().positive().describe('조회할 metric analysis job ID'),
      },
    },
    async (args) => runTool(() => getClient().getMetricAnalysis(args)),
  );
}
