import { Transport } from '../stdio/stdio-transport';
import { MetricsApiClient } from '../clients/metrics-client';

export function registerMetricsTools(transport: Transport) {
  const client = new MetricsApiClient();

  transport.register('run_metric_analysis', async (params) => {
    const result = await client.runMetricAnalysis(params as Record<string, unknown>);
    return { ok: true, result };
  });

  transport.register('list_metric_analyses', async (params) => {
    const result = await client.listMetricAnalyses(params as Record<string, unknown>);
    return { ok: true, result };
  });

  transport.register('get_metric_analysis', async (params) => {
    const result = await client.getMetricAnalysis(params as Record<string, unknown>);
    return { ok: true, result };
  });
}
