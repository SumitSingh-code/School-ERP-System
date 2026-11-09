import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { confirmStaffImport } from "@/lib/staff-import";
import { withSchoolRoute } from "@/lib/with-school-route";

const bodySchema = z.object({ csv: z.string().min(1), fileName: z.string().max(240).optional(), previewToken: z.string().min(1) });

export const POST = withSchoolRoute("staff.manage", async (request: NextRequest, _context, { principal, db }) => {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Preview the valid CSV before confirming it" }, { status: 400 });
  try {
    const result = await confirmStaffImport(db, { schoolId: principal.schoolId, actorId: principal.userId, activeRole: principal.activeRole, fileName: parsed.data.fileName ?? "staff.csv", rawCsv: parsed.data.csv, previewToken: parsed.data.previewToken });
    return NextResponse.json({ batch: result }, { status: 201 });
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not import staff" }, { status: 409 }); }
});
