import { Transport } from '../stdio/stdio-transport';
import * as client from '../clients/analysis-client';

/**
 * export 함수는 transport.registerTool 같은 인터페이스로 도구를 등록합니다.
 * 실제 MCP message 형식에 맞춰 payload parsing/response를 구현하세요.
 */
export function registerPyexamineTools(transport: Transport) {
  transport.register('get_latest_pyexamine_result', async (params) => {
    const { repo, ref } = params;
    const result = await client.getLatestPyexamineResult(repo, ref);
    return { ok: true, result };
  });

  transport.register('get_pyexamine_result_by_commit', async (params) => {
    const { commit } = params;
    const result = await client.getPyexamineResultByCommit(commit);
    return { ok: true, result };
  });

  transport.register('get_high_severity_smells', async (params) => {
    const { projectId } = params;
    const result = await client.getHighSeveritySmells(Number(projectId));
    return { ok: true, result };
  });

  transport.register('get_smells_by_file', async (params) => {
    // TODO: implement by delegating to analysis API
    return { ok: true, result: [] };
  });
}
