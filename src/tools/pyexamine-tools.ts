import { Transport } from '../stdio/stdio-transport';
import { CodeAnalysisApiClient } from '../clients/code-analysis-client';

export function registerPyexamineTools(transport: Transport) {
  let client: CodeAnalysisApiClient | undefined;

  const getClient = () => {
    client ??= new CodeAnalysisApiClient();
    return client;
  };

  transport.register('get_latest_pyexamine_result', async (params) => {
    const result = await getClient().getLatestPyExamineResult(params as Record<string, unknown>);
    return { ok: true, result };
  });

  transport.register('get_pyexamine_result_by_commit', async (params) => {
    const result = await getClient().getPyExamineResultByCommit(params as Record<string, unknown>);
    return { ok: true, result };
  });

  transport.register('get_high_severity_smells', async (params) => {
    const result = await getClient().getHighSeveritySmells(params as Record<string, unknown>);
    return { ok: true, result };
  });

  transport.register('get_smells_by_file', async (params) => {
    const result = await getClient().getSmellsByFile(params as Record<string, unknown>);
    return { ok: true, result };
  });
}
