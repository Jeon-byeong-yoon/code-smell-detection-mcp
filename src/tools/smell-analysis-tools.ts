import { Transport } from '../stdio/stdio-transport';
import { SmellAnalysisClient } from '../clients/smell-analysis-client';
import type {
  CreateSmellAnalysisDto,
  ListSmellAnalysisQuery,
  ListSmellAnalysisFindingQuery,
} from '../types/codevi-smell-analysis';

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
export function registerSmellAnalysisTools(transport: Transport) {
  let client: SmellAnalysisClient | undefined;

  const getClient = () => {
    client ??= new SmellAnalysisClient();
    return client;
  };

  /**
   * save_smell_analysis
   *
   * CodeVi backend에 smell analysis 실행 및 저장을 요청한다.
   * backend는 내부적으로 MCP analyze_python_smells 또는
   * advanced-pyexamine-service /analyze 를 호출한 뒤 저장한다.
   *
   * 필수 파라미터:
   *   teamProjectId  {number}  CodeVi team project ID
   *   language       {string}  분석 언어 ("python" 등)
   *   analyzer       {string}  분석 도구 ("advanced_pyexamine" 등)
   *
   * 선택 파라미터:
   *   projectPath      {string}  분석 대상 Python project path
   *   commitHash       {string}  분석 대상 commit hash
   *   sourceRef        {string}  branch, tag, PR ref 등
   *   buildNumber      {number}  Jenkins build number
   *   codeAnalysisId   {number}  CodeVi code analysis job ID (연결 시)
   *   metricAnalysisJobId {number}  metric-analysis job ID (연결 시)
   *   options.only            {string}   comma-separated detector names
   *   options.summaryOnly     {boolean}  true이면 smellGroups 생략
   *   options.limitPerGroup   {number}   group당 최대 반환 항목 수
   *
   * 예시:
   *   { "teamProjectId": 1, "language": "python", "analyzer": "advanced_pyexamine",
   *     "projectPath": "/opt/project", "options": { "only": "long_method,data_clumps" } }
   */
  transport.register('save_smell_analysis', async (params) => {
    const p = params as Record<string, unknown>;

    const dto: CreateSmellAnalysisDto = {
      teamProjectId: assertPositiveInteger(p.teamProjectId, 'teamProjectId'),
      language: assertNonEmptyString(p.language, 'language'),
      analyzer: assertNonEmptyString(p.analyzer, 'analyzer'),
      ...(p.projectPath !== undefined ? { projectPath: assertNonEmptyString(p.projectPath, 'projectPath') } : {}),
      ...(p.commitHash !== undefined ? { commitHash: assertNonEmptyString(p.commitHash, 'commitHash') } : {}),
      ...(p.sourceRef !== undefined ? { sourceRef: assertNonEmptyString(p.sourceRef, 'sourceRef') } : {}),
      ...(p.buildNumber !== undefined ? { buildNumber: assertPositiveInteger(p.buildNumber, 'buildNumber') } : {}),
      ...(p.codeAnalysisId !== undefined ? { codeAnalysisId: assertPositiveInteger(p.codeAnalysisId, 'codeAnalysisId') } : {}),
      ...(p.metricAnalysisJobId !== undefined ? { metricAnalysisJobId: assertPositiveInteger(p.metricAnalysisJobId, 'metricAnalysisJobId') } : {}),
      ...(p.options !== undefined ? { options: p.options as CreateSmellAnalysisDto['options'] } : {}),
    };

    const result = await getClient().createSmellAnalysis(dto);
    return { ok: true, result };
  });

  /**
   * list_smell_analyses
   *
   * CodeVi backend에 저장된 smell analysis 목록을 조회한다.
   *
   * 필수 파라미터:
   *   teamProjectId  {number}  CodeVi team project ID
   *
   * 선택 파라미터:
   *   language    {string}  "python" 등
   *   status      {string}  "PENDING" | "RUNNING" | "SUCCESS" | "FAILED"
   *   analyzer    {string}  "advanced_pyexamine" 등
   *   buildNumber {number}
   *   commitHash  {string}
   *   limit       {number}
   *   offset      {number}
   *
   * 예시:
   *   { "teamProjectId": 1, "status": "SUCCESS", "language": "python" }
   */
  transport.register('list_smell_analyses', async (params) => {
    const p = params as Record<string, unknown>;

    const query: ListSmellAnalysisQuery = {
      teamProjectId: assertPositiveInteger(p.teamProjectId, 'teamProjectId'),
      ...(p.language !== undefined ? { language: p.language as string } : {}),
      ...(p.status !== undefined ? { status: p.status as ListSmellAnalysisQuery['status'] } : {}),
      ...(p.analyzer !== undefined ? { analyzer: p.analyzer as string } : {}),
      ...(p.buildNumber !== undefined ? { buildNumber: assertPositiveInteger(p.buildNumber, 'buildNumber') } : {}),
      ...(p.commitHash !== undefined ? { commitHash: String(p.commitHash) } : {}),
      ...(p.limit !== undefined ? { limit: assertPositiveInteger(p.limit, 'limit') } : {}),
      ...(p.offset !== undefined ? { offset: assertNonNegativeInteger(p.offset, 'offset') } : {}),
    };

    const result = await getClient().listSmellAnalyses(query);
    return { ok: true, result };
  });

  /**
   * get_smell_analysis
   *
   * 저장된 smell analysis 단건 상세 정보를 조회한다. findings 배열 포함.
   *
   * 필수 파라미터:
   *   jobId  {number}  조회할 smell analysis job ID
   *
   * 예시:
   *   { "jobId": 10 }
   */
  transport.register('get_smell_analysis', async (params) => {
    const p = params as Record<string, unknown>;
    const jobId = assertPositiveInteger(p.jobId, 'jobId');
    const result = await getClient().getSmellAnalysis(jobId);
    return { ok: true, result };
  });

  /**
   * list_smell_findings
   *
   * 특정 job의 finding 목록을 severity, name, filePath 등으로 필터링하여 조회한다.
   * dashboard 상세 테이블 표시에 사용한다.
   *
   * 필수 파라미터:
   *   jobId  {number}  조회 대상 smell analysis job ID
   *
   * 선택 파라미터:
   *   severity  {string}  "high" | "medium" | "low" | "unknown"
   *   name      {string}  smell rule name (ex: "long_method")
   *   category  {string}  analyzer category (ex: "size_metric")
   *   filePath  {string}  source file path prefix (ex: "src/")
   *   limit     {number}
   *   offset    {number}
   *
   * 예시:
   *   { "jobId": 10, "severity": "high", "name": "long_method" }
   */
  transport.register('list_smell_findings', async (params) => {
    const p = params as Record<string, unknown>;
    const jobId = assertPositiveInteger(p.jobId, 'jobId');

    const query: ListSmellAnalysisFindingQuery = {
      ...(p.severity !== undefined ? { severity: p.severity as ListSmellAnalysisFindingQuery['severity'] } : {}),
      ...(p.name !== undefined ? { name: String(p.name) } : {}),
      ...(p.category !== undefined ? { category: String(p.category) } : {}),
      ...(p.filePath !== undefined ? { filePath: String(p.filePath) } : {}),
      ...(p.limit !== undefined ? { limit: assertPositiveInteger(p.limit, 'limit') } : {}),
      ...(p.offset !== undefined ? { offset: assertNonNegativeInteger(p.offset, 'offset') } : {}),
    };

    const result = await getClient().listSmellAnalysisFindings(jobId, query);
    return { ok: true, result };
  });
}

// ---------------------------------------------------------------------------
// Internal validators (파일 내부 전용)
// ---------------------------------------------------------------------------

function assertPositiveInteger(value: unknown, fieldName: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${fieldName} must be a positive integer.`);
  return n;
}

function assertNonNegativeInteger(value: unknown, fieldName: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${fieldName} must be a non-negative integer.`);
  return n;
}

function assertNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${fieldName} must be a non-empty string.`);
  return value.trim();
}
