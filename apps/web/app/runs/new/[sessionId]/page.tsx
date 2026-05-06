import { notFound } from 'next/navigation';

import { QaFlow } from '@/components/qa/QaFlow';

import { loadSession } from '@lib/qa/sessionState';

export const dynamic = 'force-dynamic';

export default async function QaSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  const session = await loadSession(sessionId);
  if (!session) notFound();
  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">PO Q&A</h1>
        <p className="text-sm opacity-70">
          Answer 5–6 questions. Pick one of the four substantive choices, ask the AI to
          auto-judge, type your own, or skip (which uses auto-judge).
        </p>
      </div>
      <QaFlow initial={session} />
    </section>
  );
}
