export interface Smell {
  id: string;
  file: string;
  line: number;
  severity: 'low' | 'medium' | 'high' | 'critical';
  message: string;
  rule: string;
}

export interface AnalysisResult {
  commit: string;
  repo: string;
  scannedAt: string;
  smells: Smell[];
}

export interface MetricAnalysis {
  id: string;
  projectId: number;
  createdAt: string;
  metrics: Record<string, any>;
}
