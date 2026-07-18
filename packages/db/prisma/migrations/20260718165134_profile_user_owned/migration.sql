/*
  Warnings:

  - You are about to drop the column `linkedinAccountId` on the `CreatorProfile` table. All the data in the column will be lost.
  - Added the required column `userId` to the `CreatorProfile` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "CreatorProfile" DROP CONSTRAINT "CreatorProfile_linkedinAccountId_fkey";

-- DropIndex
DROP INDEX "CreatorProfile_linkedinAccountId_key";

-- AlterTable
ALTER TABLE "CreatorProfile" DROP COLUMN "linkedinAccountId",
ADD COLUMN     "userId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "LinkedInAccount" ADD COLUMN     "creatorProfileId" TEXT;

-- CreateIndex
CREATE INDEX "CreatorProfile_userId_idx" ON "CreatorProfile"("userId");

-- AddForeignKey
ALTER TABLE "LinkedInAccount" ADD CONSTRAINT "LinkedInAccount_creatorProfileId_fkey" FOREIGN KEY ("creatorProfileId") REFERENCES "CreatorProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreatorProfile" ADD CONSTRAINT "CreatorProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
