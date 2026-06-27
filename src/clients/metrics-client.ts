import axios, { AxiosInstance } from 'axios';
import { AnalysisResult, Smell, CodeAnalysisResult } from '../types/code-analysis';

export class MetricsApiClient {
  private readonly client: AxiosInstance;
  private readonly defaultTeamProjectId?: number;

  constructor() {
    const baseURL = process.env.METRICS_API_BASE_URL?.trim();
    const apiKey = process.env.METRICS_API_KEY?.trim();
    const timeout = Number(process.env.METRICS_REQUEST_TIMEOUT_MS ?? '15000');
    const defaultTeamProjectId = process.env.METRICS_DEFAULT_TEAM_PROJECT_ID;

    if (!baseURL) throw new Error('METRICS_API_BASE_URL is required.');

    if (!apiKey) {
      // allow no-api-key mode for local/dev but warn
      // throw new Error('METRICS_API_KEY is required.');
    }

    this.client = axios.create({
      baseURL,
      timeout: Number.isFinite(timeout) ? timeout : 15000,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      validateStatus: () => true,
    });

    if (defaultTeamProjectId) {
      const parsed = Number(defaultTeamProjectId);
      if (Number.isInteger(parsed) && parsed > 0) {
        this.defaultTeamProjectId = parsed;
      }
    }
  }

  async runMetricAnalysis(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const requestBody = this.normalizeRunMetricAnalysisPayload(payload);
    const response = await this.client.post('/analyses', requestBody);
    return this.unwrapResponse<Record<string, unknown>>(response.data);
  }

  async listMetricAnalyses(payload: Record<string, unknown>): Promise<{ items: any[]; total: number }> {
    const queryParams: Record<string, unknown> = {};

    if (typeof payload.teamProjectId === 'number') queryParams.teamProjectId = payload.teamProjectId;
    if (typeof payload.analysisType === 'string') queryParams.analysisType = payload.analysisType;
    if (typeof payload.status === 'string') queryParams.status = payload.status;

    const response = await this.client.get('/analyses', { params: queryParams });
    const data = this.unwrapResponse<any[]>(response.data);
    const total = Number(response.data?.meta?.total ?? data.length ?? 0);

    return {
      items: data,
      total,
    };
  }

  async getMetricAnalysis(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
    const jobId = Number(payload.jobId);
    if (!Number.isInteger(jobId) || jobId <= 0) throw new Error('jobId must be a positive integer.');
    const response = await this.client.get(`/analyses/${jobId}`);
    return this.unwrapResponse<Record<string, unknown>>(response.data);
  }

  private normalizeRunMetricAnalysisPayload(payload: Record<string, unknown>): Record<string, unknown> {
    const teamProjectId = typeof payload.teamProjectId === 'number' ? payload.teamProjectId : this.defaultTeamProjectId;

    if (!teamProjectId) {
      throw new Error('teamProjectId is required unless METRICS_DEFAULT_TEAM_PROJECT_ID is configured.');
    }

    const analysisType = payload.analysisType;
    const sourceType = payload.sourceType;

    if (typeof analysisType !== 'string') throw new Error('analysisType is required.');
    if (typeof sourceType !== 'string') throw new Error('sourceType is required.');

    if (sourceType === 'ast_json' && !payload.astData) throw new Error('astData is required when sourceType is ast_json.');
    if (sourceType === 'source_code' && typeof payload.sourceCode !== 'string') throw new Error('sourceCode is required when sourceType is source_code.');
    if (sourceType === 'source_code' && typeof payload.language !== 'string' && typeof payload.filePath !== 'string') throw new Error('language or filePath is required when sourceType is source_code.');

    return {
      teamProjectId,
      analysisType,
      sourceType,
      filePath: payload.filePath,
      language: payload.language,
      astData: payload.astData,
      sourceCode: payload.sourceCode,
    };
  }

  private unwrapResponse<T>(body: any): T {
    if (body?.success === true) return body.data as T;
    throw this.toReadableError(body);
  }

  private toReadableError(body: any): Error {
    const statusCode = Number(body?.statusCode ?? 0);
    const message = String(body?.message ?? 'Unknown API error');

    if (statusCode === 401) return new Error('Invalid or expired API key.');
    if (statusCode === 403) return new Error('No access to the requested team project or analysis.');
    if (statusCode === 404) return new Error('Requested analysis was not found.');
    if (statusCode === 502) return new Error('Parser service is unavailable or misconfigured.');

    return new Error(message);
  }
}
