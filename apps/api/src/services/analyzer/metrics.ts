import type { StructuralMetrics, FileCategory } from '@archlens/shared';
import type { RawGitTreeItem } from '../github.service.js';
import { categorizePath } from './categorizer.js';

const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TypeScript',
  mts: 'TypeScript',
  cts: 'TypeScript',
  js: 'JavaScript',
  jsx: 'JavaScript',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  py: 'Python',
  go: 'Go',
  rs: 'Rust',
  java: 'Java',
  kt: 'Kotlin',
  kts: 'Kotlin',
  scala: 'Scala',
  c: 'C',
  h: 'C',
  cpp: 'C++',
  hpp: 'C++',
  cc: 'C++',
  cs: 'C#',
  rb: 'Ruby',
  php: 'PHP',
  swift: 'Swift',
  dart: 'Dart',
  html: 'HTML',
  htm: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  sass: 'SCSS',
  less: 'Less',
  json: 'JSON',
  yaml: 'YAML',
  yml: 'YAML',
  toml: 'TOML',
  md: 'Markdown',
  markdown: 'Markdown',
  sql: 'SQL',
  sh: 'Shell',
  bash: 'Shell',
  vue: 'Vue',
  svelte: 'Svelte',
};

export function calculateMetrics(tree: RawGitTreeItem[]): StructuralMetrics {
  const files = tree.filter((item) => item.type === 'blob');
  const totalFiles = files.length;
  const totalBytes = files.reduce((sum, item) => sum + (item.size || 0), 0);

  const languageStats: Record<string, { bytes: number; fileCount: number }> = {};
  const categoryStats: Record<FileCategory, { bytes: number; fileCount: number }> = {
    source: { bytes: 0, fileCount: 0 },
    test: { bytes: 0, fileCount: 0 },
    config: { bytes: 0, fileCount: 0 },
    doc: { bytes: 0, fileCount: 0 },
    asset: { bytes: 0, fileCount: 0 },
    ci: { bytes: 0, fileCount: 0 },
    other: { bytes: 0, fileCount: 0 },
  };

  for (const file of files) {
    const size = file.size || 0;
    const ext = file.path.includes('.') ? file.path.split('.').pop()?.toLowerCase() || '' : '';

    const lang = EXTENSION_TO_LANGUAGE[ext];
    if (lang) {
      if (!languageStats[lang]) {
        languageStats[lang] = { bytes: 0, fileCount: 0 };
      }
      languageStats[lang].bytes += size;
      languageStats[lang].fileCount += 1;
    }

    const category = categorizePath(file.path);
    if (!categoryStats[category]) {
      categoryStats[category] = { bytes: 0, fileCount: 0 };
    }
    categoryStats[category].bytes += size;
    categoryStats[category].fileCount += 1;
  }

  // Convert to percentage records
  const languages: StructuralMetrics['languages'] = {};
  for (const [lang, stat] of Object.entries(languageStats)) {
    const percentage = totalBytes > 0 ? Math.round((stat.bytes / totalBytes) * 1000) / 10 : 0;
    languages[lang] = {
      bytes: stat.bytes,
      percentage,
      fileCount: stat.fileCount,
    };
  }

  const categories: StructuralMetrics['categories'] = {};
  for (const [cat, stat] of Object.entries(categoryStats)) {
    if (stat.fileCount > 0) {
      const percentage = totalBytes > 0 ? Math.round((stat.bytes / totalBytes) * 1000) / 10 : 0;
      categories[cat] = {
        bytes: stat.bytes,
        percentage,
        fileCount: stat.fileCount,
      };
    }
  }

  // Largest files (top 10)
  const sortedFiles = [...files]
    .sort((a, b) => (b.size || 0) - (a.size || 0))
    .slice(0, 10)
    .map((f) => ({
      path: f.path,
      size: f.size || 0,
    }));

  return {
    totalFiles,
    totalBytes,
    languages,
    categories,
    largestFiles: sortedFiles,
  };
}
