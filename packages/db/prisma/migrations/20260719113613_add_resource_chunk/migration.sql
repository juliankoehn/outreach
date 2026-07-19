CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "ResourceChunk" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "section" TEXT,
    "tokenCount" INTEGER NOT NULL,
    "embedding" halfvec(3072) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ResourceChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ResourceChunk_accountId_idx" ON "ResourceChunk"("accountId");

-- CreateIndex
CREATE INDEX "ResourceChunk_resourceId_idx" ON "ResourceChunk"("resourceId");

-- AddForeignKey
ALTER TABLE "ResourceChunk" ADD CONSTRAINT "ResourceChunk_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "resource_chunk_embedding_hnsw"
  ON "ResourceChunk" USING hnsw (embedding halfvec_cosine_ops);
