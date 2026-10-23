CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
ALTER TABLE "code_chunks" ADD COLUMN IF NOT EXISTS "embedding_vec" vector(768);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "code_chunks_embedding_hnsw_idx" ON "code_chunks" USING hnsw ("embedding_vec" vector_cosine_ops);
