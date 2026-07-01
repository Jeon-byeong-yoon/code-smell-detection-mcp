import { spawn } from 'child_process';
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
  smellGroups: Record<string, unknown[]>;
  summary: AdvancedPyexamineSummary;
};

type SpawnResult = {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
};

export class AdvancedPyexamineClient {
  private readonly bin: string;
  private readonly baseArgs: string[];
  private readonly cwd?: string;
  private readonly timeoutMs: number;

  constructor() {
    this.bin = process.env.ADVANCED_PYEXAMINE_BIN?.trim() || 'python';
    this.baseArgs = this.parseArgs(process.env.ADVANCED_PYEXAMINE_ARGS ?? '-m,advanced_pyexamine');
    this.cwd = this.normalizeOptionalPath(process.env.ADVANCED_PYEXAMINE_CWD);

    const timeout = Number(process.env.ADVANCED_PYEXAMINE_TIMEOUT_MS ?? '30000');
    this.timeoutMs = Number.isFinite(timeout) && timeout > 0 ? timeout : 30000;
  }

  async analyzePythonSmells(payload: Record<string, unknown>): Promise<AdvancedPyexamineResult> {
    const projectPath = this.getRequiredString(payload.projectPath, 'projectPath');
    const only = this.getOptionalString(payload.only, 'only');

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

    return {
      tool: 'advanced_pyexamine',
      language: 'python',
      projectPath,
      ...(only ? { only } : {}),
      smellGroups,
      summary: this.summarize(smellGroups),
    };
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
}
