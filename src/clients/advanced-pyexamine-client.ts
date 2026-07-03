import { spawn } from 'child_process';
import axios, { AxiosInstance } from 'axios';
import path from 'path';

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

      const serviceTimeout = Number(process.env.ADVANCED_PYEXAMINE_SERVICE_TIMEOUT_MS ?? this.timeoutMs);
      this.serviceClient = axios.create({
        baseURL: serviceUrl,
        timeout: Number.isFinite(serviceTimeout) && serviceTimeout > 0 ? serviceTimeout : this.timeoutMs,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
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
      return this.analyzePythonSmellsWithHttp({
        projectPath,
        ...(only ? { only } : {}),
        summaryOnly,
        ...(limitPerGroup ? { limitPerGroup } : {}),
      });
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

  private async analyzePythonSmellsWithHttp(payload: Record<string, unknown>): Promise<AdvancedPyexamineResult> {
    if (!this.serviceClient) throw new Error('advanced_pyexamine HTTP service client is not configured.');

    const response = await this.serviceClient.post('/analyze', payload);
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`advanced_pyexamine service failed: ${this.readHttpError(response.data, response.status)}`);
    }

    return this.parseServiceResult(response.data);
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
