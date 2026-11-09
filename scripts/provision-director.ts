import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";
import { normalizeLoginPhone, passwordPolicyError } from "../src/lib/auth-rules";
import { seedSystemRoles } from "../src/lib/role-permissions";
import { initializeAcademicStructure } from "../src/lib/seed-academics";

const prisma = new PrismaClient();

function askHidden(label: string) {
  if (!stdin.isTTY) throw new Error("Run this command from an interactive terminal so the password stays hidden.");
  stdout.write(label);
  return new Promise<string>((resolve, reject) => {
    let value = "";
    const input = stdin;
    input.setRawMode(true);
    input.resume();
    const finish = (error?: Error) => {
      input.setRawMode(false);
      input.pause();
      input.removeListener("data", onData);
      stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (buffer: Buffer) => {
      for (const character of buffer.toString("utf8")) {
        if (character === "\u0003") return finish(new Error("Cancelled"));
        if (character === "\r" || character === "\n") return finish();
        if (character === "\u0008" || character === "\u007f") value = value.slice(0, -1);
        else if (character >= " ") value += character;
      }
    };
    input.on("data", onData);
  });
}

async function main() {
  const terminal = createInterface({ input: stdin, output: stdout });
  const schoolName = (await terminal.question("School name: ")).trim();
  const directorName = (await terminal.question("Director name: ")).trim();
  const rawPhone = (await terminal.question("Director phone: ")).trim();
  terminal.close();

  const phone = normalizeLoginPhone(rawPhone);
  if (!schoolName || schoolName.length > 120) throw new Error("Enter a school name up to 120 characters.");
  if (!directorName || directorName.length > 120) throw new Error("Enter a director name up to 120 characters.");
  if (!phone) throw new Error("Enter a valid Indian 10-digit phone number.");
  const password = await askHidden("Set Director password (8+ characters): ");
  const passwordError = passwordPolicyError(password, phone);
  if (passwordError) throw new Error(passwordError);

  if (await prisma.school.count() > 0) throw new Error("A school is already provisioned. This one-time setup cannot add another school.");
  if (await prisma.user.findUnique({ where: { phone } })) throw new Error("That phone number already belongs to an account.");

  await seedSystemRoles(prisma);
  const directorRole = await prisma.role.findUniqueOrThrow({ where: { name: "Director" } });
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  await prisma.$transaction(async (tx) => {
    const school = await tx.school.create({ data: { name: schoolName } });
    const user = await tx.user.create({ data: { schoolId: school.id, name: directorName, phone, passwordHash } });
    await tx.userRole.create({ data: { userId: user.id, roleId: directorRole.id, schoolId: school.id } });
    await initializeAcademicStructure(tx, school.id);
    await tx.auditLog.create({ data: {
      actorId: user.id,
      schoolId: school.id,
      activeRole: "Director",
      action: "auth.bootstrap.director.created",
      entityType: "User",
      entityId: user.id,
      newValue: { role: "Director" },
    } });
  });
  stdout.write("Director account created. Keep the password private. High-privilege sign-in stays blocked until OTP delivery is configured.\n");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Provisioning failed";
  console.error(message);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
