import { notFound } from 'next/navigation';

import { prisma } from '@db/client';

import { QaFlow } from '@/components/qa/QaFlow';
import { RunContextHeader } from '@/components/run/RunContextHeader';

import { resolveProviderName } from '@lib/models/catalog';
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

  // Look up the PO model's provider so QaFlow can show the Local-models
  // latency hint. Best-effort: if the row is missing or the provider isn't
  // one we recognise, the hint is simply hidden.
  const run = await prisma.run.findUnique({
    where: { id: session.runId },
    select: { poModelId: true, prompt: true, status: true },
  });
  let poProvider: 'openai' | 'anthropic' | 'google' | 'ollama' | null = null;
  if (run?.poModelId) {
    const model = await prisma.modelCatalog.findUnique({
      where: { modelId: run.poModelId },
      select: { provider: true },
    });
    poProvider = model ? resolveProviderName(model.provider) : null;
  }

  return (
    <section className="space-y-6">
      <RunContextHeader
        title={`Run ${session.runId.slice(0, 12)}...`}
        prompt={run?.prompt ?? ''}
        status={run?.status ?? session.status}
      />
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">PO Q&A</h1>
        <p className="text-sm opacity-70">
          Answer 5–6 questions. Pick one of the four substantive choices, ask the AI to
          auto-judge, type your own, or skip (which uses auto-judge).
        </p>
      </div>
      <QaFlow initial={session} poProvider={poProvider} />
    </section>
  );
}
