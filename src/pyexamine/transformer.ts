import { PyExamineResultItemDto, CreateCodeAnalysisDto } from '../types/code-analysis';
import { relative } from 'node:path';

export interface BuildPyExaminePayloadInput {
  jobName: string;
  buildNumber: number;
  status: string;
  buildUrl: string;
  commitHash: string;
  teamProjectId?: number;
  repoRoot?: string;
  defaultSeverity?: string;
  results: RawPyExamineResultItem[];
}

export interface RawPyExamineResultItem {
  category?: string;
  type?: string;
  rule?: string;
  name?: string;
  description?: string;
  message?: string;
  file?: string;
  path?: string;
  moduleName?: string;
  className?: string;
  line?: number;
  lineNumber?: number;
  severity?: string;
  priority?: string;
}

const DEFAULT_SEVERITY = 'medium';

export function buildPyExaminePayload(input: BuildPyExaminePayloadInput): CreateCodeAnalysisDto {
  return {
    jobName: input.jobName,
    buildNumber: input.buildNumber,
    status: input.status,
    buildUrl: input.buildUrl,
    commitHash: input.commitHash,
    teamProjectId: input.teamProjectId,
    pyExamineResult: dedupePyExamineResults(input.results.map((item) => normalizePyExamineItem(item, input.repoRoot, input.defaultSeverity))),
  };
}

export function normalizePyExamineItem(item: RawPyExamineResultItem, repoRoot?: string, defaultSeverity = DEFAULT_SEVERITY): PyExamineResultItemDto {
  const name = item.name ?? item.rule;
  const rawFile = item.file ?? item.path;

  if (!name) throw new Error('PyExamine item is missing `name` or `rule`.');
  if (!rawFile) throw new Error(`PyExamine item "${name}" is missing ` + '`file` or `path`.');

  const normalizedFile = normalizeRepositoryPath(rawFile, repoRoot);

  return {
    type: normalizePyExamineType(item.category ?? item.type),
    name,
    file: normalizedFile,
    severity: normalizeSeverity(item.severity ?? item.priority, defaultSeverity),
    description: item.description ?? item.message ?? `Detected ${name} in ${normalizedFile}`,
    'Module/Class': item.className ?? item.moduleName ?? 'Unknown',
    lineNumber: normalizeLineNumber(item.lineNumber ?? item.line),
  };
}

export function normalizePyExamineType(type?: string): string {
  if (!type) return 'code_smell';
  const normalizedType = type.trim().toLowerCase().replace(/\s+/g, '_');
  if (normalizedType.includes('architect')) return 'architectural_smell';
  if (normalizedType.includes('struct')) return 'structural_smell';
  return 'code_smell';
}

export function normalizeSeverity(severity?: string, defaultSeverity = DEFAULT_SEVERITY): string {
  if (!severity) return defaultSeverity;
  const normalizedSeverity = severity.trim().toLowerCase();
  if (['critical', 'blocker', 'fatal'].includes(normalizedSeverity)) return 'critical';
  if (['high', 'major', 'error'].includes(normalizedSeverity)) return 'high';
  if (['medium', 'moderate', 'warning', 'warn'].includes(normalizedSeverity)) return 'medium';
  if (['low', 'minor', 'info', 'informational'].includes(normalizedSeverity)) return 'low';
  return defaultSeverity;
}

export function normalizeRepositoryPath(filePath: string, repoRoot?: string): string {
  const normalizedInput = filePath.replace(/\\/g, '/');
  if (!repoRoot) return normalizedInput;
  const relativePath = relative(repoRoot, filePath).replace(/\\/g, '/');
  if (relativePath.startsWith('..')) throw new Error(`PyExamine item path "${filePath}" is outside repo root "${repoRoot}".`);
  return relativePath || normalizedInput;
}

export function normalizeLineNumber(lineNumber?: number): number {
  if (typeof lineNumber !== 'number' || Number.isNaN(lineNumber)) return 0;
  return Math.max(0, Math.trunc(lineNumber));
}

export function dedupePyExamineResults(items: PyExamineResultItemDto[]): PyExamineResultItemDto[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.file}::${item.lineNumber ?? 0}::${item.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
