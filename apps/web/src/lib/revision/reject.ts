// Revision reject. No team/revision mutation — just records the decision in the
// run event log so the audit trail shows the proposal was reviewed and declined.

import { appendEvent } from '@lib/events/append';

export async function rejectRevision(
  runId: string,
  baseRevisionId: string | null,
): Promise<void> {
  await appendEvent({
    runId,
    type: 'revision.rejected',
    payload: { baseRevisionId },
  });
}
