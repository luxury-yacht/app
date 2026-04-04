---
name: feedback_skill_naming
description: Always check for naming conflicts with existing plugin skills before creating custom skills
type: feedback
---

When creating custom skills in `.claude/skills/`, always check that the name doesn't conflict with existing plugin-provided slash commands. A custom skill with the same name as a plugin skill creates a direct conflict.

**Why:** Created a `/release-notes` skill that conflicted with the superpowers plugin's existing `/release-notes` command. User rightly called this out as an obvious mistake.

**How to apply:** Before naming a skill, check the available skills list (visible in system reminders) for conflicts. Use a distinctive name that won't collide — e.g., prefix with the project's domain or use a more specific verb (`draft-release-notes` instead of `release-notes`).
