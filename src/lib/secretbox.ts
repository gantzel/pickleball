/**
 * Small authenticated encryption helper for secrets we must keep at rest
 * (members' read-only DUPR tokens). AES-256-GCM with a key derived from
 * BETTER_AUTH_SECRET via HKDF, so no extra secret has to be configured.
 * Format: v1.<iv>.<tag>.<ciphertext>, all base64url.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";
import { env } from "./env";

const key = () => Buffer.from(hkdfSync("sha256", env().BETTER_AUTH_SECRET, "pbk-secretbox", "dupr-tokens-v1", 32));

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

/** Returns null for anything that doesn't decrypt (tampered, other key, malformed). */
export function open(sealed: string | null | undefined): string | null {
  if (!sealed) return null;
  const [v, iv, tag, data] = sealed.split(".");
  if (v !== "v1" || !iv || !tag || data === undefined) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}
