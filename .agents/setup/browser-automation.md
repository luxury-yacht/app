# Browser Automation

This playbook applies to every agent performing rendered inspection of the local
Wails development UI.

## Required Workflow

- Use a directly registered Playwright MCP server when the runtime exposes one.
  Start with the navigation tool, then use snapshots, DOM-based interaction, and
  screenshots as appropriate. Common tool names are
  `mcp__playwright__browser_navigate`,
  `mcp__playwright__browser_snapshot`,
  `mcp__playwright__browser_click`, `mcp__playwright__browser_find`, and
  `mcp__playwright__browser_take_screenshot`.
- Do not route Wails UI checks through an unrelated browser integration that
  cannot access the registered Playwright server.
- Use snapshots and DOM inspection for structure and interaction. Use
  screenshots for layout and visual checks.
- Before reporting that browser control is unavailable, inspect the runtime's
  active tools and registered MCP servers. Report the exact discovery check and
  its result.

## Development Server

1. Use the active Wails development-server URL supplied for the run.
2. Confirm that the URL responds before browser work because Wails may choose a
   different port on a later run.
3. If no server is running, start one with `mise exec -- wails3 task dev`, wait for the
   command to report its active URL, and use that URL.
4. Ask the user for the URL only when a development process is already running
   and its URL cannot be determined. Do not ask the user for screenshots while
   the UI is locally reachable.
5. Exercise relevant loading, error, empty, populated, navigation, filter, and
   interaction states in proportion to the change.

## Runtime Discovery

### Codex CLI

1. Check the active tool list for `mcp__playwright__browser_navigate`, then run
   `codex mcp list`.
2. The global server is named `playwright`. Use the executable path reported by
   `codex mcp list`; do not assume a user-specific installation directory.
3. Do not infer standalone Playwright availability from the Browser plugin,
   `agent.browsers`, or `node_repl`; those integrations use separate discovery.
4. If the server is enabled but the direct tools are absent in an already-running
   Codex session, restart Codex CLI once so it can load them. Do not reinstall
   packages for this case.

### Other Agent Runtimes

Use the runtime's MCP server listing or tool-discovery mechanism. Select the
directly registered Playwright tools rather than an unrelated browser plugin.
If the runtime uses different tool names, use the equivalent navigation,
snapshot, DOM-interaction, and screenshot operations.

## Repair

Repair a machine-wide installation only when the Playwright server registration
is missing or its command path no longer exists. Obtain authorization before
changing machine-wide state unless the user already requested the repair.

For Codex CLI repair, use stable `playwright` and `@playwright/mcp` versions
compatible with the installed Codex CLI, then register the resulting absolute
command with `codex mcp add playwright -- ...`.
