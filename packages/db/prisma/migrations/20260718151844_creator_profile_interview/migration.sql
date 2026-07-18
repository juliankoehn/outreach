-- CreateTable
CREATE TABLE "CreatorProfile" (
    "id" TEXT NOT NULL,
    "linkedinAccountId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "goals" TEXT[],
    "audience" TEXT NOT NULL DEFAULT '',
    "pillars" TEXT[],
    "noGos" TEXT[],
    "toneWords" TEXT[],
    "languages" TEXT[],
    "positioning" TEXT NOT NULL DEFAULT '',
    "derived" JSONB,
    "derivedAt" TIMESTAMP(3),
    "brandBrief" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterviewSession" (
    "id" TEXT NOT NULL,
    "linkedinAccountId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'in_progress',
    "messages" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterviewSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreatorProfile_linkedinAccountId_key" ON "CreatorProfile"("linkedinAccountId");

-- CreateIndex
CREATE INDEX "InterviewSession_linkedinAccountId_idx" ON "InterviewSession"("linkedinAccountId");

-- AddForeignKey
ALTER TABLE "CreatorProfile" ADD CONSTRAINT "CreatorProfile_linkedinAccountId_fkey" FOREIGN KEY ("linkedinAccountId") REFERENCES "LinkedInAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterviewSession" ADD CONSTRAINT "InterviewSession_linkedinAccountId_fkey" FOREIGN KEY ("linkedinAccountId") REFERENCES "LinkedInAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
