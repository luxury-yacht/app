# Simultaneous Form + YAML Panel

## Problem

The create-resource modal currently shows either the form or the YAML editor, never both. Users must toggle between views to verify form output, hand-edit advanced fields, or reference YAML while working in the form. Showing both simultaneously solves live preview, hybrid editing, and reference-while-editing in one interaction model.

## Design

### Layout Model

The form modal and YAML panel are two independent layers positioned within the viewport.

```
┌─────────────────────── viewport ───────────────────────┐
│                                                         │
│   ┌─── Form Modal ───┐┌──── YAML Panel ────┐          │
│   │  900px max/90vw   ││   700–900px        │          │
│   │                   ││                    │          │
│   │   [form fields]   ││   [CodeMirror]     │          │
│   │                   ││                    │          │
│   └───────────────────┘└────────────────────┘          │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Positioning Rules

- **Form modal**: keeps its current size (900px max / 90vw). Never resizes.
- **YAML panel**: 700px wide. Can grow up to 900px at very wide viewports.
- **Wide viewport** (enough room for both): the form shifts left so both panels sit side-by-side with no overlap.
- **Narrow viewport** (not enough room): the YAML panel overlays the form from the right.

### YAML Panel Structure

- **Header bar**: empty placeholder for future controls (title, buttons, etc.)
- **Editor area**: CodeMirror fills remaining height, same configuration as today.
- **Animation**: slides in/out from the right via CSS transition.
- **Z-index**: same level as the form modal, above the backdrop overlay.

### Toggle Behavior

- YAML panel is **hidden by default**.
- The current "Show Form" / "Show YAML" toggle button is replaced with **"Show/Hide YAML"**.
- When hidden, layout is identical to today — form modal centered, no changes.

### Sync

Bidirectional sync between form and YAML already works via `yamlSync.ts`. No changes needed — form edits update the YAML content, YAML edits re-render the form.

### Keyboard

- **Escape** with YAML panel open: closes the YAML panel (does not close the modal).
- **Escape** with YAML panel closed: closes the modal (existing behavior).

### What Does Not Change

- Form modal sizing, internals, and rendering (ResourceForm, formDefinitions, all form components).
- Modal backdrop and overlay behavior.
- Footer buttons (Cancel, Validate, Create).
- CodeMirror configuration and extensions.
