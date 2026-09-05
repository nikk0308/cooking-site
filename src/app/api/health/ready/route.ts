import { NextResponse } from "next/server";
import { checkReadiness } from "@/platform/health/ready";
export const dynamic = "force-dynamic";
export async function GET() {
  const readiness = await checkReadiness();
  return NextResponse.json(readiness, {
    status: readiness.status === "ready" ? 200 : 503,
  });
}
