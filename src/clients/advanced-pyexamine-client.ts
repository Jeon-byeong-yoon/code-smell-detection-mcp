import { spawn } from 'child_process';
import axios, { AxiosInstance } from 'axios';
import fs from 'fs/promises';
import path from 'path';
import { createMultipartBody, createZip, ZipEntry } from '../zip';

export type AdvancedPyexamineSummary = {
  total: number;
  bySeverity: Record<string, number>;
  byName: Record<string, number>;
};

export type AdvancedPyexamineResult = {
  tool: 'advanced_pyexamine';
  language: 'python';
  projectPath: string;
  only?: string;
  smellGroups?: Record<string, unknown[]>;
  summary: AdvancedPyexamineSummary;
  response: {
    summaryOnly: boolean;
    limitPerGroup?: number;
    returnedTotal: number;
    truncated: boolean;
  };
};

type SpawnResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
};

type AdvancedPyexamineMode = 'cli' | 'http';


// 소스 수집에서 제외할 디렉토리 — 분석 가치가 없고 업로드 용량만 키운다
const SKIPPED_DIRECTORIES = new Set([
  '.git', '.hg', '.svn', '.tox', '.nox', '.mypy_cache', '.pytest_cache', '.ruff_cache',
  '__pycache__', 'node_modules', 'venv', '.venv', 'env', '.env', 'site-packages',
  'dist', 'build', '.eggs', '.idea', '.vscode',
]);

const DEFAULT_MAX_UPLOAD_FILES = 2000;
const DEFAULT_MAX_UPLOAD_BYTES = 20_000_000;

export class AdvancedPyexamineClient {
  private readonly mode: AdvancedPyexamineMode;
  private readonly bin: string;
  private readonly baseArgs: string[];
  private readonly cwd?: string;
  private readonly timeoutMs: number;
  private readonly serviceClient?: AxiosInstance;

  constructor() {
    this.mode = this.parseMode(process.env.ADVANCED_PYEXAMINE_MODE);
    this.bin = process.env.ADVANCED_PYEXAMINE_BIN?.trim() || 'python';
    this.baseArgs = this.parseArgs(process.env.ADVANCED_PYEXAMINE_ARGS ?? '-m,advanced_pyexamine');
    this.cwd = this.normalizeOptionalPath(process.env.ADVANCED_PYEXAMINE_CWD);

    const timeout = Number(process.env.ADVANCED_PYEXAMINE_TIMEOUT_MS ?? '30000');
    this.timeoutMs = Number.isFinite(timeout) && timeout > 0 ? timeout : 30000;

    if (this.mode === 'http') {
      const serviceUrl = process.env.ADVANCED_PYEXAMINE_SERVICE_URL?.trim();
      if (!serviceUrl) throw new Error('ADVANCED_PYEXAMINE_SERVICE_URL is required when ADVANCED_PYEXAMINE_MODE=http.');

      const sharedSecret = process.env.ADVANCED_PYEXAMINE_SHARED_SECRET?.trim();
      const serviceTimeout = Number(process.env.ADVANCED_PYEXAMINE_SERVICE_TIMEOUT_MS ?? this.timeoutMs);
      this.serviceClient = axios.create({
        baseURL: serviceUrl,
        timeout: Number.isFinite(serviceTimeout) && serviceTimeout > 0 ? serviceTimeout : this.timeoutMs,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(sharedSecret ? { 'X-Internal-Token': sharedSecret } : {}),
        },
        validateStatus: () => true,
      });

    }
  }



  async analyzePythonSmells(payload: Record<string, unknown>): Promise<AdvancedPyexamineResult> {
    const projectPath = this.getRequiredString(payload.projectPath, 'projectPath');
    const only = this.getOptionalString(payload.only, 'only');
    const summaryOnly = this.getOptionalBoolean(payload.summaryOnly, 'summaryOnly') ?? false;
    const limitPerGroup = this.parseOptionalPositiveInteger(payload.limitPerGroup, 'limitPerGroup');

    if (this.mode === 'http') {
      return this.analyzeViaService(projectPath, {
        ...(only ? { only } : {}),
        summaryOnly,
        ...(limitPerGroup ? { limitPerGroup } : {}),
      });
    }

    // '-'로 시작하는 값이 CLI 플래그로 해석되는 인자 주입을 차단 (shell:false라 셸 주입은 원천 불가)
    if (projectPath.startsWith('-')) {
      throw new Error('projectPath must not start with "-". Pass an absolute or relative directory path.');
    }

    const args = [
      ...this.baseArgs,
      projectPath,
      '--json',
    ];

    if (only) {
      args.push('--only', only);
    }

    const result = await this.run(args);
    const smellGroups = this.parseJsonOutput(result.stdout);
    const summary = this.summarize(smellGroups);
    const returnedGroups = summaryOnly ? undefined : this.limitGroups(smellGroups, limitPerGroup);
    const returnedTotal = returnedGroups ? this.countSmells(returnedGroups) : 0;

    return {
      tool: 'advanced_pyexamine',
      language: 'python',
      projectPath,
      ...(only ? { only } : {}),
      ...(returnedGroups ? { smellGroups: returnedGroups } : {}),
      summary,
      response: {
        summaryOnly,
        ...(limitPerGroup ? { limitPerGroup } : {}),
        returnedTotal,
        truncated: returnedTotal < summary.total,
      },
    };
  }


  /** 수집한 소스를 zip 엔트리로 변환한다. */
  private async collectPythonSourceEntries(projectPath: string): Promise<ZipEntry[]> {
    const files = await this.collectPythonSources(projectPath);
    return Object.entries(files).map(([relativePath, content]) => ({
      path: relativePath,
      content: Buffer.from(content, 'utf8'),
    }));
  }

  /**
   * projectPath 아래의 .py 소스를 모아 `상대경로 -> 내용` 맵으로 만든다.
   *
   * 업로드 용량이 곧 지연·비용이므로 가상환경·캐시·VCS 디렉토리는 건너뛴다.
   * 상한을 넘으면 잘라내지 않고 실패시킨다 — 조용히 일부만 분석하면
   * 사용자는 "스멜이 없다"로 오해한다.
   */
  private async collectPythonSources(projectPath: string): Promise<Record<string, string>> {
    const root = path.resolve(projectPath);

    let stats;
    try {
      stats = await fs.stat(root);
    } catch {
      throw new Error(`projectPath does not exist: ${projectPath}`);
    }
    if (!stats.isDirectory()) {
      throw new Error(`projectPath must be a directory: ${projectPath}`);
    }

    const maxFiles = this.parseLimitEnv('ADVANCED_PYEXAMINE_MAX_UPLOAD_FILES', DEFAULT_MAX_UPLOAD_FILES);
    const maxBytes = this.parseLimitEnv('ADVANCED_PYEXAMINE_MAX_UPLOAD_BYTES', DEFAULT_MAX_UPLOAD_BYTES);

    const files: Record<string, string> = {};
    let totalBytes = 0;
    let fileCount = 0;

    const walk = async (directory: string): Promise<void> => {
      const entries = await fs.readdir(directory, { withFileTypes: true });

      for (const entry of entries) {
        // 심링크는 따라가지 않는다 (순환·의도치 않은 외부 반출 방지)
        if (entry.isSymbolicLink()) continue;

        const absolute = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
          await walk(absolute);
          continue;
        }

        if (!entry.isFile() || !entry.name.endsWith('.py')) continue;

        fileCount += 1;
        if (fileCount > maxFiles) {
          throw new Error(
            `too many Python files to upload (limit ${maxFiles}). ` +
            'Analyze a subdirectory or raise ADVANCED_PYEXAMINE_MAX_UPLOAD_FILES.',
          );
        }

        const content = await fs.readFile(absolute, 'utf8');
        totalBytes += Buffer.byteLength(content, 'utf8');
        if (totalBytes > maxBytes) {
          throw new Error(
            `Python sources exceed the upload limit of ${maxBytes} bytes. ` +
            'Analyze a subdirectory or raise ADVANCED_PYEXAMINE_MAX_UPLOAD_BYTES.',
          );
        }

        files[path.relative(root, absolute).split(path.sep).join('/')] = content;
      }
    };

    await walk(root);

    if (fileCount === 0) {
      throw new Error(`No Python files found under projectPath: ${projectPath}`);
    }

    return files;
  }

  private parseLimitEnv(name: string, fallback: number): number {
    const raw = process.env[name]?.trim();
    if (!raw) return fallback;

    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`${name} must be a positive number.`);
    }
    return value;
  }

  /**
   * 로컬 소스를 zip으로 묶어 analyzer service에 올리고 결과를 정규화한다.
   *
   * service는 엔드유저의 파일시스템을 보지 못하므로 경로가 아니라 내용을 보낸다.
   * `only` / `summaryOnly` / `limitPerGroup`은 service가 지원하지 않아 여기서 적용한다.
   */
  private async analyzeViaService(
    projectPath: string,
    options: { only?: string; summaryOnly: boolean; limitPerGroup?: number },
  ): Promise<AdvancedPyexamineResult> {
    if (!this.serviceClient) throw new Error('advanced_pyexamine HTTP service client is not configured.');

    const entries = await this.collectPythonSourceEntries(projectPath);
    const archive = createZip(entries);
    const { body, contentType } = createMultipartBody('file', 'sources.zip', archive);

    const response = await this.serviceClient.post('/analyze', body, {
      headers: { 'Content-Type': contentType },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });

    if (response.status < 200 || response.status >= 300) {
      throw new Error(`advanced_pyexamine service failed: ${this.readHttpError(response.data, response.status)}`);
    }

    const smellGroups = this.groupServiceResults(response.data, options.only);
    const summary = this.summarize(smellGroups);
    const returnedGroups = options.summaryOnly
      ? undefined
      : this.limitGroups(smellGroups, options.limitPerGroup);
    const returnedTotal = returnedGroups ? this.countSmells(returnedGroups) : 0;

    return {
      tool: 'advanced_pyexamine',
      language: 'python',
      projectPath,
      ...(options.only ? { only: options.only } : {}),
      ...(returnedGroups ? { smellGroups: returnedGroups } : {}),
      summary,
      response: {
        summaryOnly: options.summaryOnly,
        ...(options.limitPerGroup ? { limitPerGroup: options.limitPerGroup } : {}),
        returnedTotal,
        truncated: returnedTotal < summary.total,
      },
    };
  }

  /**
   * service 응답(`{summary, results[]}`)을 detector 이름별 그룹으로 바꾼다.
   *
   * service는 평평한 results 배열을 주고 detector 필터도 없다.
   * 도구 계약(smellGroups)을 유지하려면 이 변환이 필요하다.
   */
  private groupServiceResults(data: unknown, only?: string): Record<string, unknown[]> {
    if (!data || typeof data !== 'object') {
      throw new Error('advanced_pyexamine service returned a non-object response.');
    }

    const results = (data as { results?: unknown }).results;
    if (!Array.isArray(results)) {
      throw new Error('advanced_pyexamine service response has no "results" array.');
    }

    const wanted = only
      ? new Set(only.split(',').map((name) => name.trim()).filter(Boolean))
      : undefined;

    const groups: Record<string, unknown[]> = {};

    for (const item of results) {
      if (!item || typeof item !== 'object') continue;
      const raw = item as Record<string, unknown>;

      const name = typeof raw.name === 'string' ? raw.name : 'unknown';
      if (wanted && !wanted.has(name)) continue;

      const lineNumber = typeof raw.lineNumber === 'number' ? raw.lineNumber : null;

      (groups[name] ??= []).push({
        name,
        category: raw.type ?? null,
        entity: raw['Module/Class'] ?? null,
        location: {
          file: raw.file ?? null,
          line_start: lineNumber,
          line_end: lineNumber,
        },
        severity: typeof raw.severity === 'string' ? raw.severity : 'unknown',
        metrics: {},
        related_locations: [],
        message: raw.description ?? null,
      });
    }

    return groups;
  }

  private run(args: string[]): Promise<SpawnResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.bin, args, {
        cwd: this.cwd,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill('SIGTERM');
        reject(new Error(`advanced_pyexamine timed out after ${this.timeoutMs}ms.`));
      }, this.timeoutMs);

      child.stdout.setEncoding('utf8');
      child.stderr.setEncoding('utf8');

      child.stdout.on('data', (chunk) => {
        stdout += chunk;
      });

      child.stderr.on('data', (chunk) => {
        stderr += chunk;
      });

      child.on('error', (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`Failed to start advanced_pyexamine: ${error.message}`));
      });

      child.on('close', (exitCode, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);

        if (exitCode !== 0) {
          const details = stderr.trim() || stdout.trim() || `exitCode=${exitCode}, signal=${signal ?? 'none'}`;
          reject(new Error(`advanced_pyexamine failed: ${details}`));
          return;
        }

        resolve({ stdout, stderr, exitCode, signal });
      });
    });
  }

  private parseJsonOutput(stdout: string): Record<string, unknown[]> {
    const trimmed = stdout.trim();
    if (!trimmed) throw new Error('advanced_pyexamine returned empty stdout.');

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`advanced_pyexamine returned invalid JSON: ${message}`);
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('advanced_pyexamine JSON output must be an object grouped by smell name.');
    }

    const groups = parsed as Record<string, unknown>;
    for (const [name, value] of Object.entries(groups)) {
      if (!Array.isArray(value)) {
        throw new Error(`advanced_pyexamine JSON group "${name}" must be an array.`);
      }
    }

    return groups as Record<string, unknown[]>;
  }

  private parseServiceResult(data: unknown): AdvancedPyexamineResult {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('advanced_pyexamine service response must be an object.');
    }

    const result = data as Partial<AdvancedPyexamineResult>;

    if (result.tool !== 'advanced_pyexamine') throw new Error('advanced_pyexamine service response has invalid tool.');
    if (result.language !== 'python') throw new Error('advanced_pyexamine service response has invalid language.');
    if (typeof result.projectPath !== 'string' || !result.projectPath.trim()) {
      throw new Error('advanced_pyexamine service response is missing projectPath.');
    }
    if (!result.summary || typeof result.summary.total !== 'number') {
      throw new Error('advanced_pyexamine service response is missing summary.');
    }
    if (!result.response || typeof result.response.summaryOnly !== 'boolean') {
      throw new Error('advanced_pyexamine service response is missing response metadata.');
    }

    return result as AdvancedPyexamineResult;
  }

  private readHttpError(data: unknown, status: number): string {
    if (data && typeof data === 'object') {
      const body = data as {
        detail?: unknown;
        message?: unknown;
        error?: { message?: unknown };
      };

      const message = body.error?.message ?? body.detail ?? body.message;
      if (typeof message === 'string' && message.trim()) return message.trim();
    }

    return `HTTP ${status}`;
  }

  private summarize(smellGroups: Record<string, unknown[]>): AdvancedPyexamineSummary {
    const summary: AdvancedPyexamineSummary = {
      total: 0,
      bySeverity: {},
      byName: {},
    };

    for (const [name, smells] of Object.entries(smellGroups)) {
      summary.byName[name] = smells.length;
      summary.total += smells.length;

      for (const smell of smells) {
        const severity = this.getSmellSeverity(smell);
        summary.bySeverity[severity] = (summary.bySeverity[severity] ?? 0) + 1;
      }
    }

    return summary;
  }

  private limitGroups(smellGroups: Record<string, unknown[]>, limitPerGroup: number | undefined): Record<string, unknown[]> {
    if (!limitPerGroup) return smellGroups;

    return Object.fromEntries(
      Object.entries(smellGroups).map(([name, smells]) => [name, smells.slice(0, limitPerGroup)]),
    );
  }

  private countSmells(smellGroups: Record<string, unknown[]>): number {
    return Object.values(smellGroups).reduce((total, smells) => total + smells.length, 0);
  }

  private getSmellSeverity(smell: unknown): string {
    if (!smell || typeof smell !== 'object') return 'unknown';
    const severity = (smell as { severity?: unknown }).severity;
    if (typeof severity !== 'string' || !severity.trim()) return 'unknown';
    return severity.trim().toLowerCase();
  }

  private parseArgs(value: string): string[] {
    return value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }

  private parseMode(value: string | undefined): AdvancedPyexamineMode {
    const mode = value?.trim().toLowerCase() || 'cli';
    if (mode === 'cli' || mode === 'http') return mode;
    throw new Error('ADVANCED_PYEXAMINE_MODE must be either "cli" or "http".');
  }

  private normalizeOptionalPath(value: string | undefined): string | undefined {
    if (!value?.trim()) return undefined;
    return path.resolve(value.trim());
  }

  private getRequiredString(value: unknown, fieldName: string): string {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${fieldName} is required.`);
    return value.trim();
  }

  private getOptionalString(value: unknown, fieldName: string): string | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${fieldName} must be a non-empty string when provided.`);
    return value.trim();
  }

  private getOptionalBoolean(value: unknown, fieldName: string): boolean | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'boolean') throw new Error(`${fieldName} must be a boolean when provided.`);
    return value;
  }

  private parseOptionalPositiveInteger(value: unknown, fieldName: string): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const parsedValue = Number(value);
    if (!Number.isInteger(parsedValue) || parsedValue <= 0) throw new Error(`${fieldName} must be a positive integer.`);
    return parsedValue;
  }
}
