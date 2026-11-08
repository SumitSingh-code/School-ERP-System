import PgBoss from "pg-boss";

const connectionString = process.env.DIRECT_URL;
if (!connectionString) throw new Error("DIRECT_URL is required for the pg-boss worker");

const boss = new PgBoss({ connectionString });
boss.on("error", () => console.error("pg-boss encountered an error"));

await boss.start();
for (const queue of ["imports", "pdf-generation", "reminders"]) await boss.work(queue, async (jobs) => {
  for (const job of jobs) console.info(`Received ${queue} job ${job.id}; handler is phase-scoped`);
});
console.info("School ERP worker started (pg-boss/Postgres)");

const shutdown = async () => { await boss.stop({ graceful: true, timeout: 10_000 }); process.exit(0); };
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
