'use client';

import { useState } from 'react';

import type { DiffLine, TeamChangeSummary } from '@lib/feedback/diff';

import { RevisionDiff } from './RevisionDiff';

interface ProposeResponse {
  ok: boolean;
  baseRevisionId: string;
  feedbackBatchId: string;
  rationale: string;
  diff: DiffLine[];
  counts: { added: number; removed: number };
  summary: TeamChangeSummary;
  proposedSpec: unknown;
  error?: string;
}

type Phase =
  | 'idle'
  | 'proposing'
  | 'proposed'
  | 'approving'
  | 'rejecting'
  | 'approved'
  | 'rejected'
  | 'error';

export function RevisionReview({ runId }: { runId: string }) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<ProposeResponse | null>(null);
  const [approved, setApproved] = useState<{
    revisionId?: string;
    version: number | null;
    teamId?: string;
    paths?: { agentsMd: string; teamJson: string };
    exportedPaths?: string[];
  } | null>(null);

  async function propose() {
    setPhase('proposing');
    setError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/revision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'propose' }),
      });
      const data = (await res.json().catch(() => ({}))) as ProposeResponse;
      if (!res.ok || !data.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        setPhase('error');
        return;
      }
      setProposal(data);
      setPhase('proposed');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  }

  async function approve() {
    if (!proposal) return;
    setPhase('approving');
    setError(null);
    try {
      const res = await fetch(`/api/runs/${runId}/revision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'approve',
          baseRevisionId: proposal.baseRevisionId,
          feedbackBatchId: proposal.feedbackBatchId,
          proposedSpec: proposal.proposedSpec,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        revisionId?: string;
        version?: number;
        teamId?: string;
        paths?: { agentsMd: string; teamJson: string };
        exportedPaths?: string[];
        error?: string;
      };
      if (!res.ok || !data.ok) {
        if (data.error === 'revision_stale') {
          setError('This proposal is out of date (the team changed). Get fresh suggestions.');
          setProposal(null);
          setPhase('idle');
          return;
        }
        setError(data.error ?? `HTTP ${res.status}`);
        setPhase('error');
        return;
      }
      setApproved({
        revisionId: data.revisionId,
        version: typeof data.version === 'number' ? data.version : null,
        teamId: data.teamId,
        paths: data.paths,
        exportedPaths: data.exportedPaths,
      });
      setPhase('approved');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  }

  async function reject() {
    if (!proposal) {
      setPhase('rejected');
      return;
    }
    setPhase('rejecting');
    setError(null);
    try {
      await fetch(`/api/runs/${runId}/revision`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'reject', baseRevisionId: proposal.baseRevisionId }),
      });
      setProposal(null);
      setPhase('rejected');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  }

  const showProposeButton = phase === 'idle' || phase === 'error' || phase === 'proposing';
  const showDecision = proposal && (phase === 'proposed' || phase === 'approving' || phase === 'rejecting');

  return (
    <section className="space-y-4 rounded-lg border border-current/15 p-5">
      <div className="space-y-1">
        <h2 className="text-base font-medium">Team improvement</h2>
        <p className="text-sm opacity-65">
          Ask the Lead to suggest improvements from your feedback. Changes apply only when you approve.
        </p>
      </div>

      {phase === 'approved' ? (
        <div className="space-y-3 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-200">
          <p>Approved. Team revision v{approved?.version ?? '?'} is now active.</p>
          {approved?.revisionId || approved?.teamId ? (
            <dl className="grid gap-2 text-xs sm:grid-cols-2">
              {approved.revisionId ? (
                <div>
                  <dt className="opacity-60">Revision ID</dt>
                  <dd className="font-mono">{approved.revisionId}</dd>
                </div>
              ) : null}
              {approved.teamId ? (
                <div>
                  <dt className="opacity-60">Team ID</dt>
                  <dd className="font-mono">{approved.teamId}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
          {approved?.paths ? (
            <div className="space-y-1 text-xs">
              <p className="opacity-70">Updated team files:</p>
              <ul className="list-inside list-disc font-mono">
                <li>{approved.paths.agentsMd}</li>
                <li>{approved.paths.teamJson}</li>
              </ul>
              {approved.exportedPaths?.length === 0 ? (
                <p className="text-amber-700 dark:text-amber-300">
                  The DB revision is active. File export did not report written files.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : phase === 'rejected' ? (
        <p className="rounded-md border border-current/15 p-3 text-sm opacity-75">
          Proposal rejected. The team is unchanged.
        </p>
      ) : (
        <>
          {showProposeButton ? (
            <button
              type="button"
              onClick={propose}
              disabled={phase === 'proposing'}
              className="rounded-md border border-current/30 px-4 py-2 text-sm font-medium hover:bg-current/5 disabled:opacity-40"
            >
              {phase === 'proposing' ? 'Asking the Lead…' : 'Get improvement suggestions'}
            </button>
          ) : null}

          {proposal && phase !== 'idle' ? (
            <RevisionDiff
              rationale={proposal.rationale}
              diff={proposal.diff}
              summary={proposal.summary}
              counts={proposal.counts}
            />
          ) : null}

          {showDecision ? (
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={approve}
                disabled={phase !== 'proposed'}
                className="rounded-md border border-emerald-600/40 bg-emerald-600/10 px-4 py-2 text-sm font-medium text-emerald-800 hover:bg-emerald-600/20 disabled:opacity-40"
              >
                {phase === 'approving' ? 'Approving…' : 'Approve & create revision'}
              </button>
              <button
                type="button"
                onClick={reject}
                disabled={phase !== 'proposed'}
                className="rounded-md border border-current/30 px-4 py-2 text-sm font-medium hover:bg-current/5 disabled:opacity-40"
              >
                {phase === 'rejecting' ? 'Rejecting…' : 'Reject'}
              </button>
            </div>
          ) : null}
        </>
      )}

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
    </section>
  );
}
