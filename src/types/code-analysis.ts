export interface PyExamineResultItemDto {
  type: string;
  name: string;
  file: string;
  severity: string;
  description: string;
  'Module/Class': string;
  lineNumber: number;
}

export interface CreateCodeAnalysisDto {
  jobName: string;
  buildNumber: number;
  status: string;
  buildUrl: string;
  commitHash: string;
  teamProjectId?: number;
  pyExamineResult?: PyExamineResultItemDto[];
}

export interface PyExamineResultItem {
  file?: string;
  name?: string;
  type?: string;
  severity?: string;
  lineNumber?: number;
  description?: string;
  'Module/Class'?: string;
  [key: string]: unknown;
}

export interface CodeAnalysisResult {
  id?: number;
  createdAt?: string;
  updatedAt?: string;
  jobName: string;
  buildNumber: number;
  status: string;
  buildUrl: string;
  commitHash: string;
  teamProjectId?: number | null;
  pyExamineResult?: PyExamineResultItem[] | null;
  [key: string]: unknown;
}

export interface AnalysisResult {
  commit: string;
  repo: string;
  scannedAt: string;
  smells: PyExamineResultItem[];
}

export interface Smell {
  id: string;
  file: string;
  line: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  rule: string;
}

export interface MetricAnalysis {
  id: string;
  projectId: number;
  createdAt: string;
  metrics: Record<string, any>;
}
