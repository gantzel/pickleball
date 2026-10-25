/**
 * File storage boundary. Three drivers, chosen by STORAGE_DRIVER:
 *  - "db":    the app's own PostgreSQL database (table stored_file). No extra
 *             provider; photos move with pg_dump. Fine for small images.
 *  - "local": a directory on disk (UPLOAD_DIR). Needs a persistent disk.
 *  - "s3":    any S3-compatible object store (Cloudflare R2, AWS S3,
 *             Backblaze B2, Scaleway, MinIO…). Moving provider = new env vars.
 * The bucket stays private: files are always served through the app, which
 * checks that the viewer is logged in.
 */
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { Pool } from "pg";
import { env } from "@/lib/env";

export interface FileStorage {
  name: "local" | "s3" | "db";
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  /** null when the file doesn't exist */
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

export interface S3Config {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}

export function localStorage(root: string): FileStorage {
  const abs = (key: string) => path.join(path.resolve(root), key);
  return {
    name: "local",
    async put(key, body) {
      await mkdir(path.dirname(abs(key)), { recursive: true });
      await writeFile(abs(key), body, { mode: 0o640 });
    },
    async get(key) {
      try {
        return await readFile(abs(key));
      } catch {
        return null;
      }
    },
    async delete(key) {
      await unlink(abs(key)).catch(() => undefined);
    },
    async list(prefix) {
      try {
        const dir = path.dirname(abs(`${prefix}x`));
        const base = path.relative(path.resolve(root), dir);
        return (await readdir(dir)).map((f) => (base ? `${base}/${f}` : f)).filter((k) => k.startsWith(prefix));
      } catch {
        return [];
      }
    },
  };
}

export function s3Storage(cfg: S3Config): FileStorage {
  const client = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    forcePathStyle: cfg.forcePathStyle,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
  return {
    name: "s3",
    async put(key, body, contentType) {
      await client.send(new PutObjectCommand({ Bucket: cfg.bucket, Key: key, Body: body, ContentType: contentType }));
    },
    async get(key) {
      try {
        const res = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
        return res.Body ? Buffer.from(await res.Body.transformToByteArray()) : null;
      } catch (e) {
        const name = (e as { name?: string }).name;
        if (name === "NoSuchKey" || name === "NotFound") return null;
        throw e;
      }
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
    },
    async list(prefix) {
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const res = await client.send(new ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: prefix, ContinuationToken: token }));
        for (const o of res.Contents ?? []) if (o.Key) keys.push(o.Key);
        token = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (token);
      return keys;
    },
  };
}

/** Minimal query interface (a pg Pool or Client). */
type Queryable = Pick<Pool, "query">;

export function dbStorage(pg: Queryable | (() => Queryable | Promise<Queryable>)): FileStorage {
  const q = async () => (typeof pg === "function" ? pg() : pg);
  return {
    name: "db",
    async put(key, body, contentType) {
      await (await q()).query(
        `INSERT INTO stored_file (key, content_type, data) VALUES ($1, $2, $3)
         ON CONFLICT (key) DO UPDATE SET content_type = EXCLUDED.content_type, data = EXCLUDED.data`,
        [key, contentType, body],
      );
    },
    async get(key) {
      const res = await (await q()).query<{ data: Buffer }>("SELECT data FROM stored_file WHERE key = $1", [key]);
      return res.rows[0]?.data ?? null;
    },
    async delete(key) {
      await (await q()).query("DELETE FROM stored_file WHERE key = $1", [key]);
    },
    async list(prefix) {
      const like = prefix.replace(/[\\%_]/g, (c) => `\\${c}`) + "%";
      const res = await (await q()).query<{ key: string }>("SELECT key FROM stored_file WHERE key LIKE $1 ORDER BY key", [like]);
      return res.rows.map((r) => r.key);
    },
  };
}

/** Builds a storage from a set of env-style variables (used for the app and the copy script). */
export function storageFromEnv(
  vars: Record<string, string | undefined>,
  opts: { pool?: () => Queryable | Promise<Queryable> } = {},
): FileStorage {
  const driver = vars.STORAGE_DRIVER ?? "local";
  if (driver === "db") {
    if (opts.pool) return dbStorage(opts.pool);
    if (!vars.DATABASE_URL) throw new Error("STORAGE_DRIVER=db needs DATABASE_URL");
    const url = vars.DATABASE_URL;
    let p: Promise<Pool> | undefined;
    return dbStorage(() => (p ??= import("pg").then(({ default: pg }) => new pg.Pool({ connectionString: url, max: 2 }))));
  }
  if (driver === "s3") {
    const missing = ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"].filter((k) => !vars[k]);
    if (missing.length) throw new Error(`STORAGE_DRIVER=s3 needs ${missing.join(", ")}`);
    return s3Storage({
      endpoint: vars.S3_ENDPOINT || undefined,
      region: vars.S3_REGION || "auto",
      bucket: vars.S3_BUCKET!,
      accessKeyId: vars.S3_ACCESS_KEY_ID!,
      secretAccessKey: vars.S3_SECRET_ACCESS_KEY!,
      forcePathStyle: vars.S3_FORCE_PATH_STYLE === "true",
    });
  }
  if (driver !== "local") throw new Error(`Unknown STORAGE_DRIVER "${driver}" (use db, local or s3)`);
  const dir = vars.UPLOAD_DIR === undefined ? "./storage/avatars" : vars.UPLOAD_DIR.trim();
  // An empty path would resolve to the working directory (and its .env).
  if (!dir) throw new Error("UPLOAD_DIR is empty");
  return localStorage(dir);
}

let cached: FileStorage | undefined;

export function storage(): FileStorage {
  if (!cached) {
    const e = env();
    // The app's db driver shares the app's connection pool.
    cached = storageFromEnv(
      { ...process.env, STORAGE_DRIVER: e.STORAGE_DRIVER, UPLOAD_DIR: e.UPLOAD_DIR },
      { pool: async () => (await import("@/db")).pool },
    );
  }
  return cached;
}

/** Test hook. */
export function setStorageForTests(s: FileStorage | undefined) {
  cached = s;
}

/**
 * Copies the app's files (profile photos, matched by `keyPattern`) from one
 * storage to another, skipping files already present. Anything else in the
 * source — stray files, config, secrets — is never copied.
 */
export async function copyAll(
  from: FileStorage,
  to: FileStorage,
  prefix = "",
  log: (m: string) => void = () => {},
  keyPattern: RegExp = /^[0-9a-f-]{36}\.webp$/,
) {
  let copied = 0;
  let skipped = 0;
  for (const key of await from.list(prefix)) {
    if (!keyPattern.test(key)) continue;
    if (await to.get(key)) {
      skipped++;
      continue;
    }
    const body = await from.get(key);
    if (!body) continue;
    await to.put(key, body, key.endsWith(".webp") ? "image/webp" : "application/octet-stream");
    copied++;
    log(`copied ${key}`);
  }
  return { copied, skipped };
}
