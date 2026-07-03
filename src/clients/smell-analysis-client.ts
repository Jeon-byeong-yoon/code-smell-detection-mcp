import axios, { AxiosInstance } from 'axios';
import type {
  CreateSmellAnalysisDto,
  CreateSmellAnalysisResponseDto,
  SmellAnalysisListResponseDto,
  SmellAnalysisDetailResponseDto,
  SmellAnalysisFindingsResponseDto,
  SmellAnalysisListItem,
  ListSmellAnalysisQuery,
  ListSmellAnalysisFindingQuery,
} from '../types/codevi-smell-analysis';

/**
 * CodeVi backend smell-analysis API 클라이언트.
 *
 * 환경 변수:
 *   SMELL_ANALYSIS_API_BASE_URL  - ex) http://localhost:13000/api
 *   SMELL_ANALYSIS_API_KEY       - JWT 또는 API key (Bearer)
 *   SMELL_ANALYSIS_REQUEST_TIMEOUT_MS - 기본값 15000ms
 *
 * 기존 MetricsApiClient와 동일한 패턴을 따른다.
 * (metrics-client.ts 참고)
 */
export class SmellAnalysisClient {
  private readonly client: AxiosInstance;

  constructor() {
    const baseURL = process.env.SMELL_ANALYSIS_API_BASE_URL?.trim();
    const apiKey = process.env.SMELL_ANALYSIS_API_KEY?.trim();
    const timeout = Number(process.env.SMELL_ANALYSIS_REQUEST_TIMEOUT_MS ?? '15000');

    if (!baseURL) throw new Error('SMELL_ANALYSIS_API_BASE_URL is required.');

    this.client = axios.create({
      baseURL,
      timeout: Number.isFinite(timeout) && timeout > 0 ? timeout : 15000,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      validateStatus: () => true,
    });
  }

  /**
   * POST /api/smell-analyses
   *
   * CodeVi backend에 smell analysis 실행을 요청하고 결과를 저장한다.
   * backend는 내부적으로 MCP analyze_python_smells 또는
   * advanced-pyexamine-service /analyze 를 호출한 뒤 저장한다.
   *
   * @param dto - 분석 요청 payload
   * @returns 저장된 job 기본 정보와 summary
   */
  async createSmellAnalysis(
    dto: CreateSmellAnalysisDto,
  ): Promise<CreateSmellAnalysisResponseDto['data']> {
    const response = await this.client.post('/smell-analyses', dto);
    return this.unwrapResponse<CreateSmellAnalysisResponseDto['data']>(response.data);
  }

  /**
   * GET /api/smell-analyses
   *
   * 저장된 smell analysis 목록을 조회한다.
   *
   * @param query - teamProjectId (필수), language, status, analyzer 등 필터
   * @returns items 배열과 total 수
   */
  async listSmellAnalyses(
    query: ListSmellAnalysisQuery,
  ): Promise<{ items: SmellAnalysisListItem[]; total: number }> {
    if (!query.teamProjectId || !Number.isInteger(query.teamProjectId) || query.teamProjectId <= 0) {
      throw new Error('teamProjectId must be a positive integer.');
    }

    const params: Record<string, unknown> = { teamProjectId: query.teamProjectId };
    if (query.language) params.language = query.language;
    if (query.status) params.status = query.status;
    if (query.analyzer) params.analyzer = query.analyzer;
    if (query.buildNumber) params.buildNumber = query.buildNumber;
    if (query.commitHash) params.commitHash = query.commitHash;
    if (query.limit) params.limit = query.limit;
    if (query.offset) params.offset = query.offset;

    const response = await this.client.get('/smell-analyses', { params });
    const data = this.unwrapResponse<SmellAnalysisListItem[]>(response.data);
    const total = Number(response.data?.meta?.total ?? data.length ?? 0);

    return { items: data, total };
  }

  /**
   * GET /api/smell-analyses/:jobId
   *
   * 단건 smell analysis 상세 정보를 조회한다. findings 배열 포함.
   *
   * @param jobId - 조회할 job ID
   * @returns job 상세 정보와 findings 목록
   */
  async getSmellAnalysis(
    jobId: number,
  ): Promise<SmellAnalysisDetailResponseDto['data']> {
    this.assertPositiveInteger(jobId, 'jobId');
    const response = await this.client.get(`/smell-analyses/${jobId}`);
    return this.unwrapResponse<SmellAnalysisDetailResponseDto['data']>(response.data);
  }

  /**
   * GET /api/smell-analyses/:jobId/findings
   *
   * finding 목록을 severity, name, filePath 등으로 필터링하여 조회한다.
   * dashboard 상세 테이블 전용.
   *
   * @param jobId - 조회 대상 job ID
   * @param query - severity, name, category, filePath, limit, offset 필터
   * @returns findings 배열과 페이지네이션 meta
   */
  async listSmellAnalysisFindings(
    jobId: number,
    query: ListSmellAnalysisFindingQuery = {},
  ): Promise<SmellAnalysisFindingsResponseDto['data']> {
    this.assertPositiveInteger(jobId, 'jobId');

    const params: Record<string, unknown> = {};
    if (query.severity) params.severity = query.severity;
    if (query.name) params.name = query.name;
    if (query.category) params.category = query.category;
    if (query.filePath) params.filePath = query.filePath;
    if (query.limit) params.limit = query.limit;
    if (query.offset) params.offset = query.offset;

    const response = await this.client.get(`/smell-analyses/${jobId}/findings`, { params });
    return this.unwrapResponse<SmellAnalysisFindingsResponseDto['data']>(response.data);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private unwrapResponse<T>(body: unknown): T {
    const res = body as { success?: boolean; data?: T; statusCode?: number; message?: string };
    if (res?.success === true) return res.data as T;
    throw this.toReadableError(body);
  }

  private toReadableError(body: unknown): Error {
    const res = body as { statusCode?: number; message?: string } | null;
    const statusCode = Number(res?.statusCode ?? 0);
    const message = String(res?.message ?? 'Unknown smell-analysis API error');

    if (statusCode === 401) return new Error('Invalid or expired API key.');
    if (statusCode === 403) return new Error('No access to the requested team project or smell analysis.');
    if (statusCode === 404) return new Error('Requested smell analysis was not found.');

    return new Error(message);
  }

  private assertPositiveInteger(value: number, fieldName: string): void {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${fieldName} must be a positive integer.`);
    }
  }
}
