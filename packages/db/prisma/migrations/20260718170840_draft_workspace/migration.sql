-- AlterTable
ALTER TABLE "Draft" ADD COLUMN     "chat" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "publishedAt" TIMESTAMP(3),
ADD COLUMN     "scheduledAt" TIMESTAMP(3);
