import { NextResponse } from 'next/server';

import { invalidateProviderAvailability } from '@lib/models/catalog';
import {
  deleteSecret,
  isAllowedSecretName,
  SECRET_NAME_TO_PROVIDER,
} from '@lib/secrets/store';

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
  invalidateProviderAvailability(SECRET_NAME_TO_PROVIDER[name]);
  return NextResponse.json({ ok: true });
}
