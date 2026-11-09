import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auditedMutation } from "@/lib/audited-mutation";
import { withSchoolRoute } from "@/lib/with-school-route";

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const interval = z.object({ start: clock, end: clock });
const payload = z.object({
  workingDays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  periods: z.array(z.object({ period: z.number().int().min(1).max(8), start: clock, end: clock })).length(8),
  breaks: z.array(z.object({ afterPeriod: z.number().int().min(0).max(8), label: z.string().trim().min(1).max(30), ...interval.shape })).max(8),
}).superRefine((value, context) => {
  if (new Set(value.workingDays).size !== value.workingDays.length) context.addIssue({ code: "custom", message: "Working days must not repeat", path: ["workingDays"] });
  const periods = [...value.periods].sort((a, b) => a.period - b.period);
  if (periods.some((item, index) => item.period !== index + 1 || item.start >= item.end)) context.addIssue({ code: "custom", message: "Enter eight ordered periods with valid start and end times", path: ["periods"] });
  const events = [
    ...periods.map((item) => ({ start: item.start, end: item.end, name: `Period ${item.period}` })),
    ...value.breaks.map((item) => ({ start: item.start, end: item.end, name: item.label })),
  ].sort((a, b) => a.start.localeCompare(b.start));
  for (let index = 0; index < events.length; index += 1) {
    if (events[index].start >= events[index].end || (index > 0 && events[index - 1].end > events[index].start)) context.addIssue({ code: "custom", message: `${events[index].name} overlaps another period or break`, path: ["periods"] });
  }
  for (const pause of value.breaks) {
    const previous = periods[pause.afterPeriod - 1];
    const next = periods[pause.afterPeriod];
    if ((previous && pause.start < previous.end) || (next && pause.end > next.start)) context.addIssue({ code: "custom", message: `${pause.label} must fit between the selected periods`, path: ["breaks"] });
  }
});

export const GET = withSchoolRoute("timetable.read", async (_request, _context, { db }) => {
  const settings = await db.scheduleSettings.findFirst();
  const periods = Array.from({ length: 8 }, (_, index) => {
    const startMinutes = 8 * 60 + index * 50;
    const clockValue = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    return { period: index + 1, start: clockValue(startMinutes), end: clockValue(startMinutes + 45) };
  });
  return NextResponse.json({ settings: settings ?? { workingDays: [1, 2, 3, 4, 5, 6], periodLayout: { periods, breaks: [] } } });
});

export const PUT = withSchoolRoute("timetable.manage", async (request: NextRequest, _context, { db, principal }) => {
  const parsed = payload.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the schedule settings", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  const input = parsed.data;
  const before = await db.scheduleSettings.findFirst();
  const settings = await auditedMutation(db, { actorId: principal.userId, activeRole: principal.activeRole, schoolId: principal.schoolId, action: before ? "schedule.settings.updated" : "schedule.settings.created", entityType: "ScheduleSettings", entityId: before?.id, oldValue: before ? { workingDays: before.workingDays, periodLayout: before.periodLayout } : undefined, newValue: { workingDays: input.workingDays, periodLayout: { periods: input.periods, breaks: input.breaks } } }, async (tx) => tx.scheduleSettings.upsert({
    where: { schoolId: principal.schoolId },
    create: { schoolId: principal.schoolId, workingDays: input.workingDays, periodLayout: { periods: input.periods, breaks: input.breaks }, updatedById: principal.userId },
    update: { workingDays: input.workingDays, periodLayout: { periods: input.periods, breaks: input.breaks }, updatedById: principal.userId },
  }));
  return NextResponse.json({ settings });
});
