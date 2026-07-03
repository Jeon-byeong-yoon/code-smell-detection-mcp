import axios, { AxiosInstance } from 'axios';
import {
  CodeAnalysisResult,
  PyExamineResultItem,
} from '../types/code-analysis';

export class CodeAnalysisApiClient {
  private readonly client: AxiosInstance;

  constructor() {
    const baseURL = process.env.ANALYSIS_API_BASE_URL?.trim() ?? process.env.METRICS_API_BASE_URL?.trim();
    const apiKey = process.env.ANALYSIS_API_KEY?.trim();
    const timeout = Number(process.env.ANALYSIS_REQUEST_TIMEOUT_MS ?? process.env.METRICS_REQUEST_TIMEOUT_MS ?? '15000');
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };

    if (!baseURL) throw new Error('ANALYSIS_API_BASE_URL is required for code-analysis tools.');
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

    this.client = axios.create({
      baseURL,
      timeout: Number.isFinite(timeout) ? timeout : 15000,
      headers,
      validateStatus: () => true,
    });
  }

  async listCodeAnalyses(payload: Record<string, unknown>): Promise<{ items: CodeAnalysisResult[]; total: number }> {
    const response = await this.client.get('/api/code-analysis');
    const items = this.sortByRecent(this.applyCodeAnalysisFilters(this.unwrapListResponse(response.data), payload));
    const limit = this.parseOptionalPositiveInteger(payload.limit, 'limit');
    const limitedItems = typeof limit === 'number' ? items.slice(0, limit) : items;

    return { items: limitedItems, total: items.length };
  }

  async getLatestPyExamineResult(payload: Record<string, unknown>): Promise<CodeAnalysisResult | null> {
    const items = this.sortByRecent(this.applyCodeAnalysisFilters(await this.fetchCodeAnalyses(), payload).filter((item) => this.hasPyExamineResult(item)));
    return items[0] ?? null;
  }

  async getPyExamineResultByCommit(payload: Record<string, unknown>): Promise<CodeAnalysisResult> {
    const commitHash = this.getRequiredString(payload.commitHash, 'commitHash');
    const items = this.applyCodeAnalysisFilters(await this.fetchCodeAnalyses(), { commitHash });
    const match = items.find((item) => item.commitHash === commitHash);
    if (!match) throw new Error(`No code-analysis result found for commitHash: ${commitHash}`);
    return match;
  }

  async getHighSeveritySmells(payload: Record<string, unknown>): Promise<{ source: any; total: number; smells: PyExamineResultItem[] }> {
    const source = await this.getAnalysisSource(payload);
    const limit = this.parseOptionalPositiveInteger(payload.limit, 'limit');
    const smells = (source.pyExamineResult ?? []).filter((item) => String(item.severity ?? '').toLowerCase() === 'high');
    return { source: this.summarizeCodeAnalysis(source), total: smells.length, smells: typeof limit === 'number' ? smells.slice(0, limit) : smells };
  }

  async getSmellsByFile(payload: Record<string, unknown>): Promise<{ source: any; file: string; total: number; smells: PyExamineResultItem[] }> {
    const file = this.getRequiredString(payload.file, 'file');
    const source = await this.getAnalysisSource(payload);
    const limit = this.parseOptionalPositiveInteger(payload.limit, 'limit');
    const smells = (source.pyExamineResult ?? []).filter((item) => String(item.file ?? '').includes(file));
    return { source: this.summarizeCodeAnalysis(source), file, total: smells.length, smells: typeof limit === 'number' ? smells.slice(0, limit) : smells };
  }

  private async getAnalysisSource(payload: Record<string, unknown>): Promise<CodeAnalysisResult> {
    if (typeof payload.commitHash === 'string' && payload.commitHash.trim()) return this.getPyExamineResultByCommit(payload);
    const latest = await this.getLatestPyExamineResult(payload);
    if (!latest) throw new Error('No code-analysis result with pyExamineResult was found.');
    return latest;
  }

  private async fetchCodeAnalyses(): Promise<CodeAnalysisResult[]> {
    const response = await this.client.get('/api/code-analysis');
    return this.unwrapListResponse(response.data);
  }

  private unwrapListResponse(body: any): CodeAnalysisResult[] {
    if (Array.isArray(body)) return body as CodeAnalysisResult[];
    if (Array.isArray(body?.data)) return body.data as CodeAnalysisResult[];
    throw this.toReadableError(body);
  }

  private applyCodeAnalysisFilters(items: CodeAnalysisResult[], payload: Record<string, unknown>): CodeAnalysisResult[] {
    const teamProjectId = this.parseOptionalPositiveInteger(payload.teamProjectId, 'teamProjectId');
    const commitHash = typeof payload.commitHash === 'string' ? payload.commitHash.trim() : undefined;
    const jobName = typeof payload.jobName === 'string' ? payload.jobName.trim() : undefined;

    return items.filter((item) => {
      if (typeof teamProjectId === 'number' && item.teamProjectId !== teamProjectId) return false;
      if (commitHash && item.commitHash !== commitHash) return false;
      if (jobName && item.jobName !== jobName) return false;
      return true;
    });
  }

  private sortByRecent(items: CodeAnalysisResult[]): CodeAnalysisResult[] {
    return [...items].sort((left, right) => {
      const leftTime = Date.parse(left.createdAt ?? '');
      const rightTime = Date.parse(right.createdAt ?? '');
      if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return rightTime - leftTime;
      return Number(right.id ?? right.buildNumber ?? 0) - Number(left.id ?? left.buildNumber ?? 0);
    });
  }

  private hasPyExamineResult(item: CodeAnalysisResult): boolean {
    return Array.isArray(item.pyExamineResult) && item.pyExamineResult.length > 0;
  }

  private summarizeCodeAnalysis(item: CodeAnalysisResult) {
    return {
      id: item.id,
      jobName: item.jobName,
      buildNumber: item.buildNumber,
      status: item.status,
      buildUrl: item.buildUrl,
      commitHash: item.commitHash,
      teamProjectId: item.teamProjectId,
      createdAt: item.createdAt,
      pyExamineResultCount: item.pyExamineResult?.length ?? 0,
    };
  }

  private parseOptionalPositiveInteger(value: unknown, fieldName: string): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const parsedValue = Number(value);
    if (!Number.isInteger(parsedValue) || parsedValue <= 0) throw new Error(`${fieldName} must be a positive integer.`);
    return parsedValue;
  }

  private getRequiredString(value: unknown, fieldName: string): string {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${fieldName} is required.`);
    return value.trim();
  }

  private toReadableError(body: any): Error {
    const statusCode = Number(body?.statusCode ?? 0);
    const message = String(body?.message ?? 'Unknown Code Analysis API error');
    if (statusCode === 401) return new Error('Invalid or expired CodeVi API key.');
    if (statusCode === 403) return new Error('No access to the requested code-analysis result.');
    if (statusCode === 404) return new Error('Code-analysis endpoint or result was not found.');
    return new Error(message);
  }
}
