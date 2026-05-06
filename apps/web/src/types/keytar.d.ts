// Ambient shim for keytar so TypeScript builds even when the optional native
// module isn't installed. The real module exports the same surface; we type
// only what the secret store touches.
declare module 'keytar' {
  export function getPassword(service: string, account: string): Promise<string | null>;
  export function setPassword(service: string, account: string, password: string): Promise<void>;
  export function deletePassword(service: string, account: string): Promise<boolean>;
  export function findCredentials(
    service: string,
  ): Promise<Array<{ account: string; password: string }>>;
}
