import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auditedMutation } from "@/lib/audited-mutation";
import { withSchoolRoute } from "@/lib/with-school-route";

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}, "Enter a real date");
const indiaToday = () => new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);
const postSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), date: dateOnly, reason: z.string().trim().min(2).max(120), type: z.enum(["PLANNED", "SUDDEN"]).default("PLANNED") }),
  z.object({ action: z.literal("nationalDates"), year: z.number().int().min(2020).max(2100) }),
  z.object({ action: z.literal("secondSaturday"), date: dateOnly }),
]);

export const GET = withSchoolRoute("holiday.manage", async (request, _context, { db }) => {
  const year = Number(new URL(request.url).searchParams.get("year") ?? new Date().getFullYear());
  const holidays = await db.holiday.findMany({ where: { deletedAt: null, date: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } }, orderBy: { date: "asc" } });
  return NextResponse.json({ holidays, year });
});

export const POST = withSchoolRoute("holiday.manage", async (request: NextRequest, _context, { db, principal }) => {
  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the holiday details", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  const input = parsed.data;
  if (input.action === "create" && input.type === "SUDDEN") {
    if (!principal.capabilities.has("holiday.sudden") || !["Director", "Principal"].includes(principal.activeRole)) return NextResponse.json({ error: "Only a Director or Principal can announce a same-day closure" }, { status: 403 });
    if (input.date !== indiaToday()) return NextResponse.json({ error: "Sudden closures must be for today" }, { status: 400 });
  }
  if (input.action === "secondSaturday") {
    const date = new Date(`${input.date}T00:00:00.000Z`);
    if (date.getUTCDay() !== 6 || date.getUTCDate() < 8 || date.getUTCDate() > 14) return NextResponse.json({ error: "Choose the second Saturday of a month" }, { status: 400 });
  }
  const items = input.action === "nationalDates"
    ? [{ date: `${input.year}-01-26`, reason: "Republic Day" }, { date: `${input.year}-08-15`, reason: "Independence Day" }, { date: `${input.year}-10-02`, reason: "Gandhi Jayanti" }]
    : input.action === "secondSaturday" ? [{ date: input.date, reason: "Second Saturday" }] : [{ date: input.date, reason: input.reason }];
  try {
    const created = await auditedMutation(db, { actorId: principal.userId, activeRole: principal.activeRole, schoolId: principal.schoolId, action: "holiday.created", entityType: "Holiday", newValue: items }, async (tx) => {
      const result = [];
      for (const item of items) {
        const date = new Date(`${item.date}T00:00:00.000Z`);
        const existing = await tx.holiday.findFirst({ where: { date } });
        const holiday = existing
          ? await tx.holiday.update({ where: { id: existing.id }, data: { reason: item.reason, type: input.action === "create" ? input.type : "PLANNED", deletedAt: null, createdById: principal.userId } })
          : await tx.holiday.create({ data: { schoolId: principal.schoolId, date, reason: item.reason, type: input.action === "create" ? input.type : "PLANNED", createdById: principal.userId } });
        await tx.auditLog.create({ data: { actorId: principal.userId, activeRole: principal.activeRole, schoolId: principal.schoolId, action: existing ? "holiday.updated" : "holiday.created", entityType: "Holiday", entityId: holiday.id, oldValue: existing ? { date: existing.date, type: existing.type, reason: existing.reason } : undefined, newValue: { date, type: holiday.type, reason: holiday.reason } } });
        result.push(holiday);
      }
      return result;
    });
    return NextResponse.json({ holidays: created }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Could not save the holiday" }, { status: 409 });
  }
});

export const DELETE = withSchoolRoute("holiday.manage", async (request: NextRequest, _context, { db, principal }) => {
  const parsed = z.object({ id: z.string().uuid() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid holiday" }, { status: 400 });
  const holiday = await db.holiday.findFirst({ where: { id: parsed.data.id, deletedAt: null } });
  if (!holiday) return NextResponse.json({ error: "Holiday not found" }, { status: 404 });
  await auditedMutation(db, { actorId: principal.userId, activeRole: principal.activeRole, schoolId: principal.schoolId, action: "holiday.deleted", entityType: "Holiday", entityId: holiday.id, oldValue: { date: holiday.date, type: holiday.type, reason: holiday.reason } }, async (tx) => {
    await tx.holiday.update({ where: { id: holiday.id }, data: { deletedAt: new Date() } });
  });
  return NextResponse.json({ ok: true });
});
