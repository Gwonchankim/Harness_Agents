import { NewRunForm } from '@/components/runs/NewRunForm';

import { listEnabledModels } from '@lib/models/catalog';

export const dynamic = 'force-dynamic';

export default async function NewRunPage() {
  const models = await listEnabledModels();
  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">New run</h1>
        <p className="text-sm opacity-70">
          Describe what you want done. The PO Agent will ask 5–6 clarification questions,
          then later phases compose a team and run a DAG against your answers.
        </p>
      </div>
      <NewRunForm
        models={models.map((m) => ({
          modelId: m.modelId,
          displayName: m.displayName,
          provider: m.provider,
          recommendedUse: m.recommendedUse,
          isDefault: m.isDefault,
        }))}
      />
    </section>
  );
}
