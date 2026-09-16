import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { adminSessions } from "../../../../db/schema";
import { getDatabase } from "@/platform/db/client";
import { requireAdminSession, sessionCookie } from "@/modules/admin/session";
import { sameOrigin } from "@/modules/admin/protection";
export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  const session = await requireAdminSession();
  await getDatabase()
    .update(adminSessions)
    .set({ revokedAt: new Date() })
    .where(eq(adminSessions.id, session.id));
  (await cookies()).delete(sessionCookie);
  return new Response(null, {
    status: 303,
    headers: { Location: "/admin/login" },
  });
}
