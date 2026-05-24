'use client';

import { AgentFeedbackCard, type AgentCardData } from './AgentFeedbackCard';

interface Props {
  agents: AgentCardData[];
  ratings: Record<string, { rating: number | null; comment: string }>;
  onRating: (agentId: string, n: number) => void;
  onComment: (agentId: string, s: string) => void;
  disabled?: boolean;
}

export function AgentFeedbackGrid({ agents, ratings, onRating, onComment, disabled }: Props) {
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h2 className="text-base font-medium">Agent feedback</h2>
        <p className="text-sm opacity-65">Left: what each agent did. Right: your rating.</p>
      </div>
      <ul className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {agents.map((a) => {
          const fb = ratings[a.id] ?? { rating: null, comment: '' };
          return (
            <AgentFeedbackCard
              key={a.id}
              agent={a}
              rating={fb.rating}
              comment={fb.comment}
              onRating={(n) => onRating(a.id, n)}
              onComment={(s) => onComment(a.id, s)}
              disabled={disabled}
            />
          );
        })}
      </ul>
    </section>
  );
}
