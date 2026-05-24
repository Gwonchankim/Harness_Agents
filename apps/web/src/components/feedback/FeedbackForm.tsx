'use client';

import { useState } from 'react';

import type { AgentCardData } from './AgentFeedbackCard';
import { AgentFeedbackGrid } from './AgentFeedbackGrid';
import { ResultFeedback } from './ResultFeedback';
import { RevisionReview } from './RevisionReview';

interface Props {
  runId: string;
  resultMarkdown: string | null;
  agents: AgentCardData[];
}

type AgentState = Record<string, { rating: number | null; comment: string }>;

export function FeedbackForm({ runId, resultMarkdown, agents }: Props) {
  const [resultRating, setResultRating] = useState<number | null>(null);
  const [resultComment, setResultComment] = useState('');
  const [agentState, setAgentState] = useState<AgentState>(() =>
    Object.fromEntries(agents.map((a) => [a.id, { rating: null, comment: '' }])),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const canSubmit =
    resultRating != null ||
    resultComment.trim().length > 0 ||
    agents.some((a) => agentState[a.id]?.rating != null);

  function setAgentRating(id: string, n: number) {
    setAgentState((prev) => ({
      ...prev,
      [id]: { rating: n, comment: prev[id]?.comment ?? '' },
    }));
  }
  function setAgentComment(id: string, s: string) {
    setAgentState((prev) => ({
      ...prev,
      [id]: { rating: prev[id]?.rating ?? null, comment: s },
    }));
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      // Agent feedback rows require a rating; comment-only entries are dropped.
      const agentFeedback = agents.flatMap((a) => {
        const s = agentState[a.id];
        if (!s || s.rating == null) return [];
        return [{ agentId: a.id, rating: s.rating, comment: s.comment.trim() || null }];
      });
      const res = await fetch(`/api/runs/${runId}/feedback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          resultRating,
          resultComment: resultComment.trim() || null,
          agentFeedback,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setSubmitted(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="space-y-6">
        <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700">
          Feedback saved. You can now ask the Lead for team improvements.
        </p>
        <RevisionReview runId={runId} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <ResultFeedback
        markdown={resultMarkdown}
        rating={resultRating}
        comment={resultComment}
        onRating={setResultRating}
        onComment={setResultComment}
        disabled={submitting}
      />

      <AgentFeedbackGrid
        agents={agents}
        ratings={agentState}
        onRating={setAgentRating}
        onComment={setAgentComment}
        disabled={submitting}
      />

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={submitting || !canSubmit}
          className="rounded-md border border-current/30 px-4 py-2 text-sm font-medium hover:bg-current/5 disabled:opacity-40"
        >
          {submitting ? 'Submitting…' : 'Submit feedback'}
        </button>
        {!canSubmit ? (
          <span className="text-xs opacity-55">Add a result score or rate at least one agent.</span>
        ) : null}
        {error ? <span className="text-sm text-rose-600">{error}</span> : null}
      </div>
    </div>
  );
}
