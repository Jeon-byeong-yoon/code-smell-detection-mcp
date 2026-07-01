import { Transport } from '../stdio/stdio-transport';
import { AdvancedPyexamineClient } from '../clients/advanced-pyexamine-client';

export function registerAdvancedPyexamineTools(transport: Transport) {
  const client = new AdvancedPyexamineClient();

  transport.register('analyze_python_smells', async (params) => {
    const result = await client.analyzePythonSmells(params as Record<string, unknown>);
    return { ok: true, result };
  });
}
