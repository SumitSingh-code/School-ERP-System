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

test("real PostgreSQL keeps OTP challenges and trusted devices within their school scope", { skip: !enabled }, async () => {
  const base = new PrismaClient();
  const schoolA = `otp-a-${randomUUID()}`;
  const schoolB = `otp-b-${randomUUID()}`;
  const userA = `otp-user-a-${randomUUID()}`;
  const userB = `otp-user-b-${randomUUID()}`;
  const challengeA = `otp-challenge-a-${randomUUID()}`;
  const challengeB = `otp-challenge-b-${randomUUID()}`;
  const deviceB = `otp-device-b-${randomUUID()}`;
  try {
    await base.school.createMany({ data: [{ id: schoolA, name: "Synthetic OTP School A" }, { id: schoolB, name: "Synthetic OTP School B" }] });
    await base.user.createMany({ data: [
      { id: userA, schoolId: schoolA, name: "Synthetic Staff A", phone: `otp-${randomUUID()}` },
      { id: userB, schoolId: schoolB, name: "Synthetic Staff B", phone: `otp-${randomUUID()}` },
    ] });
    await base.otpChallenge.createMany({ data: [
      { id: challengeA, userId: userA, schoolId: schoolA, activeRole: "Principal", codeHash: "synthetic-hash-a", ipHash: "synthetic-ip-a", expiresAt: new Date(Date.now() + 60_000) },
      { id: challengeB, userId: userB, schoolId: schoolB, activeRole: "Principal", codeHash: "synthetic-hash-b", ipHash: "synthetic-ip-b", expiresAt: new Date(Date.now() + 60_000) },
    ] });
    await base.authDevice.create({ data: { id: deviceB, userId: userB, schoolId: schoolB, tokenHash: `device-hash-${randomUUID()}`, expiresAt: new Date(Date.now() + 60_000) } });

    const a = forSchool(base, schoolA);
    assert.equal(await a.otpChallenge.findUnique({ where: { id: challengeB } }), null, "foreign OTP challenge is not visible");
    assert.deepEqual((await a.otpChallenge.findMany()).map((row) => row.id), [challengeA]);
    assert.equal((await a.otpChallenge.updateMany({ where: { id: challengeB }, data: { attempts: { increment: 1 } } })).count, 0);
    assert.equal(await a.authDevice.findFirst({ where: { id: deviceB } }), null, "foreign trusted device is not visible");
    assert.equal((await a.authDevice.deleteMany({ where: { id: deviceB } })).count, 0, "foreign device cannot be revoked/deleted");

    const unchanged = await base.otpChallenge.findUnique({ where: { id: challengeB } });
    assert.equal(unchanged?.attempts, 0);
    assert.equal(unchanged?.schoolId, schoolB);
  } finally {
    await base.otpChallenge.deleteMany({ where: { schoolId: { in: [schoolA, schoolB] } } });
    await base.authDevice.deleteMany({ where: { schoolId: { in: [schoolA, schoolB] } } });
    await base.user.deleteMany({ where: { schoolId: { in: [schoolA, schoolB] } } });
    await base.school.deleteMany({ where: { id: { in: [schoolA, schoolB] } } });
    await base.$disconnect();
  }
});
