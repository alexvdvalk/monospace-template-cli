/**
 * Deterministic UUIDv5 generation.
 *
 * Every id the CLI writes — collections, fields, indexes, relations, seed rows —
 * is derived from a stable path string under a fixed namespace. Reruns therefore
 * produce byte-identical ids rather than merely equivalent structures.
 */

/** Fixed namespace UUID for this CLI. Never change it: ids derive from it. */
const NAMESPACE = 'b7a1f0c2-5d43-4e8a-9f16-2c8d4e7a1b30';

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const NAMESPACE_BYTES = uuidToBytes(NAMESPACE);

/** UUIDv5 (SHA-1 based) of `path` under the CLI namespace. */
export function uuid5(path: string): string {
  const name = new TextEncoder().encode(path);
  const input = new Uint8Array(NAMESPACE_BYTES.length + name.length);
  input.set(NAMESPACE_BYTES, 0);
  input.set(name, NAMESPACE_BYTES.length);

  const hash = new Uint8Array(new Bun.CryptoHasher('sha1').update(input).digest().buffer).slice(0, 16);
  hash[6] = (hash[6]! & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8]! & 0x3f) | 0x80; // RFC 4122 variant

  const hex = [...hash].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** `id('issue-tracker', 'collection', 'issues')` → stable uuid for that object. */
export function id(...parts: (string | number)[]): string {
  return uuid5(parts.join('/'));
}
