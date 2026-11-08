import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { prisma } from "./prisma";
import { forSchool } from "./scoped-prisma";
import type { Capability } from "./authorization";

const COOKIE = "school_session";

async function verifySession(request: NextRequest) {
  const token = request.cookies.get(COOKIE)?.value;
  if (!token) return null;
  const refreshTokenHash = createHash("sha256").update(token).digest("hex");
  const session = await prisma.session.findFirst({
    where: { refreshTokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
    include: {
      user: {
        include: {
          roles: {
            include: {
              role: {
                include: {
                  capabilities: { include: { capability: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!session || session.user.status !== "ACTIVE") return null;
  const activeAssignment = session.user.roles.find(({ role, schoolId }) => schoolId === session.schoolId && role.name === session.activeRole);
  if (!activeAssignment) return null;
  return {
    userId: session.userId,
    schoolId: session.schoolId,
    activeRole: session.activeRole,
    capabilities: new Set(activeAssignment.role.capabilities.map(({ capability }) => capability.key)),
  };
}

type RouteContext = { params: Promise<Record<string, string>> };
type ScopedContext = { principal: NonNullable<Awaited<ReturnType<typeof verifySession>>>; db: ReturnType<typeof forSchool> };
type RouteHandler = (request: NextRequest, context: RouteContext, scope: ScopedContext) => Promise<Response>;

/** Required wrapper for protected route handlers: session, capability and school-scoped client. */
export function withSchoolRoute(capability: Capability, handler: RouteHandler) {
  return async (request: NextRequest, context: RouteContext) => {
    const principal = await verifySession(request);
    if (!principal) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (!principal.schoolId || !principal.capabilities.has(capability)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return handler(request, context, { principal, db: forSchool(prisma, principal.schoolId) });
  };
}
