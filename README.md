# mcpx

**The missing CLI for the MCP ecosystem.**

`mcpx` is a developer tool for working with [Model Context Protocol](https://modelcontextprotocol.io) servers directly from the terminal — no LLM required. Inspect, call, test, and proxy MCP servers with a single binary.

```
mcpx config add my-server -c npx -a "-y @modelcontextprotocol/server-filesystem /tmp"
mcpx inspect my-server
mcpx call my-server list_directory path=/tmp
mcpx test my-server
mcpx proxy my-server
```

---

## Features

| Command | What it does |
|---------|-------------|
| `mcpx config` | Manage your server registry (`~/.mcpx/config.yml`) |
| `mcpx inspect` | Explore a server's tools, resources, prompts, and schemas |
| `mcpx call` | Invoke any MCP tool — the cURL for MCP |
| `mcpx test` | Run a 5-check compliance suite against a server |
| `mcpx proxy` | Aggregate multiple servers under one namespace with SQLite logging |

---

## Installation

**Prerequisites:** [Bun](https://bun.sh) ≥ 1.1

```bash
# Clone and install
git clone https://github.com/sdevat/mcpx.git
cd mcpx
bun install

# Run directly
bun run src/index.ts config list

# Or link globally
bun link
mcpx config list
```

---

## Quick Start

### 1. Register a server

```bash
# stdio server (command + args)
mcpx config add filesystem -c npx -a "-y @modelcontextprotocol/server-filesystem /tmp"

# HTTP / SSE server
mcpx config add my-remote -t http -u https://my-mcp-server.example.com/mcp

# View the registry
mcpx config list
```

### 2. Inspect what's available

```bash
mcpx inspect filesystem
mcpx inspect filesystem --filter read
mcpx inspect filesystem --verbose
```

Outputs: server identity, protocol version, capabilities, full tool list with schema summaries and usage examples, resources, resource templates, and prompts.

### 3. Call a tool

```bash
# key=value pairs (smart coercion: numbers, booleans, null)
mcpx call filesystem list_directory path=/tmp

# JSON blob
mcpx call filesystem read_file '{"path":"/tmp/hello.txt"}'

# Piped stdin
echo '{"path":"/tmp/hello.txt"}' | mcpx call filesystem read_file

# --raw keeps all values as strings (for IDs like "007")
mcpx call my-server get_item id=007 --raw

# Override timeout
mcpx call my-server slow_tool --timeout 120000
```

### 4. Test a server for compliance

```bash
mcpx test filesystem

# CI mode — exits 4 on any failure
mcpx test filesystem --ci
```

Runs 5 checks: connection handshake, tools list, schema integrity, error resilience, unknown tool rejection.

### 5. Proxy multiple servers

```bash
# Start a proxy that aggregates all registered servers
mcpx proxy --all

# Proxy a single server
mcpx proxy filesystem

# Access logs are stored in SQLite
bun test/verify-logs.ts --alias filesystem
```

The proxy namespaces tools as `<alias>_<toolName>` and logs every request/response to `~/.mcpx/logs.db`.

---

## Config File

`mcpx` stores server definitions in `~/.mcpx/config.yml`:

```yaml
version: 1
servers:
  filesystem:
    type: stdio
    command: npx
    args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    env: {}
  my-remote:
    type: http
    url: https://my-mcp-server.example.com/mcp
    headers: {}
```

### Import from Claude Desktop / Cursor

```bash
# Import mcpServers block from Claude Desktop config
mcpx config import ~/Library/Application\ Support/Claude/claude_desktop_config.json

# Import from Cursor settings
mcpx config import ~/.cursor/mcp.json
```

### Export back

```bash
# Claude Desktop format (default)
mcpx config export > ~/Library/Application\ Support/Claude/claude_desktop_config.json

# Cursor format
mcpx config export --format cursor > ~/.cursor/mcp.json
```

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Configuration / usage error |
| 2 | Connection / handshake failure |
| 3 | Tool execution error |
| 4 | Test failure (CI mode) |
| 130 | Interrupted (Ctrl+C) |

---

## Development

```bash
# Install deps
bun install

# Type check (strict)
bun run typecheck

# Run a command directly
bun run src/index.ts <command> [args]

# Run with file watcher
bun --watch src/index.ts <command>
```

### Running the echo test server

```bash
# Register
mcpx config add dummy -c bun -a "test/echo-server.ts"

# Test all commands
mcpx inspect dummy
mcpx call dummy echo text=hello
mcpx test dummy
```

---

## Architecture

```
src/
  cli/          # Commander command definitions (one file per command)
    config.ts   # mcpx config — list, add, remove, import, export
    inspect.ts  # mcpx inspect — server observability
    call.ts     # mcpx call — tool invocation
    test.ts     # mcpx test — compliance checks
    proxy.ts    # mcpx proxy — aggregating proxy with logging
  core/
    client.ts   # createMcpClient factory
    transport.ts  # TransportFactory (stdio / http)
    config.ts   # getConfig / saveConfig (YAML, Bun.file)
  formatters/
    json.ts     # prettyJson with chalk highlighting
    table.ts    # renderToolsTable
    tree.ts     # renderCapabilityTree
  types/
    config.ts   # Zod schemas: ServerConfig, McpxConfig
    results.ts  # CheckResult, TestResult, ProxyLogEntry
  utils/
    error.ts    # die() helper
    fuzzy.ts    # zero-dep fuzzy scorer
    schema.ts   # summarizeSchema, buildUsageExample
    stdin.ts    # readStdin with FIFO detection
```

---

## License

MIT
