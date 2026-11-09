import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { previewStaffImport } from "@/lib/staff-import";
import { withSchoolRoute } from "@/lib/with-school-route";

const bodySchema = z.object({ csv: z.string().min(1), fileName: z.string().max(240).optional() });

export const POST = withSchoolRoute("staff.manage", async (request: NextRequest, _context, { principal, db }) => {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Upload a valid CSV file" }, { status: 400 });
  try { return NextResponse.json(await previewStaffImport(db, principal.schoolId, principal.userId, parsed.data.csv)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not preview the staff CSV" }, { status: 400 }); }
});
