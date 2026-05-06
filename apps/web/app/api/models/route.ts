import { NextResponse } from 'next/server';

import { getAvailabilityMap, listModels } from '@lib/models/catalog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const [models, availability] = await Promise.all([listModels(), getAvailabilityMap()]);
  return NextResponse.json({ models, availability });
}
