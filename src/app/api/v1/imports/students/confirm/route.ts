import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { confirmStudentImport } from "@/lib/student-import";
import { withSchoolRoute } from "@/lib/with-school-route";

const bodySchema = z.object({ csv: z.string().min(1), fileName: z.string().max(240).optional(), previewToken: z.string().min(1) });

export const POST = withSchoolRoute("student.import", async (request: NextRequest, _context, { principal, db }) => {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Preview the valid CSV before confirming it" }, { status: 400 });
  try {
    const result = await confirmStudentImport(db, { schoolId: principal.schoolId, actorId: principal.userId, activeRole: principal.activeRole, fileName: parsed.data.fileName ?? "students.csv", rawCsv: parsed.data.csv, previewToken: parsed.data.previewToken });
    return NextResponse.json({ batch: result }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not import these students";
    return NextResponse.json({ error: message }, { status: 409 });
  }
});
