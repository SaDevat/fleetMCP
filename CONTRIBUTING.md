# Contributing to fleetmcp

Thanks for your interest in contributing! This document covers the development workflow, code conventions, and how to submit changes.

---

## Development Setup

**Prerequisites:** [Bun](https://bun.sh) ≥ 1.1, TypeScript 5+

```bash
git clone https://github.com/sdevat/fleetmcp.git
cd fleetmcp
bun install
```

Verify everything is working:

```bash
bun run typecheck
bun run src/index.ts --help
```

---

## Code Conventions

### Bun-native only

This project uses Bun APIs exclusively. Do not introduce Node.js-only APIs when a Bun equivalent exists:

| Instead of | Use |
|------------|-----|
| `fs.readFile` / `fs.writeFile` | `Bun.file()` / `Bun.write()` |
| `better-sqlite3` | `bun:sqlite` |
| `dotenv` | Bun auto-loads `.env` |
| `node:child_process` | Only when unavoidable via MCP SDK |

### TypeScript strictness

The `tsconfig.json` enforces:
- `exactOptionalPropertyTypes: true` — never use `key?: T` when you mean `key?: T | undefined`
- `noUncheckedIndexedAccess: true` — array/record access returns `T | undefined`
- `verbatimModuleSyntax: true` — use `import type` for type-only imports

Run `bun run typecheck` and fix all errors before opening a PR.

### Command structure

Each command lives in its own file under `src/cli/`. All commands must:

1. Export a `Command` from `commander`
2. Follow the **SIGINT-safe cleanup pattern**:
   ```typescript
   let client: ... | undefined;
   async function cleanup() { ... }
   const onSigint = async () => { await cleanup(); process.exit(130); };
   process.on("SIGINT", onSigint);
   try { ... } catch { ... } finally { process.removeListener("SIGINT", onSigint); }
   ```
3. Use the canonical **exit codes**: 0 success, 1 config, 2 connection, 3 tool error, 4 CI test failure, 130 SIGINT
4. Stop the `ora` spinner in **all** exit paths (success, error, SIGINT)

### Formatters and utilities

- Add new formatters to `src/formatters/`
- Add new pure utilities to `src/utils/`
- Keep formatters free of side effects (return strings, don't `console.log`)

---

## Testing

There is no automated test suite yet (tracked in issues). For now, smoke-test your changes manually with the echo server:

```bash
# Register the echo server
bun run src/index.ts config add dummy -c bun -a "test/echo-server.ts"

# Smoke test all five commands
bun run src/index.ts inspect dummy
bun run src/index.ts call dummy echo text=hello
bun run src/index.ts test dummy
bun run src/index.ts config list
```

Verify the proxy logs:

```bash
# In one terminal
bun run src/index.ts proxy dummy &

# In another terminal (using the proxied namespace)
# then check logs:
bun test/verify-logs.ts --alias dummy
```

---

## Pull Request Guidelines

1. **One concern per PR** — bug fix, feature, or refactor. Not all three.
2. **Typecheck must pass** — `bun run typecheck` with zero errors.
3. **No new dependencies** without discussion — the dependency list is intentionally minimal.
4. **Update README.md** if you add or change command behavior.
5. **Conventional commit messages** preferred: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`

---

## Project Layout

```
src/cli/        Command files (config, inspect, call, test, proxy)
src/core/       MCP client lifecycle and config I/O
src/formatters/ Output rendering helpers
src/types/      Zod schemas and TypeScript interfaces
src/utils/      Pure utility functions
test/           Manual test helpers and echo server
```

---

## Reporting Issues

Open an issue on GitHub with:
- The exact command you ran
- The full terminal output (including errors)
- Your Bun version (`bun --version`) and OS
