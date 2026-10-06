# Browser Automation

This playbook applies to every agent performing rendered inspection of the local
Wails development UI.

## Required Workflow

- Use a directly registered Playwright MCP server, starting with its navigation
  tool (commonly `mcp__playwright__browser_navigate`, then `browser_snapshot`,
  `browser_click`, `browser_find`, `browser_take_screenshot`). If the runtime
  names them differently, use the equivalent navigation, snapshot,
  DOM-interaction, and screenshot operations.
- Do not route Wails UI checks through an unrelated browser plugin that cannot
  reach the registered Playwright server.
- Use snapshots and DOM inspection for structure and interaction; use
  screenshots for layout and visual checks.
- Before reporting browser control unavailable, inspect the runtime's active
  tools and registered MCP servers, and report the exact discovery check and
  result.

## Development Server

1. Use the active Wails development-server URL supplied for the run, and
   confirm it responds first: Wails may choose a different port on a later run.
2. If no server is running, start one with `mise exec -- wails3 dev`, wait
   for it to report its active URL, and use that URL.
3. Ask the user for the URL only when a development process is already running
   and its URL cannot be determined. Do not ask for screenshots while the UI is
   locally reachable.

## Codex CLI

1. Check the active tool list for `mcp__playwright__browser_navigate`, then run
   `codex mcp list`. The global server is named `playwright`; use the
   executable path that command reports, not an assumed user-specific
   directory.
2. Do not infer standalone Playwright availability from the Browser plugin,
   `agent.browsers`, or `node_repl`; those use separate discovery.
3. If the server is enabled but its tools are absent in a running session,
   restart Codex CLI once to load them; do not reinstall packages.

## Repair

Repair a machine-wide installation only when the Playwright server registration
is missing or its command path no longer exists, and obtain authorization first
unless the user already requested the repair. For Codex CLI, use stable
`playwright` and `@playwright/mcp` versions compatible with the installed Codex
CLI, then register the absolute command with `codex mcp add playwright -- ...`.
