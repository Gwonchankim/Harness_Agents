import { NextResponse } from 'next/server';

import { deleteSecret, isAllowedSecretName } from '@lib/secrets/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ name: string }> },
) {
  const { name } = await context.params;
  if (!isAllowedSecretName(name)) {
    return NextResponse.json({ error: 'unknown_secret_name' }, { status: 400 });
  }
  await deleteSecret(name);
  return NextResponse.json({ ok: true });
}
