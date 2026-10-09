DO $$ BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
  ALTER TABLE "code_chunks" ADD COLUMN IF NOT EXISTS "embedding_vec" vector(768);
  CREATE INDEX IF NOT EXISTS "code_chunks_embedding_hnsw_idx" ON "code_chunks" USING hnsw ("embedding_vec" vector_cosine_ops);
EXCEPTION
  WHEN duplicate_column THEN null;
  WHEN duplicate_object THEN null;
  WHEN OTHERS THEN null;
END $$;
