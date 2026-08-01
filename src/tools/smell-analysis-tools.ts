import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { SmellAnalysisClient } from '../clients/smell-analysis-client';
import type {
  CreateSmellAnalysisDto,
  ListSmellAnalysisQuery,
  ListSmellAnalysisFindingQuery,
} from '../types/codevi-smell-analysis';
import { runTool } from './tool-result';

/**
 * CodeVi backend smell-analysis 관련 MCP tool 등록.
 *
 * 제공 tool:
 *   - save_smell_analysis     : 분석 실행 후 CodeVi backend에 결과 저장
 *   - list_smell_analyses     : 저장된 smell analysis 목록 조회
 *   - get_smell_analysis      : 단건 상세 조회 (findings 포함)
 *   - list_smell_findings     : finding 필터 조회 (severity, name, filePath 등)
 *
 * 환경 변수 (smell-analysis-client.ts 참고):
 *   SMELL_ANALYSIS_API_BASE_URL
 *   SMELL_ANALYSIS_API_KEY
 *   SMELL_ANALYSIS_REQUEST_TIMEOUT_MS
 */
export function registerSmellAnalysisTools(server: McpServer) {
  let client: SmellAnalysisClient | undefined;

  const getClient = () => {
    client ??= new SmellAnalysisClient();
    return client;
  };

  server.registerTool(
    'save_smell_analysis',
    {
      description:
        'CodeVi backend에 smell analysis 실행을 요청하고 결과를 저장한다. ' +
        'backend가 advanced-pyexamine-service /analyze 를 호출해 findings 를 저장한다. ' +
        'projectPath는 서버측 analyzer 컨테이너 내부 경로여야 한다.',
      inputSchema: {
        teamProjectId: z.number().int().positive().describe('CodeVi team project ID'),
        language: z.string().min(1).describe('분석 언어 (ex: "python")'),
        analyzer: z.string().min(1).describe('분석 도구 (ex: "advanced_pyexamine")'),
        projectPath: z.string().min(1).optional()
          .describe('분석 대상 project path (analyzer 컨테이너 내부 경로, ex: /opt/advanced-pyexamine-source/...)'),
        commitHash: z.string().optional().describe('분석 대상 commit hash'),
        sourceRef: z.string().optional().describe('branch, tag, PR ref 등'),
        buildNumber: z.number().int().positive().optional().describe('Jenkins build number'),
        codeAnalysisId: z.number().int().positive().optional().describe('연결할 CodeVi code analysis job ID'),
        metricAnalysisJobId: z.number().int().positive().optional().describe('연결할 metric-analysis job ID'),
        options: z
          .object({
            only: z.string().optional().describe('comma-separated detector names (ex: "long_method,data_clumps")'),
            summaryOnly: z.boolean().optional().describe('true이면 smellGroups 생략'),
            limitPerGroup: z.number().int().positive().optional().describe('group당 최대 반환 항목 수'),
          })
          .optional(),
      },
    },
    async (args) => runTool(() => getClient().createSmellAnalysis(args as CreateSmellAnalysisDto)),
  );

  server.registerTool(
    'list_smell_analyses',
    {
      description: 'CodeVi backend에 저장된 smell analysis 목록을 조회한다.',
      inputSchema: {
        teamProjectId: z.number().int().positive().describe('CodeVi team project ID'),
        language: z.string().optional().describe('"python" 등'),
        status: z.enum(['PENDING', 'RUNNING', 'SUCCESS', 'FAILED']).optional(),
        analyzer: z.string().optional().describe('"advanced_pyexamine" 등'),
        buildNumber: z.number().int().positive().optional(),
        commitHash: z.string().optional(),
        limit: z.number().int().positive().optional(),
        offset: z.number().int().nonnegative().optional(),
      },
    },
    async (args) => runTool(() => getClient().listSmellAnalyses(args as ListSmellAnalysisQuery)),
  );

  server.registerTool(
    'get_smell_analysis',
    {
      description: '저장된 smell analysis 단건 상세 정보를 조회한다. findings 배열 포함.',
      inputSchema: {
        jobId: z.number().int().positive().describe('조회할 smell analysis job ID'),
      },
    },
    async ({ jobId }) => runTool(() => getClient().getSmellAnalysis(jobId)),
  );

  server.registerTool(
    'list_smell_findings',
    {
      description:
        '특정 job의 finding 목록을 severity, name, filePath 등으로 필터링하여 조회한다. ' +
        'dashboard 상세 테이블 표시에 사용한다.',
      inputSchema: {
        jobId: z.number().int().positive().describe('조회 대상 smell analysis job ID'),
        severity: z.enum(['high', 'medium', 'low', 'unknown']).optional(),
        name: z.string().optional().describe('smell rule name (ex: "long_method")'),
        category: z.string().optional().describe('analyzer category (ex: "size_metric")'),
        filePath: z.string().optional().describe('source file path prefix (ex: "src/")'),
        limit: z.number().int().positive().optional(),
        offset: z.number().int().nonnegative().optional(),
      },
    },
    async ({ jobId, ...query }) =>
      runTool(() => getClient().listSmellAnalysisFindings(jobId, query as ListSmellAnalysisFindingQuery)),
  );
}
