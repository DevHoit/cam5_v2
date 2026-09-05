import { NextResponse } from "next/server";
import { getSeededDb } from "@/app/api/v1/helper";
import * as schema from "@/db/schema";

export async function GET() {
  const db = await getSeededDb();
  const catalog = await db
    .select()
    .from(schema.registerCatalog)
    .all();

  return NextResponse.json(
    catalog.map((reg) => ({
      nativeRegister: reg.nativeRegister,
      humanReference: reg.humanReference,
      description: reg.description,
      functionCode: reg.functionCode,
      dataType: reg.dataType,
      scale: reg.scale,
      unit: reg.unit,
      errorCode: reg.errorCode,
    }))
  );
}
