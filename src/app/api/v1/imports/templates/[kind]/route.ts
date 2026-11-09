import { NextResponse, type NextRequest } from "next/server";
import { withSchoolRoute } from "@/lib/with-school-route";

const templates: Record<string, string> = {
  students: "admission_no,student_name,dob,gender,class,stream,group,section,father_name,mother_name,guardian_phone_1,guardian_phone_2,address,payment_plan,previous_dues\r\n",
  staff: "name,phone,role,initial_password,class_teacher_of\r\n",
  assignments: "teacher_phone,class,section,subject\r\n",
  student_fee_overrides: "admission_no,fee_head,type,value,reason\r\n",
  holidays: "date,reason\r\n",
};

export const GET = withSchoolRoute("student.import", async (_request: NextRequest, context, { principal }) => {
  const { kind } = await context.params;
  const csv = templates[kind ?? ""];
  if (!csv) return NextResponse.json({ error: "Template not found" }, { status: 404 });
  if (kind === "staff" && !principal.capabilities.has("staff.manage")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const response = new NextResponse(csv, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${kind}-template.csv"`, "cache-control": "no-store" } });
  return response;
});
