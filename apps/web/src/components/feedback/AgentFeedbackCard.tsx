'use client';

import { RatingInput } from './RatingInput';

export interface AgentCardData {
  id: string;
  name: string;
  role: string;
  isLead: boolean;
  tasks: Array<{ taskKey: string; title: string; status: string; text: string }>;
}

interface Props {
  agent: AgentCardData;
  rating: number | null;
  comment: string;
  onRating: (n: number) => void;
  onComment: (s: string) => void;
  disabled?: boolean;
}

export function AgentFeedbackCard({
  agent,
  rating,
  comment,
  onRating,
  onComment,
  disabled,
}: Props) {
  return (
    <li className="grid grid-cols-1 gap-4 rounded-lg border border-current/15 p-4 md:grid-cols-2">
      {/* Left: what the agent did */}
      <div className="min-w-0 space-y-2">
        <div>
          <div className="font-medium">
            {agent.name}
            {agent.isLead ? ' (Lead)' : ''}
          </div>
          <div className="text-xs opacity-65">{agent.role}</div>
        </div>
        {agent.tasks.length === 0 ? (
          <p className="text-xs opacity-60">No tasks were assigned to this agent.</p>
        ) : (
          <ul className="space-y-2">
            {agent.tasks.map((t) => (
              <li key={t.taskKey} className="rounded-md border border-current/10 bg-current/5 p-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-[11px] opacity-70">{t.taskKey}</span>
                  <span className="text-[11px] opacity-60">{t.status}</span>
                </div>
                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-xs leading-5">
                  {t.text || '(no output)'}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Right: feedback input */}
      <div className="space-y-3">
        <div className="space-y-1">
          <span className="block text-sm font-medium">Score</span>
          <RatingInput
            value={rating}
            onChange={onRating}
            disabled={disabled}
            ariaLabel={`Rating for ${agent.name}`}
          />
        </div>
        <div className="space-y-1">
          <label htmlFor={`agent-comment-${agent.id}`} className="block text-sm font-medium">
            Comment <span className="opacity-50">(optional)</span>
          </label>
          <textarea
            id={`agent-comment-${agent.id}`}
            value={comment}
            onChange={(e) => onComment(e.target.value)}
            disabled={disabled}
            rows={4}
            maxLength={4000}
            className="w-full rounded-md border border-current/20 bg-transparent px-3 py-2 text-sm outline-none focus:border-current/50 disabled:opacity-50"
            placeholder="How did this agent do?"
          />
        </div>
      </div>
    </li>
  );
}
