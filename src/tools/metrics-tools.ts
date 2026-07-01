import { Transport } from '../stdio/stdio-transport';
import { MetricsApiClient } from '../clients/metrics-client';

export function registerMetricsTools(transport: Transport) {
  let client: MetricsApiClient | undefined;

  const getClient = () => {
    client ??= new MetricsApiClient();
    return client;
  };

  transport.register('run_metric_analysis', async (params) => {
    const result = await getClient().runMetricAnalysis(params as Record<string, unknown>);
    return { ok: true, result };
  });

  transport.register('list_metric_analyses', async (params) => {
    const result = await getClient().listMetricAnalyses(params as Record<string, unknown>);
    return { ok: true, result };
  });

  transport.register('get_metric_analysis', async (params) => {
    const result = await getClient().getMetricAnalysis(params as Record<string, unknown>);
    return { ok: true, result };
  });
}
