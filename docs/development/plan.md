# Refresh HTTP Server Optimization Plan

Goal: capture potential optimization/refactor opportunities for the backend refresh HTTP server.

Plan:
- [ ] Decide which server-level timeouts to add (e.g., ReadHeaderTimeout, MaxHeaderBytes) while avoiding Write/Idle timeouts that would break long-lived streams. Impact: medium (hardens against slow headers). Effort: low.
- ✅ Centralize route wiring into a helper (e.g., new mux builder) to reduce duplication between `backend/refresh/system/manager.go` and `backend/app_refresh_setup.go`. Impact: low/medium (simpler maintenance, fewer drift risks). Effort: medium.
- ✅ Split `setupRefreshSubsystem` into smaller helpers (build subsystem, build mux, start server) to improve readability and testability. Impact: medium (clearer control flow, easier tests). Effort: medium.
- [ ] Wire `http.Server.ErrorLog` to the app logger for consistent error reporting. Impact: low (better visibility into server errors). Effort: low.
- [ ] Use `net.JoinHostPort` (or similar) when constructing `refreshBaseURL` to handle IPv6-friendly formatting if listener behavior changes in the future. Impact: low (future-proof URL formatting). Effort: low.

Notes:
- Streaming endpoints (`/api/v2/stream/*`) rely on long-lived connections; timeouts must be chosen carefully to avoid unintended disconnects.
