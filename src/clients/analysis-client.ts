import axios from 'axios';
import { AnalysisResult, Smell, MetricAnalysis } from '../types/code-analysis';

const BASE = process.env.ANALYSIS_API_BASE_URL || 'http://localhost:13000/api';
const TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT_MS || '15000', 10);

const http = axios.create({
  baseURL: BASE,
  timeout: TIMEOUT,
});

export async function getLatestPyexamineResult(repo: string, ref: string): Promise<AnalysisResult> {
  const res = await http.get(`/pyexamine/latest`, { params: { repo, ref } });
  return res.data;
}

export async function getPyexamineResultByCommit(commit: string): Promise<AnalysisResult> {
  const res = await http.get(`/pyexamine/commits/${commit}`);
  return res.data;
}

export async function getHighSeveritySmells(projectId: number): Promise<Smell[]> {
  const res = await http.get(`/smells/high`, { params: { projectId } });
  return res.data;
}

export async function runMetricAnalysis(projectId: number, payload: any): Promise<MetricAnalysis> {
  const res = await http.post(`/metrics/run`, payload, { params: { projectId } });
  return res.data;
}
