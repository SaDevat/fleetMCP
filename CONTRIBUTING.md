# Contributing to FleetMCP

Development workflow, conventions, and how changes land.

---

## Setup

**Prerequisites:** [Bun](https://bun.sh) ≥ 1.1

```sh
git clone https://github.com/SaDevat/fleetMCP.git
cd fleetMCP
bun install

bun run typecheck
bun run src/index.ts --help
```

---

## Workflow — trunk-based

`main` is always releasable. Work happens on **short-lived branches** off `main`, merged fast and deleted. No long-running `develop` or `release` branches.

```sh
git switch -c fix/issue-2-session-reaping
# ... work, commit ...
gh pr create --title "fix: reap proxy sessions on close and idle" --body "Closes #2"
gh pr merge --squash --delete-branch
```

If a branch lives long enough to drift, rebase it onto `main` rather than merging `main` into it.

### Branch names — [Conventional Branch](https://conventionalbranch.org/)

```
<type>/<description>
```

| Type | For |
|---|---|
| `feature/` or `feat/` | new features |
| `bugfix/` or `fix/` | bug fixes |
| `hotfix/` | urgent production fixes |
| `release/` | release preparation |
| `chore/` | non-code tasks |

**Rules:** lowercase `a–z`, digits, and hyphens only. No underscores, spaces, or special characters. Dots only in `release/` branches for version numbers. No leading, trailing, or consecutive hyphens/dots. Issue numbers are encouraged — `fix/issue-2-session-reaping`.

---

## Commits — [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/)

```
<type>[(scope)][!]: <description>

[body]

[footers]
```

### Choosing the type

Walk this table top-down and take the **first** Yes:

| # | Question | Type |
|---|---|---|
| 1 | Fixes a bug? | `fix` |
| 2 | New or changed feature in API/UI? | `feat` |
| 3 | Performance improvement? | `perf` |
| 4 | Code restructuring without behaviour change? | `refactor` |
| 5 | Formatting/whitespace only? | `style` |
| 6 | Tests added or corrected? | `test` |
| 7 | Documentation only? | `docs` |
| 8 | Build tools, dependencies, versions? | `build` |
| 9 | DevOps, infrastructure, CI/CD? | `ops` |
| 10 | Anything else | `chore` |

`chore` is the fallback of last resort, **not** the lazy default. If you reach for it, re-walk the table.

### Rules

- **Description:** imperative present tense — "change", not "changed" or "changes". Lowercase. No trailing period.
- **Scope:** a noun naming a section of the codebase — `fix(proxy):`, `feat(config):`. **Never an issue number.**
- **Breaking changes:** `!` before the colon *and* a `BREAKING CHANGE:` footer. `BREAKING CHANGE` is the only case-sensitive part of the spec.
- **Footers:** `token: value` or `token #value`. Multi-word tokens hyphenate — `Reviewed-by:`.

```
fix(proxy)!: reap sessions on close and idle

The session map grew for the process lifetime. transport.onclose now
removes the entry; a 30-minute idle sweep covers clients that vanish
without sending DELETE.

BREAKING CHANGE: sessions idle beyond 30 minutes are terminated and
clients must re-initialize.
Closes #2
```

### One PR, several issues

`Closes` footers may repeat. A PR that legitimately resolves more than one issue closes them all:

```
Closes #2
Closes #3
```

Only do this when the changes genuinely belong in one reviewable unit. Splitting stays the default.

---

## Code conventions

### Bun-native only

| Instead of | Use |
|---|---|
| `fs.readFile` / `fs.writeFile` | `Bun.file()` / `Bun.write()` |
| `better-sqlite3` | `bun:sqlite` |
| `dotenv` | Bun auto-loads `.env` |
| `express` | `Bun.serve()` |

### TypeScript

`tsconfig.json` enforces `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, and `verbatimModuleSyntax`. `bun run typecheck` must be clean before a PR.

### Command structure

One file per command under `src/cli/`, each exporting a `commander` `Command`. Every command:

1. Follows the SIGINT-safe cleanup pattern — `cleanup()`, a SIGINT listener, and `process.removeListener` in `finally`
2. Uses the canonical exit codes: `0` success · `1` config/usage · `2` connection · `3` tool error · `4` CI test failure · `130` SIGINT
3. Stops its `ora` spinner on **every** exit path

Formatters go in `src/formatters/` and return strings — no `console.log`. Pure helpers go in `src/utils/`.

---

## Testing

```sh
bun run typecheck
bun test                                        # unit + integration
cd dry-run-testing-suite && bash dry-run.sh     # 28 end-user simulation tests
```

Non-trivial logic ships with **one runnable check** — the smallest thing that fails if the logic breaks. A test that cannot fail is not a test; disable your fix and confirm the check goes red before you trust it.

---

## Pull requests

1. **One concern per PR.** Bug fix, feature, or refactor — not all three.
2. **Typecheck clean**, `bun test` green, dry-run suite green.
3. **No new dependencies** without discussion. The list is deliberately short.
4. **Update `README.md`** if command behaviour changes — including the Limitations section.
5. **Squash-merge** and delete the branch.

---

## Layout

```
src/cli/        one file per command
src/core/       MCP client lifecycle, transport factory, config I/O
src/formatters/ output rendering
src/types/      Zod schemas
src/utils/      pure helpers, brand system
test/           echo server, integration and regression tests
```

---

## Reporting issues

Include the exact command, full terminal output, `bun --version`, and your OS.
