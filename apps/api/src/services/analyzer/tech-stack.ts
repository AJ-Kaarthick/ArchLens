import type { TechStackDetection } from '@archlens/shared';
import type { RawGitTreeItem } from '../github.service.js';

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const JS_PACKAGES: Array<{
  pkg: string;
  name: string;
  category: TechStackDetection['category'];
}> = [
  // Frameworks
  { pkg: 'react', name: 'React', category: 'framework' },
  { pkg: 'react-dom', name: 'React DOM', category: 'framework' },
  { pkg: 'next', name: 'Next.js', category: 'framework' },
  { pkg: 'vue', name: 'Vue.js', category: 'framework' },
  { pkg: 'nuxt', name: 'Nuxt', category: 'framework' },
  { pkg: 'svelte', name: 'Svelte', category: 'framework' },
  { pkg: '@sveltejs/kit', name: 'SvelteKit', category: 'framework' },
  { pkg: '@angular/core', name: 'Angular', category: 'framework' },
  { pkg: 'express', name: 'Express', category: 'framework' },
  { pkg: 'fastify', name: 'Fastify', category: 'framework' },
  { pkg: '@nestjs/core', name: 'NestJS', category: 'framework' },
  { pkg: '@remix-run/react', name: 'Remix', category: 'framework' },
  { pkg: 'astro', name: 'Astro', category: 'framework' },
  { pkg: 'hono', name: 'Hono', category: 'framework' },

  // Styling
  { pkg: 'tailwindcss', name: 'Tailwind CSS', category: 'styling' },
  { pkg: 'styled-components', name: 'Styled Components', category: 'styling' },
  { pkg: '@emotion/react', name: 'Emotion', category: 'styling' },
  { pkg: 'sass', name: 'Sass', category: 'styling' },
  { pkg: 'postcss', name: 'PostCSS', category: 'styling' },

  // Testing
  { pkg: 'vitest', name: 'Vitest', category: 'testing' },
  { pkg: 'jest', name: 'Jest', category: 'testing' },
  { pkg: 'cypress', name: 'Cypress', category: 'testing' },
  { pkg: '@playwright/test', name: 'Playwright', category: 'testing' },
  { pkg: 'mocha', name: 'Mocha', category: 'testing' },

  // Build & Tooling
  { pkg: 'vite', name: 'Vite', category: 'build' },
  { pkg: 'webpack', name: 'Webpack', category: 'build' },
  { pkg: 'rollup', name: 'Rollup', category: 'build' },
  { pkg: 'esbuild', name: 'esbuild', category: 'build' },
  { pkg: 'tsup', name: 'tsup', category: 'build' },
  { pkg: 'turbo', name: 'Turborepo', category: 'build' },
  { pkg: 'nx', name: 'Nx', category: 'build' },
  { pkg: 'eslint', name: 'ESLint', category: 'build' },
  { pkg: 'prettier', name: 'Prettier', category: 'build' },

  // Runtime / Languages
  { pkg: 'typescript', name: 'TypeScript', category: 'runtime' },
  { pkg: 'tsx', name: 'TSX', category: 'runtime' },

  // Database
  { pkg: 'drizzle-orm', name: 'Drizzle ORM', category: 'database' },
  { pkg: '@prisma/client', name: 'Prisma', category: 'database' },
  { pkg: 'prisma', name: 'Prisma CLI', category: 'database' },
  { pkg: 'typeorm', name: 'TypeORM', category: 'database' },
  { pkg: 'mongoose', name: 'Mongoose', category: 'database' },
  { pkg: 'pg', name: 'node-postgres', category: 'database' },
  { pkg: 'postgres', name: 'postgres.js', category: 'database' },
  { pkg: 'mysql2', name: 'MySQL', category: 'database' },
  { pkg: 'redis', name: 'Redis', category: 'database' },
  { pkg: 'ioredis', name: 'ioRedis', category: 'database' },
];

export function detectTechStack(
  tree: RawGitTreeItem[],
  manifestContents: Record<string, string> = {}
): TechStackDetection[] {
  const detections: TechStackDetection[] = [];
  const added = new Set<string>();

  const addDetection = (det: TechStackDetection) => {
    const key = `${det.category}:${det.name.toLowerCase()}`;
    if (!added.has(key)) {
      added.add(key);
      detections.push(det);
    }
  };

  // 1. Inspect package.json (root or package manifests)
  for (const [filePath, content] of Object.entries(manifestContents)) {
    if (filePath.endsWith('package.json')) {
      try {
        const pkgJson: PackageJson = JSON.parse(content);
        const allDeps = {
          ...pkgJson.dependencies,
          ...pkgJson.devDependencies,
          ...pkgJson.peerDependencies,
        };

        for (const item of JS_PACKAGES) {
          if (item.pkg in allDeps) {
            const rawVersion = allDeps[item.pkg] || null;
            const cleanVersion = rawVersion ? rawVersion.replace(/[\^~>=<]/g, '').trim() : null;

            addDetection({
              category: item.category,
              name: item.name,
              version: cleanVersion,
              confidence: 'high',
              evidence: `${filePath} -> ${item.pkg} (${rawVersion || 'unspecified'})`,
            });
          }
        }
      } catch {
        // invalid JSON
      }
    }

    // 2. Cargo.toml
    if (filePath.endsWith('Cargo.toml')) {
      addDetection({
        category: 'language',
        name: 'Rust',
        version: null,
        confidence: 'high',
        evidence: `${filePath}`,
      });

      if (content.includes('actix-web')) {
        addDetection({
          category: 'framework',
          name: 'Actix Web',
          version: null,
          confidence: 'high',
          evidence: `${filePath} -> actix-web`,
        });
      }
      if (content.includes('axum')) {
        addDetection({
          category: 'framework',
          name: 'Axum',
          version: null,
          confidence: 'high',
          evidence: `${filePath} -> axum`,
        });
      }
      if (content.includes('tokio')) {
        addDetection({
          category: 'runtime',
          name: 'Tokio',
          version: null,
          confidence: 'high',
          evidence: `${filePath} -> tokio`,
        });
      }
      if (content.includes('diesel')) {
        addDetection({
          category: 'database',
          name: 'Diesel',
          version: null,
          confidence: 'high',
          evidence: `${filePath} -> diesel`,
        });
      }
    }

    // 3. go.mod
    if (filePath.endsWith('go.mod')) {
      addDetection({
        category: 'language',
        name: 'Go',
        version: null,
        confidence: 'high',
        evidence: `${filePath}`,
      });

      if (content.includes('github.com/gin-gonic/gin')) {
        addDetection({
          category: 'framework',
          name: 'Gin',
          version: null,
          confidence: 'high',
          evidence: `${filePath} -> gin`,
        });
      }
      if (content.includes('github.com/labstack/echo')) {
        addDetection({
          category: 'framework',
          name: 'Echo',
          version: null,
          confidence: 'high',
          evidence: `${filePath} -> echo`,
        });
      }
      if (content.includes('gorm.io/gorm')) {
        addDetection({
          category: 'database',
          name: 'GORM',
          version: null,
          confidence: 'high',
          evidence: `${filePath} -> gorm`,
        });
      }
    }

    // 4. pyproject.toml / requirements.txt
    if (filePath.endsWith('pyproject.toml') || filePath.endsWith('requirements.txt')) {
      addDetection({
        category: 'language',
        name: 'Python',
        version: null,
        confidence: 'high',
        evidence: `${filePath}`,
      });

      if (/fastapi/i.test(content)) {
        addDetection({
          category: 'framework',
          name: 'FastAPI',
          version: null,
          confidence: 'high',
          evidence: `${filePath} -> fastapi`,
        });
      }
      if (/django/i.test(content)) {
        addDetection({
          category: 'framework',
          name: 'Django',
          version: null,
          confidence: 'high',
          evidence: `${filePath} -> django`,
        });
      }
      if (/flask/i.test(content)) {
        addDetection({
          category: 'framework',
          name: 'Flask',
          version: null,
          confidence: 'high',
          evidence: `${filePath} -> flask`,
        });
      }
      if (/pytest/i.test(content)) {
        addDetection({
          category: 'testing',
          name: 'Pytest',
          version: null,
          confidence: 'high',
          evidence: `${filePath} -> pytest`,
        });
      }
    }
  }

  // 5. Tree-level detections (CI, Docker, monorepo, files)
  const paths = tree.map((t) => t.path);

  if (paths.some((p) => p.startsWith('.github/workflows/'))) {
    addDetection({
      category: 'ci',
      name: 'GitHub Actions',
      version: null,
      confidence: 'high',
      evidence: '.github/workflows/',
    });
  }

  if (paths.some((p) => /(^|\/)docker-compose(\.[a-zA-Z0-9]+)?\.ya?ml$/i.test(p))) {
    addDetection({
      category: 'build',
      name: 'Docker Compose',
      version: null,
      confidence: 'high',
      evidence: 'docker-compose file detected',
    });
  }

  if (paths.some((p) => /(^|\/)Dockerfile$/i.test(p))) {
    addDetection({
      category: 'build',
      name: 'Docker',
      version: null,
      confidence: 'high',
      evidence: 'Dockerfile detected',
    });
  }

  if (paths.some((p) => p === 'pnpm-workspace.yaml')) {
    addDetection({
      category: 'build',
      name: 'pnpm workspaces',
      version: null,
      confidence: 'high',
      evidence: 'pnpm-workspace.yaml',
    });
  }

  // Language detections from file extensions if not already detected
  const extCounts: Record<string, number> = {};
  for (const item of tree) {
    if (item.type === 'blob') {
      const ext = item.path.split('.').pop()?.toLowerCase() || '';
      extCounts[ext] = (extCounts[ext] || 0) + 1;
    }
  }

  if ((extCounts['ts'] || 0) + (extCounts['tsx'] || 0) > 0) {
    addDetection({
      category: 'language',
      name: 'TypeScript',
      version: null,
      confidence: 'high',
      evidence: `Found ${(extCounts['ts'] || 0) + (extCounts['tsx'] || 0)} TypeScript files`,
    });
  }

  if ((extCounts['js'] || 0) + (extCounts['jsx'] || 0) > 0 && !added.has('language:javascript')) {
    addDetection({
      category: 'language',
      name: 'JavaScript',
      version: null,
      confidence: 'high',
      evidence: `Found ${(extCounts['js'] || 0) + (extCounts['jsx'] || 0)} JavaScript files`,
    });
  }

  if ((extCounts['py'] || 0) > 0 && !added.has('language:python')) {
    addDetection({
      category: 'language',
      name: 'Python',
      version: null,
      confidence: 'high',
      evidence: `Found ${extCounts['py']} Python files`,
    });
  }

  if ((extCounts['go'] || 0) > 0 && !added.has('language:go')) {
    addDetection({
      category: 'language',
      name: 'Go',
      version: null,
      confidence: 'high',
      evidence: `Found ${extCounts['go']} Go files`,
    });
  }

  if ((extCounts['rs'] || 0) > 0 && !added.has('language:rust')) {
    addDetection({
      category: 'language',
      name: 'Rust',
      version: null,
      confidence: 'high',
      evidence: `Found ${extCounts['rs']} Rust files`,
    });
  }

  return detections;
}
