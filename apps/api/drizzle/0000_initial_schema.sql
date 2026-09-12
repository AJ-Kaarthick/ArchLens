CREATE TABLE IF NOT EXISTS "repositories" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"default_branch" text NOT NULL,
	"description" text,
	"stars" integer DEFAULT 0 NOT NULL,
	"forks" integer DEFAULT 0 NOT NULL,
	"primary_language" text,
	"created_at" timestamp with time zone NOT NULL,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "analyses" (
	"id" serial PRIMARY KEY NOT NULL,
	"repository_id" integer NOT NULL,
	"commit_sha" text,
	"tech_stack" jsonb NOT NULL,
	"architecture" jsonb NOT NULL,
	"metrics" jsonb NOT NULL,
	"tree" jsonb NOT NULL,
	"analyzed_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_explanations" (
	"id" serial PRIMARY KEY NOT NULL,
	"analysis_id" integer NOT NULL,
	"topic" text NOT NULL,
	"target" text,
	"summary" text NOT NULL,
	"explanation" text NOT NULL,
	"key_takeaways" jsonb NOT NULL,
	"evidence" jsonb NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "code_chunks" (
	"id" serial PRIMARY KEY NOT NULL,
	"analysis_id" integer NOT NULL,
	"file_path" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"start_line" integer NOT NULL,
	"end_line" integer NOT NULL,
	"content" text NOT NULL,
	"language" text,
	"category" text NOT NULL,
	"embedding" jsonb,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "repository_executions" (
	"id" serial PRIMARY KEY NOT NULL,
	"repository_id" integer NOT NULL,
	"analysis_id" integer,
	"execution_id" text NOT NULL,
	"profile" text NOT NULL,
	"status" text NOT NULL,
	"exit_code" integer,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"refusal_reason" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "repositories_owner_name_unique" ON "repositories" ("owner", "name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analyses_repo_analyzed_at_idx" ON "analyses" ("repository_id", "analyzed_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "analyses_analyzed_at_desc_idx" ON "analyses" ("analyzed_at" DESC);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_explanations_unique" ON "ai_explanations" ("analysis_id", "topic", COALESCE("target", ''));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "code_chunks_analysis_idx" ON "code_chunks" ("analysis_id");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "code_chunks_analysis_file_chunk_unique" ON "code_chunks" ("analysis_id", "file_path", "chunk_index");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "repository_executions_execution_id_unique" ON "repository_executions" ("execution_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "repository_executions_repo_idx" ON "repository_executions" ("repository_id");
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "analyses" ADD CONSTRAINT "analyses_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_explanations" ADD CONSTRAINT "ai_explanations_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "analyses"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "code_chunks" ADD CONSTRAINT "code_chunks_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "analyses"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repository_executions" ADD CONSTRAINT "repository_executions_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "repository_executions" ADD CONSTRAINT "repository_executions_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "analyses"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
  ALTER TABLE "code_chunks" ADD COLUMN IF NOT EXISTS "embedding_vec" vector(768);
  CREATE INDEX IF NOT EXISTS "code_chunks_embedding_hnsw_idx" ON "code_chunks" USING hnsw ("embedding_vec" vector_cosine_ops);
 END IF;
EXCEPTION
 WHEN duplicate_column THEN null;
 WHEN duplicate_object THEN null;
 WHEN OTHERS THEN null;
END $$;
