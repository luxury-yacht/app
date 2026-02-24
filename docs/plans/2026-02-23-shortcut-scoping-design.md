# Shortcut Scoping Fix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make interactive cell content (buttons, links, inputs) safe from GridTable
shortcut interception by default, without requiring column authors to opt out.

**Architecture:** Fix `isInputElement` in the shared shortcut utils so the
`data-allow-shortcuts="true"` ancestor bypass does not override truly interactive
elements. The direct attribute opt-in (element itself carries the attribute) is
preserved. No changes to GridTable handlers.

**Tech Stack:** React, TypeScript, vitest

---

## Context

### The bug

`GridTableBody.tsx` sets `data-allow-shortcuts="true"` on `.gridtable-wrapper`.
In `isInputElement()` (`ui/shortcuts/utils.ts`), any element with a
`data-allow-shortcuts="true"` ancestor is unconditionally treated as "not an
input." This means buttons, links, and inputs inside grid cells have bare
keystrokes (Enter, Space, arrows) intercepted by GridTable shortcuts.

### How `isInputElement` works (current)

```
1. Direct attribute check: element.getAttribute('data-allow-shortcuts') === 'true' -> return false
2. Ancestor check: element.closest('[data-allow-shortcuts="true"]') -> return false
3. Tag/contentEditable/CodeMirror checks -> return true/false
```

Step 2 is the problem: it bypasses interactive elements unconditionally.

### How the shortcut dispatch uses `isInputElement`

In `ui/shortcuts/context.tsx`, the global `handleKeyDown` listener calls
`isInputElement(event.target)`. If it returns `true` and no modifier keys are
held, the event is not dispatched to any shortcut handler (bare keys bail).
If it returns `false`, shortcuts fire normally.

### Two consumers of `data-allow-shortcuts="true"`

1. **GridTable** (`GridTableBody.tsx:171`): on `.gridtable-wrapper` div (ancestor)
2. **Dropdown** (`Dropdown.tsx:305,312,364,376`): on containers AND directly on
   the search `<input>` element

The fix must preserve Dropdown's behavior — its search input has the attribute
directly, so the step-1 direct check catches it before step 2.

---

### Task 1: Write failing tests for interactive elements inside `data-allow-shortcuts` containers

**Files:**
- Modify: `frontend/src/ui/shortcuts/utils.test.ts`

**Step 1: Add new tests**

Add a new `describe` block after the existing tests (after line 88). These tests
will fail because `isInputElement` currently returns `false` for all elements
inside a `data-allow-shortcuts` container.

Tests to add:
- `returns true for a button inside a data-allow-shortcuts container`
- `returns true for an input inside a data-allow-shortcuts container`
- `returns true for a link inside a data-allow-shortcuts container`
- `returns true for a span nested inside a button inside the container` (verifies `.closest()` catches nested elements)
- `returns true for a contenteditable inside a data-allow-shortcuts container`
- `returns true for a role="textbox" inside a data-allow-shortcuts container`
- `returns false for a plain div inside a data-allow-shortcuts container`
- `returns false for a button with direct data-allow-shortcuts="true"` (Dropdown pattern preserved)

Use a `wrapInAllowShortcuts` helper that creates a container div with
`data-allow-shortcuts="true"`, appends the child, and appends to `document.body`.
Clean up DOM in `afterEach`.

**Step 2: Run tests to verify they fail**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx vitest run src/ui/shortcuts/utils.test.ts`

Expected: 6 of the 8 new tests FAIL (the button/input/link/span/contenteditable/
role="textbox" tests). The plain-div and direct-attribute tests should PASS
(they match current behavior).

---

### Task 2: Implement the interactive element guard in `isInputElement`

**Files:**
- Modify: `frontend/src/ui/shortcuts/utils.ts:62-94`

**Step 1: Add the interactive element selector constant**

Add this constant before `isInputElement` (after line 60, before line 62):

```typescript
// Selector for elements with their own keyboard interaction.
// Used to protect interactive elements inside data-allow-shortcuts containers
// from having bare keystrokes intercepted by shortcut handlers.
const INTERACTIVE_ELEMENT_SELECTOR = [
  'input',
  'textarea',
  'select',
  'button',
  'summary',
  'a[href]',
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
  '[role="textbox"]',
  '[role="button"]',
].join(', ');
```

**Step 2: Modify the ancestor bypass to check the interactive selector**

Replace lines 82-84 (the ancestor `.closest()` block):

Old:
```typescript
    if (element.closest('[data-allow-shortcuts="true"]')) {
      return false;
    }
```

New:
```typescript
    if (element.closest('[data-allow-shortcuts="true"]')) {
      // The ancestor opted in to shortcuts, but interactive elements inside
      // should still be protected from bare-key interception. The direct
      // attribute check above already handles elements that explicitly opt in.
      if (element.closest(INTERACTIVE_ELEMENT_SELECTOR)) {
        return true;
      }
      return false;
    }
```

**Step 3: Run tests to verify they pass**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx vitest run src/ui/shortcuts/utils.test.ts`

Expected: ALL tests pass (existing + new).

**Step 4: Run full verification**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx tsc --noEmit`
Expected: Clean.

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx eslint src/ui/shortcuts/utils.ts`
Expected: Clean.

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx vitest run`
Expected: All 219 test files pass.
