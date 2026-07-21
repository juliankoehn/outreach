-- AlterTable
ALTER TABLE "Post" ADD COLUMN "analysis" JSONB;
ALTER TABLE "Post" ADD COLUMN "analyzedAt" TIMESTAMP(3);
