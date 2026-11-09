import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "./prisma";
import { forSchool } from "./scoped-prisma";
import type { Capability } from "./authorization";

const COOKIE = "school_access";

async function principalForToken(token: string | undefined) {
  if (!token) return null;
  const accessTokenHash = createHash("sha256").update(token).digest("hex");
  const session = await prisma.session.findFirst({
    where: { accessTokenHash, accessExpiresAt: { gt: new Date() }, revokedAt: null, expiresAt: { gt: new Date() } },
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
  if (!session || session.user.status !== "ACTIVE" || session.user.deletedAt) return null;
  const activeAssignment = session.user.roles.find(({ role, schoolId }) => schoolId === session.schoolId && role.name === session.activeRole);
  if (!activeAssignment) return null;
  return {
    userId: session.userId,
    schoolId: session.schoolId,
    activeRole: session.activeRole,
    roles: session.user.roles.filter(({ schoolId }) => schoolId === session.schoolId).map(({ role }) => role.name),
    name: session.user.name,
    capabilities: new Set(activeAssignment.role.capabilities.map(({ capability }) => capability.key)),
  };
}

async function verifySession(request: NextRequest) {
  return principalForToken(request.cookies.get(COOKIE)?.value);
}

export async function getCurrentPrincipal() {
  const cookieStore = await cookies();
  return principalForToken(cookieStore.get(COOKIE)?.value);
}

type RouteContext = { params: Promise<Record<string, string>> };
type ScopedContext = { principal: NonNullable<Awaited<ReturnType<typeof verifySession>>>; db: ReturnType<typeof forSchool> };
type RouteHandler = (request: NextRequest, context: RouteContext, scope: ScopedContext) => Promise<Response>;

/** Required wrapper for protected route handlers: session, capability and school-scoped client. */
export function withSchoolRoute(capability: Capability | null, handler: RouteHandler) {
  return async (request: NextRequest, context: RouteContext) => {
    const principal = await verifySession(request);
    if (!principal) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    if (!principal.schoolId || (capability !== null && !principal.capabilities.has(capability))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    return handler(request, context, { principal, db: forSchool(prisma, principal.schoolId) });
  };
}

/** Public auth endpoints still use a common wrapper for method and error handling. */
export function withPublicRoute(handler: (request: NextRequest, context: RouteContext) => Promise<Response>) {
  return async (request: NextRequest, context: RouteContext) => {
    try {
      return await handler(request, context);
    } catch {
      return NextResponse.json({ error: "Request could not be completed" }, { status: 500 });
    }
  };
}

export { verifySession };
