import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDatabase } from "@/platform/db/client";
import { adminSessions } from "../../../db/schema";
import { hashSessionToken, idleSessionMs } from "./crypto";
export const sessionCookie =
  process.env.NODE_ENV === "production"
    ? "__Host-recipes-admin"
    : "recipes-admin";
export async function requireAdminSession() {
  const token = (await cookies()).get(sessionCookie)?.value;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) redirect("/admin/login");
  const now = new Date();
  const session = (
    await getDatabase()
      .update(adminSessions)
      .set({ lastSeenAt: now })
      .where(
        and(
          eq(adminSessions.tokenHash, hashSessionToken(token)),
          isNull(adminSessions.revokedAt),
          gt(adminSessions.expiresAt, now),
          gt(adminSessions.lastSeenAt, new Date(now.getTime() - idleSessionMs)),
        ),
      )
      .returning({
        id: adminSessions.id,
        adminUserId: adminSessions.adminUserId,
      })
  )[0];
  if (!session) redirect("/admin/login");
  return session;
}
