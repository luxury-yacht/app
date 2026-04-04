---
name: project_refresh_fragility
description: The refresh/streaming subsystem is fragile and historically breaks when modified — treat with extreme care
type: project
---

The refresh code (catalog streaming, sync pipeline, orchestrator) is very complex and has a history of breaking in hard-to-fix ways when modified.

**Why:** Past changes to this subsystem have caused regressions that were difficult to diagnose and repair.

**How to apply:** When touching refresh-related code, prefer additive changes over modifications. Keep existing behavior as a safety net. Feature-flag new behavior. Run all tests. Be extra cautious with this area.
