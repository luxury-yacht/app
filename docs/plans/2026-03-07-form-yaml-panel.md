# Form + YAML Panel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show the form and YAML editor simultaneously via a slide-in YAML panel that overlays or sits beside the form modal.

**Architecture:** The YAML panel is a sibling element to the modal container, rendered inside the same `.modal-overlay`. It positions itself to the right of the form modal. At narrow viewports it overlaps the form; at wide viewports the form shifts left so both are fully visible. The panel slides in/out with a CSS transition using existing motion tokens.

**Tech Stack:** React, CSS transitions, CodeMirror (@uiw/react-codemirror), existing CSS tokens (motion, elevation, spacing)

**Design doc:** `docs/plans/2026-03-07-form-yaml-panel-design.md`

---

### Task 1: Add YAML panel state and toggle button

**Files:**
- Modify: `frontend/src/ui/modals/CreateResourceModal.tsx`

**Step 1: Add panel visibility state**

Add after `activeView` state (line 301):

```tsx
// YAML panel visibility. Hidden by default; toggled via "Show/Hide YAML" button.
const [yamlPanelOpen, setYamlPanelOpen] = useState(false);
const [yamlPanelClosing, setYamlPanelClosing] = useState(false);
```

Add a close handler near the other handlers:

```tsx
/** Close the YAML panel with exit animation. */
const handleYamlPanelClose = useCallback(() => {
  setYamlPanelClosing(true);
  setTimeout(() => {
    setYamlPanelOpen(false);
    setYamlPanelClosing(false);
  }, 300);
}, []);
```

**Step 2: Replace the toggle button**

Replace the existing toggle button (lines 546-554) with two buttons:

```tsx
<button
  type="button"
  className="button generic create-resource-view-toggle"
  onClick={() => setActiveView((prev) => (prev === 'form' ? 'yaml' : 'form'))}
  disabled={!canShowForm}
  data-create-resource-focusable="true"
>
  {showingForm ? 'Show YAML' : 'Show Form'}
</button>
<button
  type="button"
  className="button generic create-resource-view-toggle"
  onClick={() => {
    if (yamlPanelOpen) {
      handleYamlPanelClose();
    } else {
      setYamlPanelOpen(true);
    }
  }}
  data-create-resource-focusable="true"
>
  {yamlPanelOpen ? 'Hide YAML' : 'Show YAML'}
</button>
```

**Step 3: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: PASS (state is declared but panel JSX not yet rendered)

**Step 4: Commit**

```
feat: add YAML panel state and toggle button
```

---

### Task 2: Render the YAML panel

**Files:**
- Modify: `frontend/src/ui/modals/CreateResourceModal.tsx`

**Step 1: Add YAML panel JSX**

After the `.modal-container` closing `</div>` (but still inside `.modal-overlay`), add the panel:

```tsx
{/* YAML side panel */}
{yamlPanelOpen && (
  <div
    className={`yaml-panel ${yamlPanelClosing ? 'closing' : 'opening'}`}
  >
    <div className="yaml-panel-header" />
    <div className="yaml-panel-editor">
      <CodeMirror
        value={yamlContent}
        height="100%"
        editable={!isBusy}
        basicSetup={{
          highlightActiveLine: true,
          highlightActiveLineGutter: true,
          lineNumbers: true,
          foldGutter: false,
          searchKeymap: false,
        }}
        theme={codeMirrorTheme}
        extensions={editorExtensions}
        onChange={handleYamlChange}
      />
    </div>
  </div>
)}
```

**Step 2: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```
feat: render YAML panel with CodeMirror inside modal overlay
```

---

### Task 3: Style the YAML panel — basic appearance and slide animation

**Files:**
- Modify: `frontend/src/ui/modals/CreateResourceModal.css`

**Step 1: Add YAML panel styles**

Append to the end of `CreateResourceModal.css`:

```css
/* ── YAML side panel ──────────────────────────────────────────────────── */

.yaml-panel {
  position: absolute;
  top: 0;
  bottom: 0;
  right: 0;
  width: 700px;
  max-width: 90vw;
  background: var(--color-bg);
  border-left: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  pointer-events: auto;
  box-shadow: -4px 0 24px rgba(0, 0, 0, 0.15);
}

.yaml-panel.opening {
  animation: slideInFromRight var(--duration-slow, 300ms) var(--ease-out) both;
}

.yaml-panel.closing {
  animation: slideOutToRight var(--duration-slow, 300ms) var(--ease-out) both;
}

.yaml-panel-header {
  flex-shrink: 0;
  height: 40px;
  border-bottom: 1px solid var(--color-border);
}

.yaml-panel-editor {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.yaml-panel-editor .cm-editor {
  height: 100%;
}
```

**Step 2: Verify visually**

Open the app, open the create resource modal, click "Show YAML". The panel should slide in from the right, show the CodeMirror editor with the same YAML content, and overlay the right side of the form.

**Step 3: Commit**

```
feat: style YAML panel with slide-in animation
```

---

### Task 4: Position the form and panel so the form shifts left at wide viewports

**Files:**
- Modify: `frontend/src/ui/modals/CreateResourceModal.css`
- Modify: `frontend/src/ui/modals/CreateResourceModal.tsx`

**Step 1: Add a wrapper class when the YAML panel is open**

In `CreateResourceModal.tsx`, add the `yaml-panel-open` class to the `.modal-overlay` when the panel is open:

```tsx
<div className={`modal-overlay ${isClosing ? 'closing' : ''}${yamlPanelOpen ? ' yaml-panel-open' : ''}`}>
```

**Step 2: Add CSS to shift the modal left when the panel is open**

In `CreateResourceModal.css`, add rules that shift the modal container when enough viewport space is available. The form is 900px, the YAML panel is 700px, so they need ~1600px + some gap to sit side-by-side:

```css
/* When YAML panel is open, shift the modal left to make room.
   The modal and panel combined need ~1632px (900 + 700 + 32 gap).
   Below that width, the panel simply overlaps the form. */
.yaml-panel-open .create-resource-modal {
  transition: transform var(--duration-slow, 300ms) var(--ease-out);
}

@media (min-width: 1632px) {
  .yaml-panel-open .create-resource-modal {
    transform: translateX(calc(-50% - 16px));
  }

  .yaml-panel {
    width: 700px;
  }
}

@media (min-width: 1832px) {
  .yaml-panel {
    width: 900px;
  }
}
```

Note: The exact translateX value may need tuning during implementation. The intent is that the modal shifts left by roughly half the panel width plus a gap, so both are centered as a pair. Adjust based on visual testing.

**Step 3: Add a smooth transition back when panel closes**

The form should smoothly slide back to center when the panel closes. The `transition` on `.create-resource-modal` handles this — when `yaml-panel-open` is removed, the transform animates back to `none`.

However, since `yamlPanelOpen` is set to `false` after the 300ms closing animation timeout, the form will hold its shifted position during the panel's exit animation and then transition back. This is the correct behavior.

**Step 4: Verify visually at different viewport widths**

- At < 1632px: panel overlays the form, form doesn't move
- At >= 1632px: form shifts left, panel sits beside it, no overlap
- At >= 1832px: YAML panel grows to 900px

**Step 5: Commit**

```
feat: shift form left at wide viewports when YAML panel is open
```

---

### Task 5: Escape key closes YAML panel before modal

**Files:**
- Modify: `frontend/src/ui/modals/CreateResourceModal.tsx`

**Step 1: Update escape key handler**

Change the existing `useShortcut` for Escape (line 260-269) to close the YAML panel first:

```tsx
useShortcut({
  key: 'Escape',
  handler: () => {
    if (!isOpen) return false;
    if (yamlPanelOpen) {
      handleYamlPanelClose();
      return true;
    }
    onClose();
    return true;
  },
  description: 'Close create resource modal',
  category: 'Modals',
  enabled: isOpen,
```

**Step 2: Verify behavior**

- Open modal with YAML panel open
- Press Escape → YAML panel closes, modal stays open
- Press Escape again → modal closes

**Step 3: Commit**

```
feat: escape key closes YAML panel before modal
```

---

### Task 6: Reset YAML panel state when modal reopens

**Files:**
- Modify: `frontend/src/ui/modals/CreateResourceModal.tsx`

**Step 1: Reset panel state in the open effect**

Find the effect that resets state when the modal opens (the `useEffect` that resets `yamlContent`, `activeView`, etc.). Add resets for the panel state:

```tsx
setYamlPanelOpen(false);
setYamlPanelClosing(false);
```

**Step 2: Verify behavior**

- Open modal, open YAML panel, close modal
- Reopen modal → YAML panel should be hidden

**Step 3: Commit**

```
fix: reset YAML panel state when modal reopens
```

---

### Task 7: Visual polish and edge cases

**Files:**
- Modify: `frontend/src/ui/modals/CreateResourceModal.css`

**Step 1: Add reduced-motion support**

```css
@media (prefers-reduced-motion: reduce) {
  .yaml-panel.opening,
  .yaml-panel.closing {
    animation-duration: 0.01ms;
  }

  .yaml-panel-open .create-resource-modal {
    transition-duration: 0.01ms;
  }
}
```

**Step 2: Ensure panel matches modal height**

The panel is `position: absolute; top: 0; bottom: 0;` inside `.modal-overlay` which is `position: fixed` covering the full viewport. The panel should already match the viewport height. If the modal has rounded corners, the panel should too on its outer edge:

```css
.yaml-panel {
  border-radius: 0 var(--border-radius-lg, 8px) var(--border-radius-lg, 8px) 0;
}
```

Adjust if it looks off — the panel's left edge has no radius since it abuts the modal.

**Step 3: Verify the panel doesn't capture clicks on the backdrop**

The `.modal-overlay` has `pointer-events: none` with `.modal-container` having `pointer-events: auto`. The `.yaml-panel` already has `pointer-events: auto`. Clicking outside both should still close the modal (verify the overlay click handler still works).

**Step 4: Commit**

```
feat: YAML panel visual polish and accessibility
```

---

### Task 8: Run all tests and verify

**Step 1: Run TypeScript check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 2: Run all tests**

Run: `npx vitest run`
Expected: All tests pass (no test changes expected — the YAML panel is additive UI with no changed behavior in existing components)

**Step 3: Manual verification checklist**

- [ ] "Show YAML" button opens the panel with slide animation
- [ ] "Hide YAML" button closes the panel with slide animation
- [ ] Editing the form updates the YAML panel in real-time
- [ ] Editing the YAML panel updates the form in real-time
- [ ] Escape closes YAML panel first, then modal
- [ ] Narrow viewport: panel overlays the form
- [ ] Wide viewport (>= 1632px): form shifts left, both visible
- [ ] Very wide viewport (>= 1832px): YAML panel grows to 900px
- [ ] Closing and reopening the modal resets the panel to hidden
- [ ] Reduced motion: animations are effectively instant
- [ ] Clicking backdrop outside both panels closes the modal

**Step 4: Final commit**

```
chore: verify form+YAML panel implementation
```
