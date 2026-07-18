-- CreateTable
CREATE TABLE "Draft" (
    "id" TEXT NOT NULL,
    "linkedinAccountId" TEXT NOT NULL,
    "text" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT,
    "imagePrompt" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "source" TEXT NOT NULL DEFAULT 'ai',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Draft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Draft_linkedinAccountId_createdAt_idx" ON "Draft"("linkedinAccountId", "createdAt");

-- AddForeignKey
ALTER TABLE "Draft" ADD CONSTRAINT "Draft_linkedinAccountId_fkey" FOREIGN KEY ("linkedinAccountId") REFERENCES "LinkedInAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
