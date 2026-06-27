import { Transport } from '../stdio/stdio-transport';
import * as client from '../clients/analysis-client';

export function registerMetricsTools(transport: Transport) {
  transport.register('run_metric_analysis', async (params) => {
    const { projectId, payload } = params;
    const result = await client.runMetricAnalysis(Number(projectId), payload);
    return { ok: true, result };
  });

  transport.register('list_metric_analyses', async (params) => {
    // TODO: call list endpoint if exists
    return { ok: true, result: [] };
  });

  transport.register('get_metric_analysis', async (params) => {
    // TODO
    return { ok: true, result: null };
  });
}
