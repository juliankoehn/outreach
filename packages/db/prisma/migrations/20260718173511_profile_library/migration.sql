/*
  Warnings:

  - You are about to drop the column `linkedinAccountId` on the `InterviewSession` table. All the data in the column will be lost.
  - Added the required column `creatorProfileId` to the `InterviewSession` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "InterviewSession" DROP CONSTRAINT "InterviewSession_linkedinAccountId_fkey";

-- DropIndex
DROP INDEX "InterviewSession_linkedinAccountId_idx";

-- AlterTable
ALTER TABLE "CreatorProfile" ADD COLUMN     "name" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "InterviewSession" DROP COLUMN "linkedinAccountId",
ADD COLUMN     "creatorProfileId" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "InterviewSession_creatorProfileId_idx" ON "InterviewSession"("creatorProfileId");

-- AddForeignKey
ALTER TABLE "InterviewSession" ADD CONSTRAINT "InterviewSession_creatorProfileId_fkey" FOREIGN KEY ("creatorProfileId") REFERENCES "CreatorProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
