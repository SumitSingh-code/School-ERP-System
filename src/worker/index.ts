import PgBoss from "pg-boss";
import { PrismaClient } from "@prisma/client";
import { queueAttendanceReminders } from "./attendance-reminders";

const connectionString = process.env.DIRECT_URL;
if (!connectionString) throw new Error("DIRECT_URL is required for the pg-boss worker");

const boss = new PgBoss({ connectionString });
const prisma = new PrismaClient({ datasources: { db: { url: connectionString } } });
boss.on("error", () => console.error("pg-boss encountered an error"));

await boss.start();
for (const queue of ["imports", "pdf-generation", "reminders"]) await boss.work(queue, async (jobs) => {
  for (const job of jobs) console.info(`Received ${queue} job ${job.id}; handler is phase-scoped`);
});
await boss.schedule("attendance-reminder-check", "* * * * *", {}, { tz: "Asia/Kolkata" });
await boss.work("attendance-reminder-check", async () => {
  const queued = await queueAttendanceReminders(prisma);
  if (queued) console.info(JSON.stringify({ event: "attendance_reminders_queued", count: queued }));
});
console.info("School ERP worker started (pg-boss/Postgres)");

const shutdown = async () => { await boss.stop({ graceful: true, timeout: 10_000 }); await prisma.$disconnect(); process.exit(0); };
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
