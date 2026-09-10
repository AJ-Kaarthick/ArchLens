# Technical Decisions

1. **pnpm workspaces over Turborepo**: Start simple. Turborepo can be added later if build orchestration complexity demands it.
2. **PostgreSQL Structured Retrieval over Pinecone/Qdrant**: Avoid premature vector DBs and external cloud dependencies. Use structured relational and JSONB schemas first, then evaluate `pgvector` for Phase 4.
3. **Deterministic Foundation Before AI**: Establishing verifiable repository facts (manifests, patterns, metrics) first prevents LLM hallucination and grounds any future AI explanations in actual code structure.
4. **No Blind Cloning**: Repository ingestion must be fast, bounded, and bandwidth-efficient, relying on GitHub REST APIs and metadata trees rather than cloning gigabytes of git history.
5. **Bounded Execution Guardrails**: Hard limits (10,000 tree items, 256 KB landmark previews) protect server memory and enforce predictable synchronous performance without requiring complex background queue infrastructure in early phases.
6. **No Auth Yet**: Deferred until persistent user-account features (e.g. personal bookmarking, saved notes) require it.
7. **Provider-Agnostic AI (Phase 3)**: Crucial for open-source self-hosting and avoiding vendor lock-in across Gemini, OpenAI, and Anthropic.
