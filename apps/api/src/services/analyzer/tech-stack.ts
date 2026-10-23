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
  { pkg: 'koa', name: 'Koa', category: 'framework' },

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
  { pkg: 'zod', name: 'Zod', category: 'runtime' },

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

const PYTHON_PACKAGES: Record<string, { name: string; category: TechStackDetection['category'] }> = {
  fastapi: { name: 'FastAPI', category: 'framework' },
  django: { name: 'Django', category: 'framework' },
  flask: { name: 'Flask', category: 'framework' },
  tornado: { name: 'Tornado', category: 'framework' },
  sanic: { name: 'Sanic', category: 'framework' },
  starlette: { name: 'Starlette', category: 'framework' },
  litestar: { name: 'Litestar', category: 'framework' },
  sqlalchemy: { name: 'SQLAlchemy', category: 'database' },
  alembic: { name: 'Alembic', category: 'database' },
  psycopg2: { name: 'psycopg2', category: 'database' },
  asyncpg: { name: 'asyncpg', category: 'database' },
  pytest: { name: 'Pytest', category: 'testing' },
  celery: { name: 'Celery', category: 'runtime' },
  pydantic: { name: 'Pydantic', category: 'runtime' },
  uvicorn: { name: 'Uvicorn', category: 'runtime' },
  gunicorn: { name: 'Gunicorn', category: 'runtime' },
  redis: { name: 'Redis', category: 'database' },
};

const RUST_CRATES: Record<string, { name: string; category: TechStackDetection['category'] }> = {
  'actix-web': { name: 'Actix Web', category: 'framework' },
  axum: { name: 'Axum', category: 'framework' },
  rocket: { name: 'Rocket', category: 'framework' },
  tokio: { name: 'Tokio', category: 'runtime' },
  'async-std': { name: 'async-std', category: 'runtime' },
  diesel: { name: 'Diesel', category: 'database' },
  sqlx: { name: 'SQLx', category: 'database' },
  serde: { name: 'Serde', category: 'build' },
  clap: { name: 'Clap', category: 'build' },
};

const GO_MODULES: Record<string, { name: string; category: TechStackDetection['category'] }> = {
  'github.com/gin-gonic/gin': { name: 'Gin', category: 'framework' },
  'github.com/labstack/echo': { name: 'Echo', category: 'framework' },
  'gorm.io/gorm': { name: 'GORM', category: 'database' },
  'github.com/gorilla/mux': { name: 'Gorilla Mux', category: 'framework' },
  'github.com/go-chi/chi': { name: 'Chi', category: 'framework' },
  'github.com/spf13/cobra': { name: 'Cobra', category: 'framework' },
};

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

  for (const [filePath, content] of Object.entries(manifestContents)) {
    // 1. package.json (root and workspace packages)
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
        // invalid JSON ignored
      }
    }

    // 2. Cargo.toml (root and workspace crates)
    if (filePath.endsWith('Cargo.toml')) {
      addDetection({
        category: 'language',
        name: 'Rust',
        version: null,
        confidence: 'high',
        evidence: filePath,
      });

      // Parse Cargo.toml dependencies line-by-line
      const lines = content.split('\n');
      let inDeps = false;
      for (const line of lines) {
        const trimmed = line.trim();
        if (
          trimmed.startsWith('[dependencies]') ||
          trimmed.startsWith('[workspace.dependencies]') ||
          trimmed.startsWith('[dev-dependencies]')
        ) {
          inDeps = true;
          continue;
        } else if (trimmed.startsWith('[') && inDeps) {
          inDeps = false;
        }

        if (inDeps && trimmed.length > 0 && !trimmed.startsWith('#')) {
          const match = trimmed.match(/^([a-zA-Z0-9_-]+)\s*=\s*(.*)$/);
          if (match) {
            const crate = match[1].toLowerCase();
            const val = match[2];
            let version: string | null = null;
            const versionMatch = val.match(/["']([0-9a-zA-Z._-]+)["']/);
            if (versionMatch) {
              version = versionMatch[1];
            }

            if (crate in RUST_CRATES) {
              const def = RUST_CRATES[crate];
              addDetection({
                category: def.category,
                name: def.name,
                version,
                confidence: 'high',
                evidence: `${filePath} -> ${crate} (${version || 'unspecified'})`,
              });
            }
          }
        }
      }
    }

    // 3. go.mod
    if (filePath.endsWith('go.mod')) {
      addDetection({
        category: 'language',
        name: 'Go',
        version: null,
        confidence: 'high',
        evidence: filePath,
      });

      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        for (const [modPrefix, def] of Object.entries(GO_MODULES)) {
          if (trimmed.includes(modPrefix)) {
            const parts = trimmed.split(/\s+/);
            const version = parts.find((p) => /^v\d+/.test(p)) || null;
            addDetection({
              category: def.category,
              name: def.name,
              version: version ? version.replace(/^v/, '') : null,
              confidence: 'high',
              evidence: `${filePath} -> ${def.name} (${version || 'unspecified'})`,
            });
          }
        }
      }
    }

    // 4. Python requirements.txt
    if (filePath.endsWith('requirements.txt')) {
      addDetection({
        category: 'language',
        name: 'Python',
        version: null,
        confidence: 'high',
        evidence: filePath,
      });

      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const match = trimmed.match(/^([a-zA-Z0-9_-]+)(?:([=~><!@].*))?$/);
        if (match) {
          const pkg = match[1].toLowerCase();
          const rawVersion = match[2] ? match[2].replace(/^[=~><!@\s]+/, '').trim() : null;

          if (pkg in PYTHON_PACKAGES) {
            const def = PYTHON_PACKAGES[pkg];
            addDetection({
              category: def.category,
              name: def.name,
              version: rawVersion,
              confidence: 'high',
              evidence: `${filePath} -> ${pkg} (${rawVersion || 'unspecified'})`,
            });
          }
        }
      }
    }

    // 5. Python pyproject.toml
    if (filePath.endsWith('pyproject.toml')) {
      addDetection({
        category: 'language',
        name: 'Python',
        version: null,
        confidence: 'high',
        evidence: filePath,
      });

      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        for (const [pkg, def] of Object.entries(PYTHON_PACKAGES)) {
          // Exact package spec match: "fastapi>=0.100.0" or fastapi = "^0.100.0"
          const regex = new RegExp(`(?:^|[\\s"',\\[])${pkg}(?:[=~><!@\\s"',\\]]|$)`, 'i');
          if (regex.test(trimmed)) {
            const versionMatch = trimmed.match(/[=~><^]*\s*([0-9]+\.[0-9]+(?:\.[0-9a-zA-Z]+)?)/);
            const version = versionMatch ? versionMatch[1] : null;

            addDetection({
              category: def.category,
              name: def.name,
              version,
              confidence: 'high',
              evidence: `${filePath} -> ${pkg} (${version || 'unspecified'})`,
            });
          }
        }
      }
    }

    // 6. Java pom.xml
    if (filePath.endsWith('pom.xml')) {
      addDetection({
        category: 'language',
        name: 'Java',
        version: null,
        confidence: 'high',
        evidence: filePath,
      });

      if (content.includes('spring-boot')) {
        addDetection({
          category: 'framework',
          name: 'Spring Boot',
          version: null,
          confidence: 'high',
          evidence: `${filePath} -> spring-boot`,
        });
      }
      if (content.includes('quarkus')) {
        addDetection({
          category: 'framework',
          name: 'Quarkus',
          version: null,
          confidence: 'high',
          evidence: `${filePath} -> quarkus`,
        });
      }
      if (content.includes('junit')) {
        addDetection({
          category: 'testing',
          name: 'JUnit',
          version: null,
          confidence: 'high',
          evidence: `${filePath} -> junit`,
        });
      }
    }

    // 7. Gradle build.gradle / build.gradle.kts
    if (filePath.endsWith('build.gradle') || filePath.endsWith('build.gradle.kts')) {
      addDetection({
        category: 'language',
        name: 'Java',
        version: null,
        confidence: 'high',
        evidence: filePath,
      });

      if (content.includes('spring-boot') || content.includes('org.springframework.boot')) {
        addDetection({
          category: 'framework',
          name: 'Spring Boot',
          version: null,
          confidence: 'high',
          evidence: `${filePath} -> spring-boot`,
        });
      }
    }

    // 8. Dockerfile
    if (filePath.endsWith('Dockerfile') || filePath.includes('Dockerfile')) {
      addDetection({
        category: 'build',
        name: 'Docker',
        version: null,
        confidence: 'high',
        evidence: filePath,
      });

      const fromMatch = content.match(/FROM\s+([a-zA-Z0-9_./-]+)(?::([a-zA-Z0-9_.-]+))?/i);
      if (fromMatch) {
        const image = fromMatch[1].toLowerCase();
        const tag = fromMatch[2] || null;

        if (image.includes('node')) {
          addDetection({
            category: 'runtime',
            name: 'Node.js',
            version: tag,
            confidence: 'high',
            evidence: `${filePath} -> FROM ${fromMatch[0]}`,
          });
        } else if (image.includes('python')) {
          addDetection({
            category: 'runtime',
            name: 'Python',
            version: tag,
            confidence: 'high',
            evidence: `${filePath} -> FROM ${fromMatch[0]}`,
          });
        } else if (image.includes('golang') || image.includes('go')) {
          addDetection({
            category: 'runtime',
            name: 'Go',
            version: tag,
            confidence: 'high',
            evidence: `${filePath} -> FROM ${fromMatch[0]}`,
          });
        }
      }
    }
  }

  // 9. Tree-level detections (CI, Docker Compose, monorepo tools)
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
      evidence: 'docker-compose configuration detected',
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

  if (paths.some((p) => p === 'turbo.json')) {
    addDetection({
      category: 'build',
      name: 'Turborepo',
      version: null,
      confidence: 'high',
      evidence: 'turbo.json',
    });
  }

  // Fallback language detections from file extensions
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
