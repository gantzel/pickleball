import { db, type Tx } from "@/db";
import { auditEvent } from "@/db/schema";

/** Records a significant action. Never pass secrets or tokens in metadata. */
export async function audit(
  tx: Tx,
  e: { actorId: string | null; action: string; targetType?: string; targetId?: string; metadata?: Record<string, unknown> },
) {
  await (tx ?? db).insert(auditEvent).values({
    actorId: e.actorId,
    action: e.action,
    targetType: e.targetType,
    targetId: e.targetId,
    metadata: e.metadata ?? null,
  });
}
