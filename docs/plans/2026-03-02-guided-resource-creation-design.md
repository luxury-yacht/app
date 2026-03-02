# Guided Resource Creation Design

**Date:** 2026-03-02
**Status:** Approved

## Overview

Add a guided form-based creation mode to the existing CreateResourceModal. The form and YAML editor are presented as tabs — the user can work in either view and changes sync bidirectionally. YAML remains the source of truth. The form is a structured lens over the YAML document.

## Decisions

- **Handcrafted forms** for the 7 existing template types (Deployment, Service, ConfigMap, Secret, Job, CronJob, Ingress). No auto-generated forms. New types added manually over time.
- **Tabbed toggle** using the existing `.tab-strip` / `.tab-item` / `.tab-item--active` CSS classes (same pattern as `ObjectPanelTabs.tsx`). Not a segmented control.
- **YAML as source of truth** — `yamlContent` string state remains the canonical data store. Both views read from and write to it.
- **Essential fields only** — forms cover the 80% case. Power users switch to YAML for advanced fields (probes, volumes, tolerations, etc).
- **Unknown fields preserved silently** — extra YAML fields that the form doesn't cover round-trip safely. No warning banner or raw YAML section in the form.
- **Zero backend changes** — the modal still sends YAML via `CreateResource` / `ValidateResourceCreation`. Forms are purely a frontend concern.

## Architecture & Data Flow

YAML is the single source of truth. The `yamlContent` string state that already exists in `CreateResourceModal` remains the canonical data store. Two views — Form and YAML editor — both read from and write to it.

```
┌─────────────┐     parse      ┌──────────────┐     read      ┌───────────┐
│ yamlContent │ ───────────▸   │  YAML AST    │ ──────────▸   │   Form    │
│  (string)   │                │  (Document)  │               │  fields   │
│             │ ◂───────────   │              │ ◂──────────   │           │
└─────────────┘   toString()   └──────────────┘  setIn/set    └───────────┘
       │
       ▼
┌─────────────┐
│  CodeMirror │  (direct string read/write, same as today)
│   Editor    │
└─────────────┘
```

**Form → YAML:** Each form field change calls a helper that parses the current YAML with `YAML.parseDocument()`, calls `doc.setIn(path, value)` to update the specific path, then calls `setYamlContent(doc.toString())`. This preserves comments and formatting for untouched nodes.

**YAML → Form:** The form reads values on every render by parsing `yamlContent`. For each field, `doc.getIn(field.path)` extracts the current value. If parsing fails, the Form tab shows an inline error and fields become read-only.

**Performance:** Parsing only happens when the Form tab is active. The `yaml` library's `parseDocument` is fast for the document sizes involved (typically < 100 lines).

## Modal Layout

The modal keeps its 900px max-width and 80vh height.

**Tab strip:**
- Positioned below the context bar (cluster/namespace/template dropdowns), above the content area
- Two tabs: `Form` and `YAML`
- Uses the same markup as ObjectPanelTabs: `<div className="tab-strip">` with `<button className="tab-item">` children
- Form tab only shown when the current `kind` has a handcrafted form definition. For "Blank" or unrecognized kinds, the tab strip is hidden and YAML is the only mode.
- Default active tab: **Form** when a supported template is selected, **YAML** when Blank or unsupported

**Content area:**
- Form tab: scrollable form with labeled fields grouped into sections
- YAML tab: identical to today's CodeMirror editor

**Footer:** unchanged (Cancel, Kind badge, Validate, Create)

## Form Definitions

Each form is a declarative configuration object. A generic `ResourceForm` renderer component reads the definition and renders the appropriate inputs.

### Field types

- `text` — single-line string input (name, image, key)
- `number` — numeric input (replicas, port)
- `select` — dropdown with predefined options (service type, restart policy)
- `textarea` — multi-line string (ConfigMap data values, Secret data values)
- `key-value-list` — dynamic list of key/value pairs (labels, annotations, env vars, ConfigMap data)
- `group-list` — repeatable group of fields (containers, ports, ingress rules)

### Type definitions

```typescript
type FormFieldDefinition = {
  key: string;           // unique field ID
  label: string;         // display label
  path: string[];        // YAML path, e.g. ['spec', 'replicas']
  type: 'text' | 'number' | 'select' | 'textarea' | 'key-value-list' | 'group-list';
  placeholder?: string;
  options?: { label: string; value: string }[];  // for 'select' type
  fields?: FormFieldDefinition[];                 // for 'group-list' items
  defaultValue?: unknown;
};

type FormSectionDefinition = {
  title: string;         // section heading, e.g. "Containers"
  fields: FormFieldDefinition[];
};

type ResourceFormDefinition = {
  kind: string;
  sections: FormSectionDefinition[];
};
```

### Per-resource fields

| Resource | Fields |
|----------|--------|
| **Deployment** | name, replicas, containers[]{name, image, ports[]{containerPort, protocol}, env[]{name, value}}, labels{} |
| **Service** | name, type (ClusterIP/NodePort/LoadBalancer), ports[]{port, targetPort, protocol}, selector{} |
| **ConfigMap** | name, data{} (key-value pairs) |
| **Secret** | name, type (Opaque/kubernetes.io/tls/etc), stringData{} (key-value pairs) |
| **Job** | name, containers[]{name, image, command}, restartPolicy (Never/OnFailure), backoffLimit |
| **CronJob** | name, schedule (cron expression), containers[]{name, image, command}, restartPolicy, backoffLimit |
| **Ingress** | name, ingressClassName, rules[]{host, paths[]{path, pathType, serviceName, servicePort}} |

## Sync Edge Cases

- **User adds YAML fields the form doesn't cover:** Preserved silently. Form only shows what it knows. YAML always shows everything.
- **YAML parse errors while on Form tab:** Form shows inline message "YAML has syntax errors. Switch to the YAML tab to fix them." Fields go read-only.
- **User deletes a form-covered field from YAML:** Form input shows empty/default.
- **User changes `kind` in YAML to a supported type:** Form definition switches to match.
- **User changes `kind` to an unsupported type:** Tab strip hides, YAML-only mode.
- **Blank template, user types supported `kind` in YAML:** Tab strip appears once `kind` is parseable and matches a form definition.
- **Template switching:** Replaces `yamlContent` (same as today). Form re-reads from new YAML.

## File Organization

### New files

| File | Purpose |
|------|---------|
| `frontend/src/ui/modals/create-resource/formDefinitions.ts` | Declarative form definitions for all 7 resource types |
| `frontend/src/ui/modals/create-resource/ResourceForm.tsx` | Generic form renderer |
| `frontend/src/ui/modals/create-resource/ResourceForm.css` | Form-specific styles |
| `frontend/src/ui/modals/create-resource/yamlSync.ts` | Helpers: `getFieldValue`, `setFieldValue`, `getFormValues` |
| `frontend/src/ui/modals/create-resource/yamlSync.test.ts` | Unit tests for sync helpers |
| `frontend/src/ui/modals/create-resource/formDefinitions.test.ts` | Validates definitions have valid paths and no duplicates |
| `frontend/src/ui/modals/create-resource/ResourceForm.test.tsx` | Component tests for the form renderer |

### Modified files

| File | Change |
|------|--------|
| `frontend/src/ui/modals/CreateResourceModal.tsx` | Add tab state, render tab strip, conditionally render ResourceForm or CodeMirror |
| `frontend/src/ui/modals/CreateResourceModal.css` | Tab strip positioning within the modal |
| `frontend/src/ui/modals/CreateResourceModal.test.tsx` | Add tests for tab switching, form↔YAML sync |

### Unchanged

- Backend: zero changes
- Templates (`backend/resources/templates/templates.go`): unchanged
- Command palette, modal state, AppLayout wiring: unchanged
