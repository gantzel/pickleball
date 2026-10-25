import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
// @ts-expect-error s3rver ships no types
import S3rver from "s3rver";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { updateAvatar } from "@/server/members";
import { pool } from "@/db";
import { deleteAccount } from "@/server/members";
import { copyAll, dbStorage, localStorage, s3Storage, setStorageForTests, storageFromEnv, type FileStorage } from "@/server/storage";
import { readAvatar } from "@/server/uploads";
import { makeUser, resetDb } from "./helpers";

// A local S3-compatible server stands in for Cloudflare R2 / AWS S3.
let server: { run(): Promise<{ port: number }>; close(): Promise<void> };
let dir: string;
let s3: FileStorage;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "pbk-s3-"));
  server = new S3rver({ port: 0, address: "127.0.0.1", silent: true, directory: dir, configureBuckets: [{ name: "pbk-avatars" }] });
  const { port } = await server.run();
  s3 = s3Storage({ endpoint: `http://127.0.0.1:${port}`, region: "auto", bucket: "pbk-avatars", accessKeyId: "S3RVER", secretAccessKey: "S3RVER", forcePathStyle: true });
});

afterAll(async () => {
  setStorageForTests(undefined);
  await server.close();
  await rm(dir, { recursive: true, force: true });
});

beforeEach(resetDb);

describe("S3-compatible storage", () => {
  it("puts, gets, lists and deletes files", async () => {
    await s3.put("a.webp", Buffer.from("hello"), "image/webp");
    expect((await s3.get("a.webp"))?.toString()).toBe("hello");
    expect(await s3.list("")).toContain("a.webp");
    await s3.delete("a.webp");
    expect(await s3.get("a.webp")).toBeNull();
  });

  it("stores profile photos in the bucket when configured", async () => {
    setStorageForTests(s3);
    const m = await makeUser();
    const png = await sharp({ create: { width: 300, height: 300, channels: 3, background: "#1f5c4a" } }).png().toBuffer();
    const key = await updateAvatar(m, { bytes: png, declaredType: "image/png" });
    expect(await s3.get(key)).not.toBeNull();
    const served = await readAvatar(key);
    expect((await sharp(served!).metadata()).format).toBe("webp");
    setStorageForTests(undefined);
  });

  it("copies everything from local disk to a bucket (moving providers)", async () => {
    const localDir = await mkdtemp(path.join(tmpdir(), "pbk-local-"));
    const local = localStorage(localDir);
    await local.put("11111111-1111-1111-1111-111111111111.webp", Buffer.from("one"), "image/webp");
    await local.put("22222222-2222-2222-2222-222222222222.webp", Buffer.from("two"), "image/webp");
    await local.put(".env", Buffer.from("SECRET=1"), "text/plain"); // must never be copied
    const first = await copyAll(local, s3);
    expect(first).toEqual({ copied: 2, skipped: 0 });
    expect(await s3.get(".env")).toBeNull();
    expect((await s3.get("22222222-2222-2222-2222-222222222222.webp"))?.toString()).toBe("two");
    const again = await copyAll(local, s3);
    expect(again).toEqual({ copied: 0, skipped: 2 });
    await rm(localDir, { recursive: true, force: true });
  });

  it("builds the right driver from settings and rejects incomplete S3 settings", () => {
    expect(storageFromEnv({ STORAGE_DRIVER: "db", DATABASE_URL: "postgres://x" }).name).toBe("db");
    expect(() => storageFromEnv({ STORAGE_DRIVER: "db" })).toThrow(/DATABASE_URL/);
    expect(storageFromEnv({ STORAGE_DRIVER: "local", UPLOAD_DIR: "/tmp/x" }).name).toBe("local");
    expect(storageFromEnv({ STORAGE_DRIVER: "s3", S3_BUCKET: "b", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s" }).name).toBe("s3");
    expect(() => storageFromEnv({ STORAGE_DRIVER: "s3", S3_BUCKET: "b" })).toThrow(/S3_ACCESS_KEY_ID/);
    expect(() => storageFromEnv({ STORAGE_DRIVER: "ftp" })).toThrow(/Unknown/);
    expect(() => storageFromEnv({ STORAGE_DRIVER: "local", UPLOAD_DIR: "" })).toThrow(/empty/);
  });
});

describe("database storage (no extra provider)", () => {
  const dbs = () => dbStorage(pool);

  it("puts, overwrites, gets, lists and deletes files", async () => {
    const s = dbs();
    await s.put("a.webp", Buffer.from("hello"), "image/webp");
    await s.put("a.webp", Buffer.from("hej"), "image/webp");
    await s.put("b_x.webp", Buffer.from("b"), "image/webp");
    expect((await s.get("a.webp"))?.toString()).toBe("hej");
    expect(await s.list("")).toEqual(["a.webp", "b_x.webp"]);
    expect(await s.list("b_")).toEqual(["b_x.webp"]);
    expect(await s.list("%")).toEqual([]); // LIKE wildcards are escaped
    await s.delete("a.webp");
    expect(await s.get("a.webp")).toBeNull();
  });

  it("stores, serves and deletes profile photos in the database", async () => {
    setStorageForTests(dbs());
    const m = await makeUser();
    const png = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#1f5c4a" } }).png().toBuffer();
    const key = await updateAvatar(m, { bytes: png, declaredType: "image/png" });
    const served = await readAvatar(key);
    const meta = await sharp(served!).metadata();
    expect(meta.format).toBe("webp");
    expect(served!.length).toBeLessThan(100_000);
    // Replacing the photo removes the old one.
    const key2 = await updateAvatar(m, { bytes: png, declaredType: "image/png" });
    expect(await dbs().list("")).toEqual([key2]);
    await deleteAccount(m);
    expect(await dbs().list("")).toEqual([]);
    setStorageForTests(undefined);
  });

  it("copies between the database and a bucket in both directions", async () => {
    const s = dbs();
    await s.put("33333333-3333-3333-3333-333333333333.webp", Buffer.from("three"), "image/webp");
    expect(await copyAll(s, s3)).toEqual({ copied: 1, skipped: 0 });
    await s.delete("33333333-3333-3333-3333-333333333333.webp");
    const back = await copyAll(s3, s);
    expect(back.copied).toBeGreaterThanOrEqual(1);
    expect((await s.get("33333333-3333-3333-3333-333333333333.webp"))?.toString()).toBe("three");
  });
});
