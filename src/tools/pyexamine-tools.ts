import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CodeAnalysisApiClient } from '../clients/code-analysis-client';
import { runTool } from './tool-result';

/**
 * CodeVi code-analysis(PyExamine) 조회 tool 등록.
 *
 * 환경 변수 (code-analysis-client.ts 참고):
 *   ANALYSIS_API_BASE_URL  — client가 /api/code-analysis 를 붙이므로 /api 없이 지정
 *   ANALYSIS_API_KEY
 */
export function registerPyexamineTools(server: McpServer) {
  let client: CodeAnalysisApiClient | undefined;

  const getClient = () => {
    client ??= new CodeAnalysisApiClient();
    return client;
  };

  const commonFilters = {
    teamProjectId: z.number().int().positive().optional().describe('CodeVi team project ID 필터'),
    commitHash: z.string().optional().describe('commit hash 필터'),
    jobName: z.string().optional().describe('Jenkins job name 필터'),
  };

  server.registerTool(
    'get_code_analysis_results',
    {
      description: 'CodeVi backend에 저장된 code-analysis 결과 목록을 최신순으로 조회한다.',
      inputSchema: {
        ...commonFilters,
        limit: z.number().int().positive().optional().describe('최대 반환 건수'),
      },
    },
    async (args) => runTool(() => getClient().listCodeAnalyses(args)),
  );

  server.registerTool(
    'get_latest_pyexamine_result',
    {
      description: 'pyExamineResult가 있는 가장 최근 code-analysis 결과를 조회한다.',
      inputSchema: { ...commonFilters },
    },
    async (args) => runTool(() => getClient().getLatestPyExamineResult(args)),
  );

  server.registerTool(
    'get_pyexamine_result_by_commit',
    {
      description: 'commit hash 기준으로 code-analysis(PyExamine) 결과를 조회한다.',
      inputSchema: {
        commitHash: z.string().min(1).describe('조회할 commit hash'),
        teamProjectId: z.number().int().positive().optional().describe('CodeVi team project ID'),
      },
    },
    async (args) => runTool(() => getClient().getPyExamineResultByCommit(args)),
  );

  server.registerTool(
    'get_high_severity_smells',
    {
      description:
        'high severity smell 목록을 조회한다. commitHash가 없으면 최신 결과를 사용한다.',
      inputSchema: {
        ...commonFilters,
        limit: z.number().int().positive().optional().describe('최대 반환 건수'),
      },
    },
    async (args) => runTool(() => getClient().getHighSeveritySmells(args)),
  );

  server.registerTool(
    'get_smells_by_file',
    {
      description:
        '파일 경로 기준으로 smell 목록을 조회한다. commitHash가 없으면 최신 결과를 사용한다.',
      inputSchema: {
        filePath: z.string().min(1).describe('source file path (부분 일치)'),
        ...commonFilters,
        limit: z.number().int().positive().optional().describe('최대 반환 건수'),
      },
    },
    // client는 file 키를 읽으므로 filePath를 매핑해 전달한다
    async ({ filePath, ...rest }) => runTool(() => getClient().getSmellsByFile({ ...rest, file: filePath })),
  );
}
