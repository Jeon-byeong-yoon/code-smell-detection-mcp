#!/usr/bin/env node
import axios from 'axios';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import process from 'node:process';
import { buildPyExaminePayload, RawPyExamineResultItem } from './transformer';

interface CliOptions {
  inputPath: string;
  jobName: string;
  buildNumber: number;
  status: string;
  buildUrl: string;
  commitHash: string;
  teamProjectId?: number;
  inputFormat?: 'json' | 'csv';
  repoRoot?: string;
  defaultSeverity?: string;
  postUrl?: string;
  outputPath?: string;
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const input = await loadRawPyExamineInput(options.inputPath, options.inputFormat);
  const results = extractResults(input);

  const payload = buildPyExaminePayload({
    jobName: options.jobName,
    buildNumber: options.buildNumber,
    status: options.status,
    buildUrl: options.buildUrl,
    commitHash: options.commitHash,
    teamProjectId: options.teamProjectId,
    repoRoot: options.repoRoot,
    defaultSeverity: options.defaultSeverity,
    results,
  });

  if (options.outputPath) {
    await writeFile(resolve(options.outputPath), JSON.stringify(payload, null, 2), 'utf8');
  }

  if (options.postUrl) {
    await axios.post(options.postUrl, payload, { headers: { 'Content-Type': 'application/json' }, timeout: 15000 });
  }

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function parseCliOptions(argv: string[]): CliOptions {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for argument: --${key}`);
    values.set(key, value);
    index += 1;
  }

  const inputPath = getRequiredArg(values, 'input');
  const jobName = getRequiredArg(values, 'job-name');
  const buildNumber = Number.parseInt(getRequiredArg(values, 'build-number'), 10);
  const status = getRequiredArg(values, 'status');
  const buildUrl = getRequiredArg(values, 'build-url');
  const commitHash = getRequiredArg(values, 'commit-hash');
  const teamProjectId = parseOptionalPositiveIntArg(values, 'team-project-id');
  if (Number.isNaN(buildNumber)) throw new Error('`--build-number` must be an integer.');

  return {
    inputPath,
    jobName,
    buildNumber,
    status,
    buildUrl,
    commitHash,
    teamProjectId,
    inputFormat: normalizeInputFormat(values.get('format')),
    repoRoot: values.get('repo-root'),
    defaultSeverity: values.get('default-severity'),
    postUrl: values.get('post-url'),
    outputPath: values.get('output'),
  };
}

function parseOptionalPositiveIntArg(values: Map<string, string>, key: string): number | undefined {
  const rawValue = values.get(key);
  if (rawValue === undefined) return undefined;
  const parsedValue = Number.parseInt(rawValue, 10);
  if (Number.isNaN(parsedValue)) throw new Error(`\`--${key}\` must be an integer.`);
  if (parsedValue < 1) throw new Error(`\`--${key}\` must be greater than or equal to 1.`);
  return parsedValue;
}

function getRequiredArg(values: Map<string, string>, key: string): string {
  const value = values.get(key);
  if (!value) throw new Error(`Missing required argument: --${key}`);
  return value;
}

async function loadRawPyExamineInput(inputPath: string, inputFormat?: 'json' | 'csv'): Promise<RawPyExamineResultItem[] | Record<string, unknown>> {
  const fileContent = await readFile(resolve(inputPath), 'utf8');
  const format = inputFormat ?? inferInputFormat(inputPath);
  if (format === 'csv') return parseCsvResults(fileContent);
  return JSON.parse(fileContent) as RawPyExamineResultItem[] | Record<string, unknown>;
}

function extractResults(input: RawPyExamineResultItem[] | Record<string, unknown>): RawPyExamineResultItem[] {
  if (Array.isArray(input)) return input;
  if (input && typeof input === 'object' && 'results' in input && Array.isArray(input.results)) return input.results;
  if (input && typeof input === 'object' && 'pyExamineResult' in input && Array.isArray(input.pyExamineResult)) return input.pyExamineResult;
  if (input && typeof input === 'object' && 'smells' in input && Array.isArray(input.smells)) return input.smells;
  throw new Error('Unable to find smell results array. Expected root array or one of: results, pyExamineResult, smells.');
}

function normalizeInputFormat(value?: string): 'json' | 'csv' | undefined {
  if (!value) return undefined;
  if (value !== 'json' && value !== 'csv') throw new Error('`--format` must be either `json` or `csv`.');
  return value;
}

function inferInputFormat(inputPath: string): 'json' | 'csv' {
  const extension = extname(inputPath).toLowerCase();
  if (extension === '.csv') return 'csv';
  return 'json';
}

function parseCsvResults(content: string): RawPyExamineResultItem[] {
  const rows = parseCsv(content).filter((row) => row.some((cell) => cell.trim().length > 0));
  if (rows.length === 0) return [];
  const [header, ...body] = rows;
  const normalizedHeader = header.map((cell) => cell.trim());
  return body.map((row) => {
    const record: Record<string, string> = {};
    normalizedHeader.forEach((column, index) => {
      record[column] = row[index] ?? '';
    });
    return mapCsvRecordToRawResult(record);
  });
}

function mapCsvRecordToRawResult(record: Record<string, string>): RawPyExamineResultItem {
  return {
    category: getRecordValue(record, 'type') ?? getRecordValue(record, 'category'),
    name: getRecordValue(record, 'name') ?? getRecordValue(record, 'smell') ?? getRecordValue(record, 'rule'),
    description: getRecordValue(record, 'description') ?? getRecordValue(record, 'message'),
    file: getRecordValue(record, 'file') ?? getRecordValue(record, 'path'),
    className: getRecordValue(record, 'Module/Class') ?? getRecordValue(record, 'module/class') ?? getRecordValue(record, 'class') ?? getRecordValue(record, 'className'),
    moduleName: getRecordValue(record, 'module') ?? getRecordValue(record, 'moduleName'),
    lineNumber: parseOptionalNumber(getRecordValue(record, 'lineNumber') ?? getRecordValue(record, 'Line Number') ?? getRecordValue(record, 'line')),
    severity: getRecordValue(record, 'severity') ?? getRecordValue(record, 'priority'),
  };
}

function getRecordValue(record: Record<string, string>, key: string): string | undefined {
  const matchedKey = Object.keys(record).find((candidate) => candidate.toLowerCase() === key.toLowerCase());
  if (!matchedKey) return undefined;
  const value = record[matchedKey]?.trim();
  return value?.length ? value : undefined;
}

function parseOptionalNumber(value?: string): number | undefined {
  if (!value) return undefined;
  const parsedValue = Number.parseInt(value, 10);
  return Number.isNaN(parsedValue) ? undefined : parsedValue;
}

interface CsvCharResult {
  insideQuotes: boolean;
  currentCell: string;
  pushCell: boolean;
  pushRow: boolean;
  skipNext: boolean;
}

function handleQuote(nextChar: string | undefined, insideQuotes: boolean, currentCell: string): CsvCharResult {
  if (insideQuotes && nextChar === '"') {
    return {
      insideQuotes,
      currentCell: currentCell + '"',
      pushCell: false,
      pushRow: false,
      skipNext: true,
    };
  }

  return {
    insideQuotes: !insideQuotes,
    currentCell,
    pushCell: false,
    pushRow: false,
    skipNext: false,
  };
}

function handleComma(insideQuotes: boolean, currentCell: string): CsvCharResult {
  if (insideQuotes) {
    return {
      insideQuotes,
      currentCell: currentCell + ',',
      pushCell: false,
      pushRow: false,
      skipNext: false,
    };
  }

  return {
    insideQuotes,
    currentCell,
    pushCell: true,
    pushRow: false,
    skipNext: false,
  };
}

function handleNewline(char: string, nextChar: string | undefined, currentCell: string): CsvCharResult {
  const shouldSkip = char === '\r' && nextChar === '\n';

  return {
    insideQuotes: false,
    currentCell,
    pushCell: false,
    pushRow: true,
    skipNext: shouldSkip,
  };
}

function processCsvChar(
  char: string,
  nextChar: string | undefined,
  insideQuotes: boolean,
  currentCell: string
): CsvCharResult {
  if (char === '"') {
    return handleQuote(nextChar, insideQuotes, currentCell);
  }

  if (char === ',') {
    return handleComma(insideQuotes, currentCell);
  }

  if (char === '\n' || char === '\r') {
    return handleNewline(char, nextChar, currentCell);
  }

  return {
    insideQuotes,
    currentCell: currentCell + char,
    pushCell: false,
    pushRow: false,
    skipNext: false,
  };
}

function parseCsv(content: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = '';
  let insideQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const nextChar = content[index + 1];

    const result = processCsvChar(char, nextChar, insideQuotes, currentCell);

    if (result.skipNext) {
      index += 1;
    }

    insideQuotes = result.insideQuotes;
    currentCell = result.currentCell;

    if (result.pushCell) {
      currentRow.push(currentCell);
      currentCell = '';
    }

    if (result.pushRow) {
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = '';
    }
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    currentRow.push(currentCell);
    rows.push(currentRow);
  }

  return rows;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown CLI error';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
