# Frontend Component Structure

Frontend placement should make ownership obvious and keep dependencies flowing
from app infrastructure to features to reusable building blocks.

## Agent Contract

- Put app infrastructure in `core/`.
- Put feature-owned UI in `modules/`.
- Put app shell, navigation, panels, modals, command palette, settings, and
  shortcuts in `ui/`.
- Put reusable components, hooks, utilities, constants, and styles in `shared/`.
- Do not make `shared/` depend on a feature module.
- Do not bypass documented data-access, permission, refresh, keyboard, modal,
  table, or tab infrastructure from feature code.
- New cross-feature behavior should move down only after at least two real
  consumers need the same abstraction.

## Directory Roles

| Directory | Owns |
| --- | --- |
| `core/` | App infrastructure, data brokers, refresh, capabilities, contexts, settings |
| `modules/` | User-facing feature workflows such as browse, namespace, object panel, object map |
| `ui/` | App shell surfaces such as layout, settings, panels, command palette, shortcuts |
| `shared/` | Reusable components, hooks, icons, actions, constants, and pure utilities |
| `styles/` | Global and shared CSS loaded by the app |

`hooks/`, `utils/`, and `types/` under a feature directory are local to that
feature. Promote only when the dependency direction stays clean.

## Object-panel Overview rendering (descriptor-driven)

The object panel's Details → Overview is rendered from per-kind **descriptors**, not bespoke
per-kind components. To add or change a kind's overview, edit its descriptor — do not write a new
component.

- `Details/Overview/schema.ts` — descriptor types (`OverviewDescriptor`, ordered `items`:
  `field | status | widget`, dynamic `label`/`fullWidth`, `mono`, `showSelector`, `OverviewContext`)
  and `coverageKeys`.
- `Details/Overview/OverviewRenderer.tsx` — generic renderer; owns the frame (`ResourceHeader` top,
  `ResourceMetadata` bottom) and renders the descriptor's items in between. No per-kind logic.
- `Details/Overview/descriptors/<area>.tsx` — one `OverviewDescriptor` per kind. Reads the raw
  Wails-generated `*Details` DTO by key (`field: keyof DTO`); render fns for complex values and
  `{kind:'widget'}` for irreducible UI; panel-only values (hpaManaged, drain, cluster identity) come
  from the `OverviewContext` second arg, not hooks.
- `Details/Overview/descriptorRegistry.ts` — single source mapping kind → descriptor (production
  dispatch + drift-check). Register new kinds here.
- `Details/Overview/driftCheck.test.ts` — runtime guard: every field of `new DtoClass({})` must be
  accounted for by the descriptor (schema field / `derivedFrom` / status item / widget `consumes` /
  `coveredElsewhere`). A new backend DTO field fails this test by name until placed.
- `Details/Overview/registry.ts` — legacy fallback only: `GenericOverview` for custom/unregistered
  resources + per-kind action `getResourceCapabilities`.

Parity for each kind lives in its `*Overview.test.tsx`, which renders
`OverviewRenderer(descriptor, dto)` directly.

## Placement Checklist

When adding frontend code:

1. Identify the owner, not just the closest import path.
2. Keep feature-specific state and UI in the feature module.
3. Put reusable rendering primitives in `shared` only if they are independent of
   module state.
4. Route backend reads through `dataAccess` or `appStateAccess`.
5. Use shared modal, keyboard, table, tab, and YAML editor primitives when the
   workflow matches their contracts.
6. Keep complete object refs and `clusterId` across navigation/action
   boundaries.

## Validation

Run targeted Vitest tests and `npm run typecheck --prefix frontend` for
frontend changes. Use browser/story validation for visual behavior when
appropriate.
