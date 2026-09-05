import { NextResponse } from "next/server";
import { getLiveness } from "@/platform/health/live";
export const dynamic = "force-dynamic";
export function GET() {
  return NextResponse.json(getLiveness(), { status: 200 });
}
