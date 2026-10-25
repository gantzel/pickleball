import { NextResponse } from "next/server";
import { isDomainError } from "@/lib/errors";
import { sessionIcs } from "@/server/calendar";
import { getCurrentUser, toActor } from "@/server/current-user";

export const dynamic = "force-dynamic";

/** One session as an .ics file ("Tilføj til kalender"). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const u = await getCurrentUser();
  if (!u) return new NextResponse(null, { status: 401 });
  const { id } = await ctx.params;
  try {
    const { filename, body } = await sessionIcs(toActor(u), id);
    return new NextResponse(body, {
      headers: {
        "content-type": "text/calendar; charset=utf-8",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "private, no-store",
      },
    });
  } catch (e) {
    if (isDomainError(e) && e.code === "NOT_FOUND") return new NextResponse(null, { status: 404 });
    throw e;
  }
}
