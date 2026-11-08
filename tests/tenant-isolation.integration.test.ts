import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { forSchool } from "../src/lib/scoped-prisma";

const enabled = process.env.TENANT_DB_TEST === "1" && Boolean(process.env.DATABASE_URL);
test("real PostgreSQL tenant isolation across all Prisma operations", { skip: !enabled }, async () => {
  const base = new PrismaClient();
  const schoolA = `phase05-a-${randomUUID()}`;
  const schoolB = `phase05-b-${randomUUID()}`;
  const recordA = `phase05-student-a-${randomUUID()}`;
  const recordB = `phase05-student-b-${randomUUID()}`;
  try {
    await base.school.createMany({ data: [{ id: schoolA, name: "Synthetic School A" }, { id: schoolB, name: "Synthetic School B" }] });
    await base.student.createMany({ data: [
      { id: recordA, schoolId: schoolA, admissionNo: recordA, fullName: "Synthetic Student A" },
      { id: recordB, schoolId: schoolB, admissionNo: recordB, fullName: "Synthetic Student B" },
    ] });
    const a = forSchool(base, schoolA);

    assert.equal(await a.student.findFirst({ where: { id: recordB } }), null, "findFirst");
    assert.equal(await a.student.findUnique({ where: { id: recordB } }), null, "findUnique");
    assert.deepEqual((await a.student.findMany()).map((r) => r.id), [recordA], "findMany");
    assert.equal(await a.student.count(), 1, "count");
    assert.equal((await a.student.aggregate({ _count: true }))._count, 1, "aggregate");
    assert.deepEqual(await a.student.groupBy({ by: ["schoolId"], _count: true }), [{ schoolId: schoolA, _count: 1 }], "groupBy");

    const created = await a.student.create({ data: { id: `create-${crypto.randomUUID()}`, schoolId: schoolB, admissionNo: `create-${crypto.randomUUID()}`, fullName: "Synthetic Create" } });
    assert.equal(created.schoolId, schoolA, "create forces active scope");
    const many = await a.student.createMany({ data: [{ admissionNo: `many-${crypto.randomUUID()}`, schoolId: schoolB, fullName: "Synthetic Many" }] });
    assert.equal(many.count, 1, "createMany");

    await assert.rejects(() => a.student.update({ where: { id: recordB }, data: { fullName: "Must not update B" } }));
    assert.equal((await a.student.updateMany({ where: { id: recordB }, data: { fullName: "Must not update B" } })).count, 0, "updateMany");
    await assert.rejects(() => a.student.upsert({ where: { id: recordB }, create: { id: recordB, schoolId: schoolB, admissionNo: recordB, fullName: "Must not recreate B" }, update: { fullName: "Must not update B" } }));
    await assert.rejects(() => a.student.delete({ where: { id: recordB } }));
    assert.equal((await a.student.deleteMany({ where: { id: recordB } })).count, 0, "deleteMany");

    const untouchedB = await base.student.findUnique({ where: { id: recordB } });
    assert.equal(untouchedB?.fullName, "Synthetic Student B");
    assert.equal(untouchedB?.schoolId, schoolB);
  } finally {
    await base.student.deleteMany({ where: { schoolId: { in: [schoolA, schoolB] } } });
    await base.school.deleteMany({ where: { id: { in: [schoolA, schoolB] } } });
    await base.$disconnect();
  }
});
