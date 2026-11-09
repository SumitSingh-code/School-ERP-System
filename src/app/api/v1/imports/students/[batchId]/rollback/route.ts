import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { rollbackImportBatch } from "@/lib/student-import";
import { withSchoolRoute } from "@/lib/with-school-route";

const idSchema = z.string().uuid();

export const POST = withSchoolRoute("student.import", async (_request: NextRequest, context, { principal, db }) => {
  const { batchId } = await context.params;
  if (!idSchema.safeParse(batchId).success) return NextResponse.json({ error: "Import batch not found" }, { status: 404 });
  try {
    const result = await rollbackImportBatch(db, { schoolId: principal.schoolId, actorId: principal.userId, activeRole: principal.activeRole, batchId });
    return NextResponse.json({ batch: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not roll back this import";
    return NextResponse.json({ error: message }, { status: 409 });
  }
});
