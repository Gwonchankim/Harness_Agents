'use client';

// Phase 3 stub. The full two-revision diff lives in Phase 5; for now we just
// preview the AGENTS.md content in a code block.

interface Props {
  agentsMd: string;
}

export function RevisionDiffViewer({ agentsMd }: Props) {
  if (!agentsMd) {
    return <p className="text-xs opacity-60">No preview available.</p>;
  }
  return (
    <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-lg border border-current/15 bg-current/5 p-4 text-xs leading-relaxed">
      {agentsMd}
    </pre>
  );
}
