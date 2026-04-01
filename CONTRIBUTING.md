# Contributing to MemRosetta

Thank you for your interest in contributing. This guide covers everything you need to get started.

## Prerequisites

- Node.js 22+
- pnpm

## Setup

```bash
git clone https://github.com/obst2580/memrosetta.git
cd memrosetta
pnpm install
pnpm build
pnpm test
```

## Development Workflow

1. Create a branch from `main`.
2. Make your changes.
3. Run checks before submitting:
   ```bash
   pnpm typecheck && pnpm test
   ```
4. Open a pull request against `main`.

## Commit Conventions

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` -- new feature
- `fix:` -- bug fix
- `refactor:` -- code restructuring with no behavior change
- `docs:` -- documentation only
- `test:` -- adding or updating tests
- `chore:` -- maintenance tasks (deps, CI, tooling)

## Project Structure

```
packages/
  api/          -- REST API server
  cli/          -- command-line interface
  core/         -- core memory engine
  embeddings/   -- embedding model integration
  llm/          -- LLM integration
  memrosetta/   -- global install wrapper package
  types/        -- shared TypeScript types

adapters/
  claude-code/  -- Claude Code hook integration
  mcp/          -- Model Context Protocol server
  obsidian/     -- Obsidian plugin
```

## Code Style

- No emojis in code, comments, or documentation.
- Prefer immutability -- do not mutate objects or arrays.
- Keep files small (200-400 lines preferred, 800 max).

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
