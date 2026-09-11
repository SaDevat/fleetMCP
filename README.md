# FleetMCP

**One config, one endpoint, all your MCP servers, always warm.**

`fleetmcp` is a workflow tool for people who run *many* [Model Context Protocol](https://modelcontextprotocol.io) servers every day. It keeps a single unified registry that imports and exports Claude Desktop and Cursor formats, and runs a personal aggregating proxy that namespaces every server behind one endpoint — holding them warm so the spawn and handshake cost is paid once instead of on every call.

Inspectors debug *a* server. FleetMCP operates *your fleet*.

```sh
fleetmcp config import ~/.cursor/mcp.json     # bring your existing servers
fleetmcp proxy --port 4390                    # one endpoint, all of them, warm
```

Point any MCP client at `http://localhost:4390/mcp` and it sees every tool from every server.

---

## Commands

| Command | What it does |
|---------|-------------|
| `fleetmcp config` | Unified registry (`~/.fleetmcp/config.yml`) — add, list, remove, check, import, export |
| `fleetmcp proxy` | Aggregate every registered server behind one endpoint, with SQLite request logging |
| `fleetmcp inspect` | Explore a server's tools, resources, prompts, and schemas |
| `fleetmcp call` | Invoke any MCP tool — the cURL for MCP |
| `fleetmcp test` | 5-check compliance smoke test, with CI exit codes |

---

## Installation

**Prerequisites:** [Bun](https://bun.sh) ≥ 1.1

```sh
git clone https://github.com/sdevat/fleetmcp.git
cd fleetmcp
bun install

# Run directly
bun run src/index.ts config list

# Or link globally
bun link
fleetmcp config list
```

> Binary releases and a Homebrew tap are planned. FleetMCP uses Bun-native APIs
> (`Bun.serve`, `bun:sqlite`), so it does not run under Node — `bun build --compile`
> will ship a self-contained binary instead.

---

## The fleet workflow

### 1. Bring your servers in

```sh
# Import an existing config wholesale
fleetmcp config import ~/Library/Application\ Support/Claude/claude_desktop_config.json
fleetmcp config import ~/.cursor/mcp.json

# Or add them one at a time
fleetmcp config add filesystem -c npx -a "-y @modelcontextprotocol/server-filesystem /tmp"
fleetmcp config add my-remote -t http -u https://my-mcp-server.example.com/mcp

fleetmcp config list
```

`config list` shows a health dot per server: green if the command binary resolves
on your PATH, yellow if it does not, grey for HTTP servers.

Secrets use `${VAR}` interpolation from the environment rather than being written
to the config file. `fleetmcp config check` reports any that fail to resolve.

```yaml
# ~/.fleetmcp/config.yml
version: 1
servers:
  github:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-github"]
    env:
      GITHUB_TOKEN: ${GITHUB_TOKEN}
```

### 2. Run the fleet behind one endpoint

```sh
fleetmcp proxy              # defaults to port 4390
fleetmcp proxy --port 8080
```

Every registered server is connected once at startup and held open. Tools are
namespaced `<alias>_<toolName>` so collisions between servers are impossible —
`github_search_repositories`, `filesystem_read_file`, and so on.

Point a client at `http://localhost:4390/mcp`, or drive it with FleetMCP itself:

```sh
fleetmcp config add fleet -t http -u http://localhost:4390/mcp
fleetmcp inspect fleet
fleetmcp call fleet filesystem_read_file path=/tmp/notes.txt
```

`GET /` returns proxy health, connected server count, aggregate tool count, and
estimated token totals. Every request and response is logged to
`~/.fleetmcp/logs.db`.

### 3. Inspect and call individual servers

```sh
fleetmcp inspect filesystem
fleetmcp inspect filesystem --filter read      # fuzzy search tools
fleetmcp inspect filesystem --verbose          # full input schemas
fleetmcp inspect https://example.com/mcp       # URLs work too, no registration

fleetmcp call filesystem list_directory path=/tmp
fleetmcp call filesystem read_file '{"path":"/tmp/hello.txt"}'
echo '{"path":"/tmp/hello.txt"}' | fleetmcp call filesystem read_file

fleetmcp call my-server get_item id=007 --raw            # keep "007" a string
fleetmcp call my-server slow_tool --timeout 120000
```

### 4. Smoke-test a server

```sh
fleetmcp test filesystem
fleetmcp test filesystem --ci      # exits 4 on any failure
```

Five checks: connection handshake, tools list, schema integrity, error
resilience on empty args, and unknown-tool rejection. This is a fast smoke test,
not a full conformance suite — see *Limitations*.

---

## Exit codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Configuration / usage error |
| 2 | Connection / handshake failure |
| 3 | Tool execution error |
| 4 | Test failure (CI mode) |
| 130 | Interrupted (Ctrl+C) |

---

## Limitations

Known and honest, as of v0.1.0:

- **Resource subscriptions are not forwarded.** The proxy exposes resources and
  prompts, but `subscribe` and `listChanged` are not passed through to
  sub-servers, so you will not get change notifications.
- **Aggregate lists are not paginated.** A `list` request returns everything from
  every server in one response. Fine for a personal fleet, not for thousands.
- **Auth is static only.** Bearer tokens and headers via `${VAR}` interpolation
  work; OAuth is not implemented.
- **Bun-only.** Bun-native APIs mean this will not run under Node today.
- **Protocol 2025-11-25.** Newer spec revisions are not yet adopted.

FleetMCP does not try to compete with the official
[MCP Inspector](https://github.com/modelcontextprotocol/inspector) or
[MCPJam](https://github.com/MCPJam/inspector) on depth of inspection or
conformance testing — both go further there. The wedge here is fleet operation:
unified config and a warm aggregating endpoint.

---

## Development

```sh
bun install
bun run typecheck
bun run src/index.ts <command> [args]
bun --watch src/index.ts <command>
```

A minimal echo server is included for testing:

```sh
fleetmcp config add dummy -c bun -a "test/echo-server.ts"
fleetmcp inspect dummy
fleetmcp call dummy echo text=hello
fleetmcp test dummy
```

### Layout

```
src/
  cli/          # one file per command
    config.ts   # registry: add, list, remove, check, import, export
    inspect.ts  # server observability
    call.ts     # tool invocation
    test.ts     # compliance checks
    proxy.ts    # aggregating proxy with SQLite logging
  core/
    client.ts     # createMcpClient factory, protocol version capture
    transport.ts  # stdio / Streamable HTTP / SSE fallback
    config.ts     # YAML persistence, ${VAR} interpolation
  formatters/     # json, table, tree renderers
  types/          # Zod schemas
  utils/          # brand system, errors, fuzzy match, schema summaries
```

---

## License

MIT
