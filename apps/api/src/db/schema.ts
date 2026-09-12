import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';
import type {
  TechStackDetection,
  ArchitectureOverview,
  StructuralMetrics,
  FileTreeItem,
  EvidenceCitation,
} from '@archlens/shared';

export const repositories = pgTable(
  'repositories',
  {
    id: serial('id').primaryKey(),
    owner: text('owner').notNull(),
    name: text('name').notNull(),
    url: text('url').notNull(),
    defaultBranch: text('default_branch').notNull(),
    description: text('description'),
    stars: integer('stars').notNull().default(0),
    forks: integer('forks').notNull().default(0),
    primaryLanguage: text('primary_language'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    ownerNameIdx: uniqueIndex('repositories_owner_name_unique').on(table.owner, table.name),
  })
);

export const analyses = pgTable('analyses', {
  id: serial('id').primaryKey(),
  repositoryId: integer('repository_id')
    .notNull()
    .references(() => repositories.id, { onDelete: 'cascade' }),
  commitSha: text('commit_sha'),
  techStack: jsonb('tech_stack').$type<TechStackDetection[]>().notNull(),
  architecture: jsonb('architecture').$type<ArchitectureOverview>().notNull(),
  metrics: jsonb('metrics').$type<StructuralMetrics>().notNull(),
  tree: jsonb('tree').$type<FileTreeItem[]>().notNull(),
  analyzedAt: timestamp('analyzed_at', { withTimezone: true }).notNull(),
});

export const aiExplanations = pgTable('ai_explanations', {
  id: serial('id').primaryKey(),
  analysisId: integer('analysis_id')
    .notNull()
    .references(() => analyses.id, { onDelete: 'cascade' }),
  topic: text('topic').notNull(),
  target: text('target'),
  summary: text('summary').notNull(),
  explanation: text('explanation').notNull(),
  keyTakeaways: jsonb('key_takeaways').$type<string[]>().notNull(),
  evidence: jsonb('evidence').$type<EvidenceCitation[]>().notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
});

export const codeChunks = pgTable(
  'code_chunks',
  {
    id: serial('id').primaryKey(),
    analysisId: integer('analysis_id')
      .notNull()
      .references(() => analyses.id, { onDelete: 'cascade' }),
    filePath: text('file_path').notNull(),
    chunkIndex: integer('chunk_index').notNull(),
    startLine: integer('start_line').notNull(),
    endLine: integer('end_line').notNull(),
    content: text('content').notNull(),
    language: text('language'),
    category: text('category').notNull(),
    embedding: jsonb('embedding').$type<number[] | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    analysisIdx: index('code_chunks_analysis_idx').on(table.analysisId),
    uniqueChunkIdx: uniqueIndex('code_chunks_analysis_file_chunk_unique').on(
      table.analysisId,
      table.filePath,
      table.chunkIndex
    ),
  })
);

export const repositoryExecutions = pgTable(
  'repository_executions',
  {
    id: serial('id').primaryKey(),
    repositoryId: integer('repository_id')
      .notNull()
      .references(() => repositories.id, { onDelete: 'cascade' }),
    analysisId: integer('analysis_id')
      .references(() => analyses.id, { onDelete: 'set null' }),
    executionId: text('execution_id').notNull(),
    profile: text('profile').notNull(),
    status: text('status').notNull(),
    exitCode: integer('exit_code'),
    durationMs: integer('duration_ms').notNull().default(0),
    refusalReason: text('refusal_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (table) => ({
    execIdIdx: uniqueIndex('repository_executions_execution_id_unique').on(table.executionId),
    repoIdx: index('repository_executions_repo_idx').on(table.repositoryId),
  })
);

export type RepositoryRecord = typeof repositories.$inferSelect;
export type InsertRepositoryRecord = typeof repositories.$inferInsert;
export type AnalysisRecord = typeof analyses.$inferSelect;
export type InsertAnalysisRecord = typeof analyses.$inferInsert;
export type AIExplanationRecord = typeof aiExplanations.$inferSelect;
export type InsertAIExplanationRecord = typeof aiExplanations.$inferInsert;
export type CodeChunkRecord = typeof codeChunks.$inferSelect;
export type InsertCodeChunkRecord = typeof codeChunks.$inferInsert;
export type RepositoryExecutionRecord = typeof repositoryExecutions.$inferSelect;
export type InsertRepositoryExecutionRecord = typeof repositoryExecutions.$inferInsert;
