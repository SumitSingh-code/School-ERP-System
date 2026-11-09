import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { previewStudentImport } from "@/lib/student-import";
import { withSchoolRoute } from "@/lib/with-school-route";

const bodySchema = z.object({ csv: z.string().min(1), fileName: z.string().max(240).optional() });

export const POST = withSchoolRoute("student.import", async (request: NextRequest, _context, { principal, db }) => {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Upload a valid CSV file", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  try {
    return NextResponse.json(await previewStudentImport(db, principal.schoolId, principal.userId, parsed.data.csv));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not preview this CSV";
    return NextResponse.json({ error: message }, { status: 400 });
  }
});
