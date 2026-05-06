import { NextResponse } from 'next/server';

import { prisma } from '@db/client';

import { getEnabledModelOrThrow, ModelDisabledError } from '@lib/models/catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'invalid_body' }, { status: 400 });
  }
  const { prompt, modelId } = body as { prompt?: unknown; modelId?: unknown };

  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    return NextResponse.json({ error: 'prompt_required' }, { status: 400 });
  }
  if (typeof modelId !== 'string' || modelId.length === 0) {
    return NextResponse.json({ error: 'modelId_required' }, { status: 400 });
  }

  try {
    await getEnabledModelOrThrow(modelId);
  } catch (err) {
    if (err instanceof ModelDisabledError) {
      return NextResponse.json({ error: 'model_disabled' }, { status: 400 });
    }
    return NextResponse.json({ error: 'unknown_model' }, { status: 400 });
  }

  const project = await prisma.project.findFirst({ where: { isDefault: true } });
  if (!project) {
    return NextResponse.json({ error: 'default_project_missing' }, { status: 500 });
  }

  const created = await prisma.$transaction(async (tx) => {
    const run = await tx.run.create({
      data: {
        projectId: project.id,
        prompt: prompt.trim(),
        status: 'po_qa',
        poModelId: modelId,
      },
      select: { id: true },
    });
    const session = await tx.qaSession.create({
      data: { runId: run.id, status: 'active' },
      select: { id: true },
    });
    return { runId: run.id, sessionId: session.id };
  });

  return NextResponse.json(created, { status: 201 });
}
