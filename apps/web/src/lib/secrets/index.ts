export {
  isAllowedSecretName,
  getStorageBackend,
  getSecret,
  setSecret,
  deleteSecret,
  listSecrets,
  SECRET_NAME_TO_PROVIDER,
} from './store';
export type { SecretName, SecretInfo, SecretStorage, StorageBackend } from './store';
export { redact, redactString, registerKnownSecret } from './redactor';

// Public list of secret names. Mirrors the constant inside store.ts but is
// exported here for client-side type-safe option building.
export const ALLOWED_NAMES_HINT = [
  'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'OLLAMA_BASE_URL',
] as const;
