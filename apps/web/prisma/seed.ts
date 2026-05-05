import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

interface ModelDefinition {
  modelId: string;
  displayName: string;
  provider: 'openai' | 'anthropic' | 'ollama' | string;
  endpointType?: string;
  costTier?: 'free' | 'low' | 'standard' | 'premium' | string;
  speedTier?: 'fast' | 'standard' | 'slow' | string;
  recommendedUse?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  supportsTools?: boolean;
  default?: boolean;
  enabled?: boolean;
}

interface ModelsManifest {
  version: number;
  models: ModelDefinition[];
}

const prisma = new PrismaClient();

async function seedDefaultProject() {
  const project = await prisma.project.upsert({
    where: { slug: 'default' },
    update: {},
    create: {
      slug: 'default',
      name: 'Default Project',
      description:
        'Auto-created default project. New runs land here unless another project is selected.',
      isDefault: true,
    },
  });
  console.log(`[seed] default project: ${project.id}`);
}

async function seedModelCatalog() {
  const manifestPath = resolve(__dirname, '../../../models.json');
  const raw = readFileSync(manifestPath, 'utf-8');
  const manifest = JSON.parse(raw) as ModelsManifest;

  for (const model of manifest.models) {
    const data = {
      modelId: model.modelId,
      displayName: model.displayName,
      provider: model.provider,
      endpointType: model.endpointType ?? 'openai-compat',
      costTier: model.costTier ?? 'standard',
      speedTier: model.speedTier ?? 'standard',
      enabled: model.enabled ?? true,
      recommendedUse: model.recommendedUse ?? null,
      contextWindow: model.contextWindow ?? null,
      maxOutputTokens: model.maxOutputTokens ?? null,
      supportsTools: model.supportsTools ?? true,
      isDefault: model.default ?? false,
    };

    await prisma.modelCatalog.upsert({
      where: { modelId: model.modelId },
      update: data,
      create: data,
    });
  }
  console.log(`[seed] model catalog: ${manifest.models.length} rows`);
}

async function main() {
  await seedDefaultProject();
  await seedModelCatalog();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
