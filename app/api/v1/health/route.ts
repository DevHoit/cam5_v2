import { NextResponse } from "next/server";
import { getSeededDb } from "@/app/api/v1/helper";

export async function GET() {
  await getSeededDb();
  return NextResponse.json({
    status: "ok",
    gateway: "online",
    timestamp: new Date().toISOString(),
  });
}
