/**
 * Copies uploaded files (profile photos) between two storages — e.g. when
 * moving from local disk to a bucket, or from one bucket provider to another.
 * Describe each side with FROM_* and TO_* versions of the storage variables:
 *
 *   FROM_STORAGE_DRIVER=local FROM_UPLOAD_DIR=./storage/avatars \
 *   TO_STORAGE_DRIVER=s3 TO_S3_ENDPOINT=https://<id>.r2.cloudflarestorage.com \
 *   TO_S3_BUCKET=pbk-avatars TO_S3_ACCESS_KEY_ID=... TO_S3_SECRET_ACCESS_KEY=... \
 *   npm run storage:copy
 *
 * The database driver works the same way: FROM_STORAGE_DRIVER=db
 * FROM_DATABASE_URL=postgres://… (the table stored_file must exist there).
 */
import { copyAll, storageFromEnv } from "../src/server/storage";

function side(prefix: string) {
  const vars: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(process.env)) if (k.startsWith(prefix)) vars[k.slice(prefix.length)] = v;
  return storageFromEnv(vars);
}

async function main() {
  const from = side("FROM_");
  const to = side("TO_");
  console.log(`Copying ${from.name} → ${to.name}…`);
  const r = await copyAll(from, to, "", console.log);
  console.log(`Done: ${r.copied} copied, ${r.skipped} already present.`);
  process.exit(0); // close any database pools
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
