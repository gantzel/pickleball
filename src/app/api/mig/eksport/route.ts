import { NextResponse } from "next/server";
import { isDomainError } from "@/lib/errors";
import { getCurrentUser, toActor } from "@/server/current-user";
import { exportMyData } from "@/server/privacy";

export const dynamic = "force-dynamic";

/** "Download mine data": the logged-in member's own data as JSON. */
export async function GET() {
  const u = await getCurrentUser();
  if (!u) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  try {
    const data = await exportMyData(toActor(u));
    const date = new Date().toISOString().slice(0, 10);
    return new NextResponse(JSON.stringify(data, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="mine-data-pickleball-kbh-${date}.json"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    if (isDomainError(e)) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
