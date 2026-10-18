import type { AgentRun } from '../../../../../packages/agent-core/src';
import { scriptConversationClient } from '../../clients/scriptConversationClient';
import { scriptAgentClient } from '../../clients/scriptClient';

export const goalUnresolvedMessage = '委托结果待核对，输入已保留。请先在委托中核对已收到的返回，再暂停或继续。';
export const isUnresolvedGoal = (run: AgentRun) => run.kind === 'GOAL' && run.status === 'RECONCILIATION_REQUIRED';
export const goalActiveMessage = '委托正在运行，输入已保留。请先暂停，再修改目标并明确继续。';
export const isWorkingGoal = (run: AgentRun) => run.kind === 'GOAL' &&
  ['QUEUED', 'RUNNING', 'WAITING_STEP', 'WAITING_EXTERNAL'].includes(run.status);

/** Read fresh versions before pausing. A conflict must leave the UI in its
 * original mode; retries are explicit so a newer author decision is not lost. */
export async function pauseThreadGoals(threadId: string, client: Pick<typeof scriptAgentClient, 'runs'|'control'> = scriptAgentClient, conversations: Pick<typeof scriptConversationClient, 'get'> = scriptConversationClient) {
  const [{ runs }, { conversation }] = await Promise.all([client.runs(threadId), conversations.get(threadId)]);
  if (runs.some(({run})=>isUnresolvedGoal(run))) throw new Error(goalUnresolvedMessage);
  if (conversation.turns.some(turn => ['QUEUED', 'RUNNING', 'WAITING_STEP', 'WAITING_EXTERNAL'].includes(turn.status))) {
    throw new Error('当前消息尚未完成，请等待回复后切换模式；输入已保留。');
  }
  for (const { run } of runs.filter(({ run }) => isWorkingGoal(run))) {
    const result = await client.control(run, 'pause');
    if (result.run.status !== 'PAUSED') throw new Error('尚未确认委托暂停，请刷新后重试；模式和输入已保留。');
  }
}
