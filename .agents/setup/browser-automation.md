# Browser Automation

This playbook applies to every agent performing rendered inspection of the
Luxury Yacht UI.

## What a Browser Can Reach

- `mise exec -- wails3 dev` runs the app in a native window (WKWebView on
  macOS). The webview loads the app through Wails' in-process `wails://` scheme. The
  backend's `/api/v2` routes, binding calls, and named streams are served
  inside the app process; the app opens no TCP listener for them.
- The URL `wails3 dev` prints is the Vite server (`http://127.0.0.1:9245`
  unless `WAILS_VITE_PORT` is set). It serves frontend assets only: the app
  proxies asset requests to Vite, and Vite proxies nothing back. In a browser
  on that URL, `GET /api/v2/...` and stream polls return Vite's `index.html`,
  and binding calls return `404`.
- So no view that needs backend data, a binding, or a stream works in a
  browser on the Vite URL. Do not use Playwright or any other browser on it as
  evidence for app views, and do not report it as a rendered app check.

## What to Use

- Component visuals and interaction: Storybook
  (`mise exec -- npm run storybook --prefix frontend`, port 6006). Stories
  pass fixture data instead of backend responses. A story is a browser
  preview, not native-app evidence.
- Backend-backed views: the native app window, driven through the Wails MCP
  server below.
- Native OS behavior (window placement, native drag, native menus, OS focus):
  the MCP server cannot exercise it. Ask the user to run the check, or record
  it as blocked under the
  [completion evidence gate](../../docs/workflows/completion.md).

## Native App Through the Wails MCP Server

Wails compiles an MCP server into the app when the `mcp` build tag is set. It
drives the real WKWebView window. Builds without the tag do not contain it.

1. Ask the user which cluster the app may reach. Launching reconnects the
   clusters saved as selected in the app's settings, and the app keeps a live
   connection while you work.
2. Start the app with the tag and a fresh random bearer token (for example
   from `openssl rand -hex 24`):

   ```sh
   EXTRA_TAGS=mcp WAILS_MCP_TOKEN=<token> mise exec -- wails3 dev
   ```

   The log reports `MCP server started` with
   `url=http://127.0.0.1:9099/mcp`. Without a token, any local process can
   call the server, including `js_eval`.
3. Connect a client. The server speaks MCP over streamable HTTP.
   - Claude Code:

     ```sh
     claude mcp add --transport http --scope local ly-app \
       http://127.0.0.1:9099/mcp --header "Authorization: Bearer <token>"
     ```

     New sessions, including `claude -p`, load it, with tools named
     `mcp__ly-app__<tool>`. The token is stored in `~/.claude.json`, so run
     `claude mcp remove ly-app -s local` when done.
   - Codex: pass the server for a single run instead of using
     `codex mcp add`. Add and remove rewrite other servers' entries in
     `~/.codex/config.toml`.

     ```sh
     LY_APP_MCP_TOKEN=<token> codex exec \
       -c 'mcp_servers.ly_app.url="http://127.0.0.1:9099/mcp"' \
       -c 'mcp_servers.ly_app.bearer_token_env_var="LY_APP_MCP_TOKEN"' \
       -c 'mcp_servers.ly_app.tools.dom_query.approval_mode="approve"' '<task>'
     ```

     Add an `approval_mode` override for each tool the run uses.
   - Any shell: POST JSON-RPC (`initialize`, `tools/list`, `tools/call`) to
     the URL with `curl` and the same `Authorization` header.
4. Read and drive the window with the tools:
   - `dom_query`: element text, classes, bounds, and visibility by CSS
     selector;
   - `mouse_click`, `keyboard_type`, `keyboard_press`;
   - `screenshot_dom`: a structural outline, not pixels;
   - `js_eval`, `windows_list`, `window_control`.

   Input is synthetic DOM events dispatched in the page (`isTrusted` is
   false), not OS input.
5. For pixel screenshots, use `screencapture -x -o -l <CGWindowID>`. Get the
   ID from `CGWindowListCopyWindowInfo` (owner `Luxury Yacht`). The MCP
   animated cursor is drawn in the page and shows in screenshots. Add
   `WAILS_MCP_HIDE_CURSOR=1` to the launch command to keep it out.
6. Treat object actions (delete, scale, restart, drain, edit, shell) and
   `call_bound_method` as cluster writes: get the user's approval first.
7. When done, `window_control` with `action: close` quits the app. Confirm
   that `wails3 dev` and Vite have exited. `bin/luxury-yacht` and
   `bin/Luxury Yacht.dev.app` keep the `mcp` tag until the next build, so do
   not launch them directly.

## Playwright for Browser Pages

These rules apply to pages a browser can fully render, such as Storybook.

- Use a directly registered Playwright MCP server, starting with its navigation
  tool (commonly `mcp__playwright__browser_navigate`, then `browser_snapshot`,
  `browser_click`, `browser_find`, `browser_take_screenshot`). If the runtime
  names them differently, use the equivalent navigation, snapshot,
  DOM-interaction, and screenshot operations.
- Do not route these checks through an unrelated browser plugin that cannot
  reach the registered Playwright server.
- Use snapshots and DOM inspection for structure and interaction; use
  screenshots for layout and visual checks.
- Before reporting browser control unavailable, inspect the runtime's active
  tools and registered MCP servers, and report the exact discovery check and
  result.

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
