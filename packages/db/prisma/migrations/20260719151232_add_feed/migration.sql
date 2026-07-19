-- CreateTable
CREATE TABLE "FeedSource" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "error" TEXT,
    "lastFetchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedItem" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "guid" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "excerpt" TEXT NOT NULL,
    "imageUrl" TEXT,
    "author" TEXT,
    "publishedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'new',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeedSource_userId_url_key" ON "FeedSource"("userId", "url");

-- CreateIndex
CREATE INDEX "FeedItem_userId_status_publishedAt_idx" ON "FeedItem"("userId", "status", "publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FeedItem_sourceId_guid_key" ON "FeedItem"("sourceId", "guid");

-- AddForeignKey
ALTER TABLE "FeedSource" ADD CONSTRAINT "FeedSource_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedItem" ADD CONSTRAINT "FeedItem_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "FeedSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Re-create the pgvector HNSW index that Prisma's schema diff cannot see (it lives
-- on an Unsupported("halfvec(3072)") column) and therefore tried to DROP above.
-- Idempotent: a fresh clone already has it from 20260719113613_add_resource_chunk.
CREATE INDEX IF NOT EXISTS "resource_chunk_embedding_hnsw" ON "ResourceChunk" USING hnsw (embedding halfvec_cosine_ops);
