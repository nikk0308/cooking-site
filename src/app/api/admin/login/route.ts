import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { adminUsers, adminSessions } from "../../../../../db/schema";
import { getDatabase } from "@/platform/db/client";
import {
  credentials,
  sameOrigin,
  allowLogin,
} from "@/modules/admin/protection";
import {
  hashPassword,
  verifyPassword,
  newSessionToken,
  hashSessionToken,
  absoluteSessionMs,
} from "@/modules/admin/crypto";
import { sessionCookie } from "@/modules/admin/session";
import { readJson } from "@/platform/http";
let dummy: Promise<string> | undefined;
export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  if (!allowLogin())
    return Response.json(
      { error: "Слишком много попыток. Подождите минуту." },
      { status: 429 },
    );
  try {
    const v = credentials.parse(await readJson(request));
    const db = getDatabase();
    const user = (
      await db.select().from(adminUsers).where(eq(adminUsers.email, v.email))
    )[0];
    const fallback = await (dummy ??= hashPassword(newSessionToken()));
    const valid = await verifyPassword(
      v.password,
      user?.passwordHash ?? fallback,
    );
    if (!valid || !user)
      return Response.json(
        { error: "Неверный email или пароль" },
        { status: 401 },
      );
    const token = newSessionToken(),
      expiresAt = new Date(Date.now() + absoluteSessionMs);
    await db.insert(adminSessions).values({
      adminUserId: user.id,
      tokenHash: hashSessionToken(token),
      expiresAt,
    });
    (await cookies()).set(sessionCookie, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      expires: expiresAt,
    });
    return Response.json({ ok: true });
  } catch {
    return Response.json(
      { error: "Не удалось войти. Проверьте email и пароль." },
      { status: 400 },
    );
  }
}
