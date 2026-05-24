'use client';

import { RUN_STATUS_FILTERS } from '@lib/runs/list';

interface Props {
  status: string;
  q: string;
}

const STATUS_LABELS: Record<string, string> = {
  all: 'All statuses',
  po_qa: 'Q&A',
  ready: 'Ready',
  planning: 'Planning',
  running: 'Running',
  succeeded: 'Succeeded',
  failed: 'Failed',
};

// Plain GET form so filtering works server-side via searchParams — no client
// router state, no typedRoutes friction. The status select auto-submits.
export function RunFilterBar({ status, q }: Props) {
  return (
    <form method="get" action="/runs" className="flex flex-wrap items-end gap-3">
      <label className="flex flex-col gap-1 text-xs">
        <span className="opacity-65">Status</span>
        <select
          name="status"
          defaultValue={status}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="rounded-md border border-current/20 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-current/50"
        >
          {RUN_STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s] ?? s}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-1 flex-col gap-1 text-xs">
        <span className="opacity-65">Search prompt</span>
        <input
          name="q"
          defaultValue={q}
          placeholder="Search by prompt text…"
          className="w-full rounded-md border border-current/20 bg-transparent px-3 py-1.5 text-sm outline-none focus:border-current/50"
        />
      </label>
      <button
        type="submit"
        className="rounded-md border border-current/30 px-4 py-1.5 text-sm font-medium hover:bg-current/5"
      >
        Apply
      </button>
    </form>
  );
}
