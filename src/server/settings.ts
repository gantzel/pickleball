import { eq, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { appSettings, type AppSettings } from "@/db/schema";

export async function getSettings(tx: Tx = db): Promise<AppSettings> {
  const [row] = await tx.select().from(appSettings).where(eq(appSettings.id, 1));
  if (row) return row;
  await tx.execute(sql`INSERT INTO app_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
  const [created] = await tx.select().from(appSettings).where(eq(appSettings.id, 1));
  return created;
}
