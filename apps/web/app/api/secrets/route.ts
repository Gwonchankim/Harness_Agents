import { NextResponse } from 'next/server';

import {
  getStorageBackend,
  isAllowedSecretName,
  listSecrets,
  setSecret,
} from '@lib/secrets/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const [secrets, backend] = await Promise.all([listSecrets(), getStorageBackend()]);
  return NextResponse.json({ secrets, backend });
}

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
  const { name, value } = body as { name?: unknown; value?: unknown };
  if (typeof name !== 'string' || !isAllowedSecretName(name)) {
    return NextResponse.json({ error: 'unknown_secret_name' }, { status: 400 });
  }
  if (typeof value !== 'string' || value.length === 0) {
    return NextResponse.json({ error: 'value_required' }, { status: 400 });
  }
  try {
    const result = await setSecret(name, value);
    return NextResponse.json({ ok: true, storage: result.storage });
  } catch (err) {
    return NextResponse.json(
      { error: 'set_failed', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
