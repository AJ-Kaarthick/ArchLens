DO $$
DECLARE
  rec RECORD;
  keeper_id INTEGER;
BEGIN
  FOR rec IN (
    SELECT repository_id, commit_sha, array_agg(id ORDER BY id DESC) as ids
    FROM analyses
    GROUP BY repository_id, commit_sha
    HAVING count(*) > 1
  ) LOOP
    keeper_id := rec.ids[1];
    UPDATE ai_explanations
    SET analysis_id = keeper_id
    WHERE analysis_id = ANY(rec.ids[2:]);

    UPDATE code_chunks
    SET analysis_id = keeper_id
    WHERE analysis_id = ANY(rec.ids[2:]);

    UPDATE repository_executions
    SET analysis_id = keeper_id
    WHERE analysis_id = ANY(rec.ids[2:]);

    DELETE FROM analyses
    WHERE id = ANY(rec.ids[2:]);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "analyses_repo_commit_sha_unique" ON "analyses" ("repository_id", "commit_sha") NULLS NOT DISTINCT;
--> statement-breakpoint
ALTER TABLE "ai_explanations" ADD COLUMN IF NOT EXISTS "repository_id" integer;
--> statement-breakpoint
ALTER TABLE "ai_explanations" ADD COLUMN IF NOT EXISTS "commit_sha" text;
--> statement-breakpoint
ALTER TABLE "ai_explanations" ADD COLUMN IF NOT EXISTS "prompt_version" integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_explanations" ADD COLUMN IF NOT EXISTS "status" text DEFAULT 'ready' NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_explanations" ADD COLUMN IF NOT EXISTS "retry_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "ai_explanations" ADD COLUMN IF NOT EXISTS "attempt_count" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_explanations" ADD COLUMN IF NOT EXISTS "last_error_category" text;
--> statement-breakpoint
ALTER TABLE "ai_explanations" ADD COLUMN IF NOT EXISTS "last_error_message" text;
--> statement-breakpoint
ALTER TABLE "ai_explanations" ALTER COLUMN "summary" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_explanations" ALTER COLUMN "explanation" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_explanations" ALTER COLUMN "key_takeaways" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_explanations" ALTER COLUMN "evidence" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_explanations" ALTER COLUMN "provider" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_explanations" ALTER COLUMN "model" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_explanations" ALTER COLUMN "analysis_id" DROP NOT NULL;
--> statement-breakpoint
UPDATE "ai_explanations" ae
SET "repository_id" = a."repository_id",
    "commit_sha" = COALESCE(a."commit_sha", 'unknown')
FROM "analyses" a
WHERE ae."analysis_id" = a."id" AND ae."repository_id" IS NULL;
--> statement-breakpoint
DELETE FROM "ai_explanations" WHERE "repository_id" IS NULL;
--> statement-breakpoint
ALTER TABLE "ai_explanations" ALTER COLUMN "repository_id" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_explanations" ALTER COLUMN "commit_sha" SET NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "ai_explanations" ADD CONSTRAINT "ai_explanations_repository_id_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_explanations_repo_commit_sha_idx" ON "ai_explanations" ("repository_id", "commit_sha");
--> statement-breakpoint
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN (
    SELECT repository_id, commit_sha, topic, COALESCE(target, '') as tgt, prompt_version, array_agg(id ORDER BY id DESC) as ids
    FROM ai_explanations
    GROUP BY repository_id, commit_sha, topic, COALESCE(target, ''), prompt_version
    HAVING count(*) > 1
  ) LOOP
    DELETE FROM ai_explanations WHERE id = ANY(rec.ids[2:]);
  END LOOP;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "ai_explanations_repo_sha_topic_target_version_unique" ON "ai_explanations" ("repository_id", "commit_sha", "topic", "target", "prompt_version") NULLS NOT DISTINCT;
