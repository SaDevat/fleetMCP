# fleetmcp — Real-World Use Cases

> **fleetmcp** is the missing CLI for the Model Context Protocol ecosystem. It lets you inspect, call, test, and aggregate MCP servers directly from your terminal — no LLM required.

---

## Who is this for?

| Role | Pain Point | fleetmcp solves it with |
|------|-----------|---------------------|
| **Agent Builder** | "My tool schema is wrong but I can't see what the server actually exposes" | `fleetmcp inspect` |
| **Power User** | "I want to use GitHub/Slack/Maps MCP tools without opening Claude or Cursor" | `fleetmcp call` |
| **Infra Engineer** | "I need to validate MCP compliance before deploying to production" | `fleetmcp test --ci` |
| **Team Lead** | "We have 5 MCP servers and need a single endpoint for our agent" | `fleetmcp proxy` |

---

## Scenario 1: Debugging Your Custom MCP Server

You've built an MCP server that wraps your company's internal API. Your agent keeps failing to call the `search_customers` tool. Is the schema wrong? Is the server even responding?

```sh
# Step 1: Register your server
fleetmcp config add my-api -t stdio -c node -a "dist/server.js"

# Step 2: Inspect — see exactly what tools the server exposes
fleetmcp inspect my-api

# Output:
# ╭ Identity ──────────────────────────────────╮
# │ Server:  my-company-api (v2.1.0)           │
# │ Protocol: 2025-11-25                       │
# │ Capabilities: tools (list, call)           │
# ╰────────────────────────────────────────────╯
# Tools (3)
# ├── search_customers
# │   Search customers by name or email
# ├── get_order
# │   Retrieve order details by ID
# └── create_ticket
#     Create a support ticket

# Step 3: Drill into the exact schema of the problematic tool
fleetmcp inspect my-api --filter search_customers --verbose

# Step 4: Call it manually to see the raw response
fleetmcp call my-api search_customers query="john@example.com"

# Step 5: Run compliance checks
fleetmcp test my-api
```

**What you learn:** The exact input schema, whether required fields are marked correctly, and whether the server handles edge cases (empty args, unknown tools) gracefully.

---

## Scenario 2: Using MCP Tools Directly from the Terminal

You want to check the weather, geocode an address, or search GitHub — all from your terminal, without opening an LLM chat.

```sh
# Register public MCP servers
fleetmcp config add everything -t stdio -c npx -a "-y @modelcontextprotocol/server-everything"
fleetmcp config add github -t stdio -c npx -a "-y @modelcontextprotocol/server-github"

# Call tools directly — fleetmcp is the cURL for MCP
fleetmcp call github search_repositories query="mcp server language:typescript"
fleetmcp call everything echo message="hello from the terminal"
fleetmcp call everything get-sum a=42 b=58

# Pipe JSON into a tool
echo '{"message": "piped data"}' | fleetmcp call everything echo

# Use --raw to prevent number coercion (keeps "007" as a string)
fleetmcp call my-api get_order id=007 --raw
```

**Why this matters:** You can prototype MCP tool integrations, test edge cases, and build shell scripts around MCP servers without any LLM overhead.

---

## Scenario 3: MCP Compliance Testing in CI/CD

You maintain an MCP server and need to ensure every PR passes compliance checks before merging.

```sh
# In your CI pipeline (GitHub Actions, GitLab CI, etc.)
fleetmcp config add my-server -t stdio -c node -a "dist/server.js"
fleetmcp test my-server --ci
```

The `--ci` flag exits with code 4 if any check fails — perfect for CI gates.

**The 5-check compliance suite:**

| Check | What it validates |
|-------|-------------------|
| Connection handshake | Can the client connect and complete the MCP initialize? |
| Tools list | Can we enumerate all tools? (with pagination) |
| Schema integrity | Do all tools have valid `inputSchema` with `type: "object"`? |
| Error resilience | Do tools handle empty/missing args without crashing? |
| Unknown tool rejection | Does the server properly reject calls to nonexistent tools? |

**GitHub Actions example:**

```yaml
# .github/workflows/mcp-compliance.yml
name: MCP Compliance
on: [push, pull_request]
jobs:
  compliance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: npm install -g fleetmcp
      - run: fleetmcp config add server -t stdio -c node -a "dist/server.js"
      - run: fleetmcp test server --ci
```

**Exit codes reference:**

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Usage/config error |
| 2 | Connection failure |
| 3 | Tool execution error |
| 4 | Test failure (--ci mode) |
| 130 | Interrupted (Ctrl+C) |

---

## Scenario 4: Importing Configs from Claude Desktop or Cursor

You already have 10 MCP servers configured in Claude Desktop. Instead of re-entering them one by one:

```sh
# Import from Claude Desktop
fleetmcp config import ~/Library/Application\ Support/Claude/claude_desktop_config.json

# Import from Cursor
fleetmcp config import ~/.cursor/mcp.json

# Verify everything imported
fleetmcp config list

# Output:
# ┌──┬────────────────┬────────┬──────────────────────────────────────────┐
# │  │ Alias          │ Type   │ Connection                               │
# ├──┼────────────────┼────────┼──────────────────────────────────────────┤
# │ ● │ github         │ stdio  │ npx -y @modelcontextprotocol/server-...  │
# │ ● │ filesystem     │ stdio  │ npx -y @modelcontextprotocol/server-...  │
# │ ● │ slack          │ stdio  │ npx -y @modelcontextprotocol/server-...  │
# │ ● │ postgres       │ stdio  │ npx -y @modelcontextprotocol/server-...  │
# └──┴────────────────┴────────┴──────────────────────────────────────────┘

# Export back to Cursor format
fleetmcp config export --format cursor > ~/.cursor/mcp.json
```

**Health dots:** The `●` indicators show whether each server's command binary is found on your PATH (green = found, yellow = not found, gray = HTTP server).

---

## Scenario 5: Aggregating Multiple Servers with the Proxy

Your agent needs tools from GitHub, Slack, and your internal API — but it can only connect to one MCP endpoint. The proxy merges them all under a single URL with namespaced tools.

```sh
# Register your servers
fleetmcp config add github -t stdio -c npx -a "-y @modelcontextprotocol/server-github"
fleetmcp config add slack -t stdio -c npx -a "-y @modelcontextprotocol/server-slack"
fleetmcp config add internal -t stdio -c node -a "./dist/server.js"

# Start the proxy — aggregates all registered servers
fleetmcp proxy --port 4390

# Output:
# ✔ Connected to 3 server(s), 25 tool(s) available
# Proxy listening on http://localhost:4390/mcp
#
#   github_search_repositories → github/search_repositories
#   github_create_issue → github/create_issue
#   slack_send_message → slack/send_message
#   slack_list_channels → slack/list_channels
#   internal_search_customers → internal/search_customers
#   ...
```

Now point your agent at `http://localhost:4390/mcp` — it sees all 25 tools as one server.

**Every call is logged to SQLite** at `~/.fleetmcp/logs.db` with:
- Timestamp, alias, tool name
- Full request/response payloads
- Duration (ms)
- Estimated token counts (request + response)

**Health endpoint:** `curl http://localhost:4390/` returns:
```json
{
  "name": "fleetmcp-proxy",
  "version": "1.0.0",
  "tools": 25,
  "servers": 3,
  "sessions": 2,
  "endpoint": "/mcp",
  "totalRequests": 142,
  "estimatedTokens": { "request": 35000, "response": 89000 }
}
```

---

## Scenario 6: Shell Scripting with MCP Tools

Combine fleetmcp with standard Unix tools for powerful automation:

```sh
# Pipe a JSON file into a tool
cat customer_query.json | fleetmcp call internal search_customers

# Chain tool calls
fleetmcp call github search_repositories query="mcp" \
  | jq -r '.items[0].full_name' \
  | xargs -I {} fleetmcp call github get_repository repo={}

# Batch test all your servers
for server in $(fleetmcp config list 2>/dev/null | grep stdio | awk '{print $2}'); do
  echo "Testing $server..."
  fleetmcp test "$server" --ci && echo "  PASS" || echo "  FAIL"
done

# Use with a timeout for flaky servers
fleetmcp call slow-server expensive_query input="big data" --timeout 120000
```

---

## Quick Reference

```sh
# Config
fleetmcp config add <alias> -t stdio -c <cmd> -a "<args>"
fleetmcp config add <alias> -t http -u <url>
fleetmcp config list
fleetmcp config remove <alias>
fleetmcp config import <path>
fleetmcp config export --format cursor

# Inspect
fleetmcp inspect <alias|url>
fleetmcp inspect <alias> --filter <query>
fleetmcp inspect <alias> --verbose

# Call
fleetmcp call <alias> <tool> key=value ...
fleetmcp call <alias> <tool> '{"json": "args"}'
echo '{}' | fleetmcp call <alias> <tool>
fleetmcp call <alias> <tool> --raw --timeout 120000

# Test
fleetmcp test <alias>
fleetmcp test <alias> --ci

# Proxy
fleetmcp proxy
fleetmcp proxy --port 8080
```
