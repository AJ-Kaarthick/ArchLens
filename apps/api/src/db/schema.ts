import { pgTable, serial, text, integer, timestamp, jsonb, uniqueIndex } from 'drizzle-orm/pg-core';
import type {
  TechStackDetection,
  ArchitectureOverview,
  StructuralMetrics,
  FileTreeItem,
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

export type RepositoryRecord = typeof repositories.$inferSelect;
export type InsertRepositoryRecord = typeof repositories.$inferInsert;
export type AnalysisRecord = typeof analyses.$inferSelect;
export type InsertAnalysisRecord = typeof analyses.$inferInsert;
