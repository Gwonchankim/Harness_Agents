// Secret store — keytar primary, AES-GCM fallback (env key, then local key
// file). Read precedence for getSecret():
//   1. SecretStore row (decrypted via its declared backend)
//   2. process.env[name]   ← .env / .env.local already loaded by Next
//   3. undefined
//
// Storage backends, in setSecret() preference order:
//   1. keytar (OS keychain) — best, optional native module
//   2. sqlite-aes-gcm — AES-256-GCM, key from HARNESS_SECRET_FALLBACK_KEY,
//      else loaded/generated at apps/web/.local/secret.key
//
// The fallback is local obfuscation, not strong security. Documented in
// README and PHASE_LOG.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { prisma } from '@db/client';
import { registerKnownSecret } from '@lib/secrets/redactor';

const SERVICE = 'harness-agents';

const ALLOWED_NAMES = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'OLLAMA_BASE_URL',
] as const;
export type SecretName = (typeof ALLOWED_NAMES)[number];

export function isAllowedSecretName(name: string): name is SecretName {
  return (ALLOWED_NAMES as readonly string[]).includes(name);
}

export const SECRET_NAME_TO_PROVIDER: Record<SecretName, string> = {
  OPENAI_API_KEY: 'openai',
  ANTHROPIC_API_KEY: 'anthropic',
  GOOGLE_GENERATIVE_AI_API_KEY: 'google',
  OLLAMA_BASE_URL: 'ollama',
};

export type SecretStorage = 'keytar' | 'sqlite-aes-gcm';
export type StorageBackend = 'keytar' | 'sqlite-aes-gcm' | 'env-only';

export interface SecretInfo {
  name: SecretName;
  provider: string;
  storage: SecretStorage | 'env';
  hasValue: boolean;
  masked: string;
  updatedAt: Date | null;
}

// ----------------------------------------------------------------------------
// keytar (optional native module)
// ----------------------------------------------------------------------------

type KeytarModule = typeof import('keytar');
let keytarCache: KeytarModule | null | 'unavailable' = null;

async function getKeytar(): Promise<KeytarModule | null> {
  if (keytarCache === 'unavailable') return null;
  if (keytarCache) return keytarCache;
  try {
    // The string-typed specifier prevents TS from resolving the package at
    // build time; the ambient shim in src/types/keytar.d.ts handles types.
    // The magic comment tells Turbopack/webpack to skip the optional native
    // module so a missing dep doesn't print a build-time warning.
    const moduleName = 'keytar';
    const mod = (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ moduleName).catch(
      () => null,
    )) as KeytarModule | null;
    if (!mod || typeof mod.getPassword !== 'function') {
      keytarCache = 'unavailable';
      return null;
    }
    keytarCache = mod;
    return mod;
  } catch {
    keytarCache = 'unavailable';
    return null;
  }
}

// ----------------------------------------------------------------------------
// AES-GCM fallback key resolution
// ----------------------------------------------------------------------------

const LOCAL_KEY_PATH = resolve(process.cwd(), '.local', 'secret.key');

let cachedFallbackKey: { source: 'env' | 'file'; key: Buffer } | null = null;

function deriveKeyFromString(raw: string): Buffer {
  const trimmed = raw.trim();
  if (/^[A-Za-z0-9+/=_-]+$/.test(trimmed)) {
    try {
      const buf = Buffer.from(trimmed, 'base64');
      if (buf.length === 32) return buf;
    } catch {
      /* fall through to hash */
    }
  }
  return createHash('sha256').update(trimmed).digest();
}

async function loadOrGenerateLocalKey(): Promise<Buffer> {
  try {
    const existing = await readFile(LOCAL_KEY_PATH, 'utf8');
    const buf = Buffer.from(existing.trim(), 'base64');
    if (buf.length === 32) return buf;
  } catch {
    /* fall through to generate */
  }
  const fresh = randomBytes(32);
  await mkdir(dirname(LOCAL_KEY_PATH), { recursive: true });
  await writeFile(LOCAL_KEY_PATH, fresh.toString('base64') + '\n', { encoding: 'utf8' });
  try {
    await chmod(LOCAL_KEY_PATH, 0o600);
  } catch {
    /* chmod is a no-op on Windows; ignore */
  }
  return fresh;
}

async function getFallbackKey(): Promise<{ source: 'env' | 'file'; key: Buffer }> {
  if (cachedFallbackKey) return cachedFallbackKey;
  const envRaw = process.env.HARNESS_SECRET_FALLBACK_KEY?.trim();
  if (envRaw && envRaw.length > 0) {
    cachedFallbackKey = { source: 'env', key: deriveKeyFromString(envRaw) };
    return cachedFallbackKey;
  }
  const fileKey = await loadOrGenerateLocalKey();
  cachedFallbackKey = { source: 'file', key: fileKey };
  return cachedFallbackKey;
}

// ----------------------------------------------------------------------------
// AES-GCM encrypt / decrypt
// ----------------------------------------------------------------------------

function encryptAesGcm(key: Buffer, plaintext: string): { encrypted: string; iv: string; tag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    encrypted: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

function decryptAesGcm(
  key: Buffer,
  encrypted: string,
  iv: string,
  tag: string,
): string {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

// ----------------------------------------------------------------------------
// Public API
// ----------------------------------------------------------------------------

/** Returns the storage backend that setSecret() will currently use. */
export async function getStorageBackend(): Promise<StorageBackend> {
  const keytar = await getKeytar();
  if (keytar) return 'keytar';
  return 'sqlite-aes-gcm';
}

/** Read a secret. DB row first, then process.env, then undefined. */
export async function getSecret(name: SecretName): Promise<string | undefined> {
  const row = await prisma.secretStore.findUnique({ where: { name } });
  if (row) {
    const decrypted = await readSecretFromRow(row);
    if (decrypted != null) {
      registerKnownSecret(decrypted);
      return decrypted;
    }
  }
  const fromEnv = process.env[name]?.trim();
  if (fromEnv && fromEnv.length > 0) {
    registerKnownSecret(fromEnv);
    return fromEnv;
  }
  return undefined;
}

async function readSecretFromRow(
  row: {
    storage: string;
    keyRef: string;
    encrypted: string | null;
    iv: string | null;
    tag: string | null;
  },
): Promise<string | null> {
  if (row.storage === 'keytar') {
    const keytar = await getKeytar();
    if (!keytar) return null;
    return await keytar.getPassword(SERVICE, row.keyRef);
  }
  if (row.storage === 'sqlite-aes-gcm') {
    if (!row.encrypted || !row.iv || !row.tag) return null;
    const fallback = await getFallbackKey();
    return decryptAesGcm(fallback.key, row.encrypted, row.iv, row.tag);
  }
  return null;
}

/**
 * Persist a secret. Tries keytar first, then AES-GCM fallback. Never throws
 * for "no fallback available" — the env-key OR local key-file path is always
 * resolvable on a writable filesystem.
 */
export async function setSecret(name: SecretName, value: string): Promise<{ storage: SecretStorage }> {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('setSecret: value must be a non-empty string');
  }
  const provider = SECRET_NAME_TO_PROVIDER[name];

  const keytar = await getKeytar();
  if (keytar) {
    try {
      await keytar.setPassword(SERVICE, name, value);
      await prisma.secretStore.upsert({
        where: { name },
        update: { provider, storage: 'keytar', keyRef: name, encrypted: null, iv: null, tag: null },
        create: { name, provider, storage: 'keytar', keyRef: name },
      });
      registerKnownSecret(value);
      return { storage: 'keytar' };
    } catch {
      // fall through to AES-GCM
    }
  }

  const fallback = await getFallbackKey();
  const enc = encryptAesGcm(fallback.key, value);
  await prisma.secretStore.upsert({
    where: { name },
    update: {
      provider,
      storage: 'sqlite-aes-gcm',
      keyRef: fallback.source,
      encrypted: enc.encrypted,
      iv: enc.iv,
      tag: enc.tag,
    },
    create: {
      name,
      provider,
      storage: 'sqlite-aes-gcm',
      keyRef: fallback.source,
      encrypted: enc.encrypted,
      iv: enc.iv,
      tag: enc.tag,
    },
  });
  registerKnownSecret(value);
  return { storage: 'sqlite-aes-gcm' };
}

/** Remove a secret from both keytar (if present) and the SecretStore row. */
export async function deleteSecret(name: SecretName): Promise<void> {
  const row = await prisma.secretStore.findUnique({ where: { name } });
  if (row?.storage === 'keytar') {
    const keytar = await getKeytar();
    if (keytar) {
      try {
        await keytar.deletePassword(SERVICE, row.keyRef);
      } catch {
        /* best-effort */
      }
    }
  }
  await prisma.secretStore.deleteMany({ where: { name } });
}

/** Return masked metadata for every allowed secret, including unset ones. */
export async function listSecrets(): Promise<SecretInfo[]> {
  const rows = await prisma.secretStore.findMany({
    where: { name: { in: ALLOWED_NAMES as unknown as string[] } },
  });
  const byName = new Map(rows.map((r) => [r.name, r]));

  const result: SecretInfo[] = [];
  for (const name of ALLOWED_NAMES) {
    const row = byName.get(name);
    if (row) {
      const plaintext = await readSecretFromRow(row);
      if (plaintext) {
        registerKnownSecret(plaintext);
        result.push({
          name,
          provider: row.provider,
          storage: row.storage as SecretStorage,
          hasValue: true,
          masked: maskValue(plaintext),
          updatedAt: row.updatedAt,
        });
        continue;
      }
    }
    const fromEnv = process.env[name]?.trim();
    if (fromEnv) {
      registerKnownSecret(fromEnv);
      result.push({
        name,
        provider: SECRET_NAME_TO_PROVIDER[name],
        storage: 'env',
        hasValue: true,
        masked: maskValue(fromEnv),
        updatedAt: null,
      });
      continue;
    }
    result.push({
      name,
      provider: SECRET_NAME_TO_PROVIDER[name],
      storage: row ? (row.storage as SecretStorage) : 'env',
      hasValue: false,
      masked: '',
      updatedAt: row?.updatedAt ?? null,
    });
  }
  return result;
}

function maskValue(value: string): string {
  if (value.length <= 8) return '••••••••';
  const head = value.slice(0, 4);
  const tail = value.slice(-4);
  return `${head}••••${tail}`;
}
