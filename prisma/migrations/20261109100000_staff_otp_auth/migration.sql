-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "authDeviceId" TEXT;

-- CreateTable
CREATE TABLE "AuthDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "otpVerified" BOOLEAN NOT NULL DEFAULT false,
    "label" TEXT,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpChallenge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "activeRole" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpChallenge_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AuthDevice_tokenHash_key" ON "AuthDevice"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthDevice_userId_schoolId_revokedAt_idx" ON "AuthDevice"("userId", "schoolId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AuthDevice_id_schoolId_key" ON "AuthDevice"("id", "schoolId");

-- CreateIndex
CREATE INDEX "OtpChallenge_userId_createdAt_idx" ON "OtpChallenge"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "OtpChallenge_ipHash_createdAt_idx" ON "OtpChallenge"("ipHash", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OtpChallenge_id_schoolId_key" ON "OtpChallenge"("id", "schoolId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_authDeviceId_fkey" FOREIGN KEY ("authDeviceId") REFERENCES "AuthDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuthDevice" ADD CONSTRAINT "AuthDevice_userId_schoolId_fkey" FOREIGN KEY ("userId", "schoolId") REFERENCES "User"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OtpChallenge" ADD CONSTRAINT "OtpChallenge_userId_schoolId_fkey" FOREIGN KEY ("userId", "schoolId") REFERENCES "User"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Browser-facing Supabase access remains closed by default.
ALTER TABLE public."AuthDevice" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."OtpChallenge" ENABLE ROW LEVEL SECURITY;
