/**
 * Avatar storage. Uploads are validated by magic bytes (not the declared
 * MIME type), size-limited, decoded and re-encoded by sharp to a 512×512
 * WebP. Re-encoding strips EXIF/GPS metadata and any embedded payloads.
 * Files live outside /public and are served only to logged-in members.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { env } from "@/lib/env";
import { DomainError } from "@/lib/errors";

export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const KEY_RE = /^[0-9a-f-]{36}\.webp$/;

function sniff(buf: Buffer): "jpeg" | "png" | "webp" | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "webp";
  return null;
}

const dir = () => path.resolve(env().UPLOAD_DIR);

export async function processAvatar(bytes: Buffer): Promise<string> {
  if (bytes.length === 0) throw new DomainError("VALIDATION", "Filen er tom.");
  if (bytes.length > MAX_AVATAR_BYTES) throw new DomainError("VALIDATION", "Billedet må højst være 5 MB.");
  if (!sniff(bytes)) throw new DomainError("VALIDATION", "Kun JPG-, PNG- og WebP-billeder er tilladt.");
  let out: Buffer;
  try {
    out = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: "error" })
      .rotate()
      .resize(512, 512, { fit: "cover", position: "attention" })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    throw new DomainError("VALIDATION", "Billedet kunne ikke læses. Prøv et andet.");
  }
  const key = `${randomUUID()}.webp`;
  await mkdir(dir(), { recursive: true });
  await writeFile(path.join(dir(), key), out, { mode: 0o640 });
  return key;
}

export async function readAvatar(key: string): Promise<Buffer | null> {
  if (!KEY_RE.test(key)) return null; // also prevents path traversal
  try {
    return await readFile(path.join(dir(), key));
  } catch {
    return null;
  }
}

export async function deleteAvatarFile(key: string) {
  if (!KEY_RE.test(key)) return;
  await unlink(path.join(dir(), key)).catch(() => undefined);
}
