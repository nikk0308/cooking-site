import { getPool } from "@/platform/db/client";
import { getRuntimeConfig } from "@/platform/config/runtime";
export type Readiness = Readonly<{ status: "ready" | "unavailable" }>;
export async function checkReadiness(): Promise<Readiness> {
  try {
    const timeoutMs = getRuntimeConfig().DATABASE_QUERY_TIMEOUT_MS;
    await Promise.race([
      getPool().query("SELECT 1"),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("readiness timeout")), timeoutMs),
      ),
    ]);
    return { status: "ready" };
  } catch {
    return { status: "unavailable" };
  }
}
