// Pure mapping from a Run's persisted status (+ its QaSession) to the right
// "continue" target: a label, an href, and a coarse stage bucket. Extracted from
// app/page.tsx so the home dashboard and the /runs list share one source of
// truth and the logic can be unit-tested without Prisma.

export type RunStage =
  | 'intake'
  | 'qa'
  | 'compose'
  | 'ready'
  | 'planning'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'other';

export interface ResumeTargetInput {
  id: string;
  status: string;
  qaSession: { id: string; status: string } | null;
}

export interface ResumeTarget {
  label: string;
  href: string;
  stage: RunStage;
}

export function resumeTarget(run: ResumeTargetInput): ResumeTarget {
  if (run.status === 'po_qa' || run.status === 'pending') {
    if (run.qaSession?.status === 'completed') {
      return {
        label: 'Team composition',
        href: `/runs/new/${run.qaSession.id}/compose`,
        stage: 'compose',
      };
    }
    if (run.qaSession) {
      return { label: 'Q&A', href: `/runs/new/${run.qaSession.id}`, stage: 'qa' };
    }
    return { label: 'Prompt intake', href: '/runs/new', stage: 'intake' };
  }
  if (run.status === 'ready') return { label: 'Ready to start', href: `/runs/${run.id}`, stage: 'ready' };
  if (run.status === 'planning') return { label: 'Planning', href: `/runs/${run.id}`, stage: 'planning' };
  if (run.status === 'running') return { label: 'Team working', href: `/runs/${run.id}`, stage: 'running' };
  if (run.status === 'succeeded') return { label: 'Execution complete', href: `/runs/${run.id}`, stage: 'succeeded' };
  if (run.status === 'failed') return { label: 'Needs attention', href: `/runs/${run.id}`, stage: 'failed' };
  return { label: run.status, href: `/runs/${run.id}`, stage: 'other' };
}
