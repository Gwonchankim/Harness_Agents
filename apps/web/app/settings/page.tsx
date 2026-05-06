import { prisma } from '@db/client';

import { AvailabilityBadges } from '@/components/settings/AvailabilityBadges';
import { SecretsEditor } from '@/components/settings/SecretsEditor';

import { getStorageBackend, listSecrets } from '@lib/secrets/store';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const [models, secrets, backend] = await Promise.all([
    prisma.modelCatalog.findMany({
      orderBy: [{ provider: 'asc' }, { modelId: 'asc' }],
    }),
    listSecrets(),
    getStorageBackend(),
  ]);

  const grouped = new Map<string, typeof models>();
  for (const model of models) {
    const list = grouped.get(model.provider) ?? [];
    list.push(model);
    grouped.set(model.provider, list);
  }

  return (
    <section className="space-y-10">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm opacity-70">
          Local-first single-user MVP. Provider keys, when set, take precedence over
          environment variables. Catalog rows are seeded from <code>models.json</code>.
        </p>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide opacity-60">
          Provider keys
        </h2>
        <SecretsEditor initial={secrets} backend={backend} />
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide opacity-60">
          Provider availability
        </h2>
        <AvailabilityBadges />
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-medium uppercase tracking-wide opacity-60">
          Model catalog
        </h2>
        {grouped.size === 0 ? (
          <p className="rounded-md border border-current/15 p-4 text-sm opacity-70">
            No models found. Run <code>pnpm db:seed</code>.
          </p>
        ) : (
          <div className="space-y-6">
            {Array.from(grouped.entries()).map(([provider, providerModels]) => (
              <div key={provider} className="space-y-3">
                <h3 className="text-xs font-medium uppercase tracking-wide opacity-50">
                  {provider}
                </h3>
                <ul className="divide-y divide-current/10 rounded-lg border border-current/15">
                  {providerModels.map((m) => (
                    <li
                      key={m.id}
                      className="flex flex-col gap-2 p-4 text-sm sm:flex-row sm:items-start"
                    >
                      <div className="flex-1">
                        <div className="flex flex-wrap items-center gap-2 font-medium">
                          <span>{m.displayName}</span>
                          {m.isDefault ? (
                            <span className="rounded-full bg-current/10 px-2 py-0.5 text-xs">
                              default
                            </span>
                          ) : null}
                          <span className="rounded-full border border-current/20 px-2 py-0.5 text-xs opacity-70">
                            {m.endpointType}
                          </span>
                        </div>
                        <div className="mt-0.5 text-xs opacity-60">{m.modelId}</div>
                        {m.recommendedUse ? (
                          <p className="mt-1 max-w-xl text-xs opacity-70">
                            {m.recommendedUse}
                          </p>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap items-start gap-2 text-right text-xs opacity-70">
                        <div className="rounded-md border border-current/15 px-2 py-1">
                          cost: {m.costTier}
                        </div>
                        <div className="rounded-md border border-current/15 px-2 py-1">
                          speed: {m.speedTier}
                        </div>
                        <div className="rounded-md border border-current/15 px-2 py-1">
                          ctx: {m.contextWindow ?? '—'}
                        </div>
                        <div className="rounded-md border border-current/15 px-2 py-1">
                          out: {m.maxOutputTokens ?? '—'}
                        </div>
                        <div
                          className={`rounded-full px-2 py-1 text-xs ${
                            m.enabled ? 'bg-emerald-500/15' : 'bg-rose-500/15'
                          }`}
                        >
                          {m.enabled ? 'enabled' : 'disabled'}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
