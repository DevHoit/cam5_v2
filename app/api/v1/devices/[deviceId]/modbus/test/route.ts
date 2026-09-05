import { NextResponse } from "next/server";
import { getSeededDb } from "@/app/api/v1/helper";

export async function POST() {
  await getSeededDb();
  return NextResponse.json({
    ok: true,
    latencyMs: 42,
    registerCount: 105,
  });
}
