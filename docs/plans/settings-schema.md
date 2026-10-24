# Settings Schema: One Go-Owned Preference Contract

Temporary plan from the second app-wide design review (finding #4, the last
item; #1 feed cutover #402, #2 real-state harness #403, and #3 kind facets #404
are merged). It makes the app-preference schema one Go contract that generates
the TypeScript side.

- **Status:** John approved the plan on 2026-10-23 with every recommended
  answer (Q1–Q14), after review rounds [1](#review-round-1-2026-10-23),
  [2](#review-round-2-2026-10-23), and [3](#review-round-3-2026-10-23).
  Phase 1 is in progress.
- **Base:** `main` at `5c5f962a` (Kind facets #404). Line numbers are from that
  commit.
- **Paths:** relative to the repository root.
- **Evidence:** every citation below was read on 2026-10-23. "grep" means a
  `/usr/bin/grep -rn` over the named tree, excluding tests unless stated.
- **Scope of "settings":** the 36 keys `UpdateAppPreferences` accepts, plus
  the zoom level, which has its own commands but the same duplicated bounds.
  Selected kubeconfigs, themes, cluster sections, and window geometry are not
  preferences ([app-preferences.md:13-16](../architecture/app-preferences.md)).

## Problem

### Go already has one table, TypeScript copies it by hand

- Go declares each preference in one descriptor table
  (`backend/preferences_settings_data.go:164-310`): key, value type, default,
  min/max, enum options, validation hint, runtime-effect flag, apply function,
  and change-log text. Apply, the schema RPC, the key list, and the change log
  all iterate it (`preferences_settings_data.go:9-15,312-390`).
- The values come from 36 key constants (`backend/preferences_settings.go:29-64`)
  and one bounds/defaults block (`preferences_settings.go:199-241`). That block
  draws on `backend/internal/config/config.go:14,17,49,164,248` (QPS 200,
  burst 500, metrics interval 5 s, SSRR concurrency 32, global log targets
  200) and `backend/internal/containerlogs/targets.go:9-12` (per-scope targets
  100, 1–1000). The SSRR maximum is `config.PermissionSSRRFetchConcurrency * 8`
  (`preferences_settings.go:218`).
- TypeScript repeats all of it in `frontend/src/core/settings/appPreferences.ts`:
  - the `AppPreferences` interface (`:59-96`, 36 fields, same order as Go);
  - three enum unions (`:43-45`) and the value-type union (`:106`);
  - 12 private literals (`:157-168`) and 18 exported bound/default literals
    (`:170-187`);
  - `DEFAULT_PREFERENCES` (`:189-229`);
  - `FALLBACK_PREFERENCE_METADATA` (`:250-431`), a full copy of the Go table's
    metadata.
- The Go comment at `preferences_settings.go:196-198` says "The frontend clamps
  to the same range". Nothing checks it: no backend file reads the TypeScript
  settings files, and the frontend's mentions of `preferences_settings.go` are
  comments in per-test fakes (grep of `backend`, `cmd`, `frontend/src`).

### The copies have already drifted

- **A metadata value differs.** Go marks `permissionSSRRFetchConcurrency` as a
  runtime side effect (`preferences_settings_data.go:235`, the third argument
  of `intPreference`, `:69`). The TypeScript fallback says `false`
  (`appPreferences.ts:312`). Nothing reads `runtimeSideEffect` outside the
  producers (grep of `frontend/src` and `backend`, excluding tests,
  `preferences_settings_data.go`, and `resources/types/types.go`), so this has
  no runtime effect today.
- **Go disagrees with itself on non-positive integers.** There are three
  integer paths per key:
  1. Apply clamps. QPS 0 becomes 1 (`preferences_settings_data.go:227-229`,
     `preferences_settings.go:243-245`). A docked-right width of 0 becomes 500
     (`preferences_settings_data.go:265-267`).
  2. Load replaces 0 with the default: QPS 200, width 600
     (`preferences_settings.go:389-390,426,432-437`).
  3. Save clamps again (`preferences_settings.go:797-805`).

  TypeScript sends the default for 0 (`appPreferences.ts:604-632,1070-1074`).
  The UI therefore never sends 0, but any other caller of `UpdateAppPreferences`
  gets the minimum.
- **Go load leaves bad values that the UI repairs.** `normalizeSettingsFile`
  (`preferences_settings.go:321-340`) only fills empty enums
  (`:357-359,419-424`) and clamps the integers listed above. It does not reject
  or repair:
  - an unknown enum value;
  - a malformed color;
  - an out-of-range palette value;
  - an off-list page size.

  TypeScript hydration repairs each one (`appPreferences.ts:559-585,997-1130`;
  `frontend/src/shared/components/tables/pageSizeOptions.ts:19-20`). With a
  hand-edited or older `settings.json`, the backend keeps the stored value while
  the UI shows the repaired one.
- **The page-size contract is split.** Go accepts any size from 1 to 1000
  (`preferences_settings_data.go:259-261`). Its test saves 250 and clamps
  999999 to 1000 (`backend/preferences_settings_test.go:1514-1557`).
  TypeScript snaps to six options (`pageSizeOptions.ts:9-20`). The Go comment
  gives the list to the frontend (`preferences_settings.go:219-221`).

### Two delivery channels and more copies

- **Two channels for the same metadata.** The runtime RPC `GetAppSettingsSchema`
  (`preferences_settings.go:881-889`, DTOs `backend/resources/types/types.go:79-97`)
  is merged over the TypeScript fallback (`appPreferences.ts:477-495,962-995`).
  The fallback serves first paint, Wails-less tests, and schema-load failure
  (`docs/architecture/app-preferences.md:42-47`).
  The real-state harness answers the schema RPC with `null`
  (`frontend/src/test-utils/appState/harness.tsx:660`), so every harness test
  runs on the TypeScript copy, never on Go's metadata.
- **Smaller copies:**
  - the hex color pattern, three times (`preferences_settings.go:21`,
    `appPreferences.ts:575`,
    `frontend/src/ui/settings/sections/AppearanceColorControl.tsx:38`);
  - the zoom bounds, twice (`preferences_settings.go:1020-1051`,
    `frontend/src/core/contexts/ZoomContext.tsx:26-29`);
  - the log timestamp default, twice (`preferences_settings.go:203`,
    `frontend/src/utils/objPanelLogsApiTimestampFormat.ts:6`);
  - the metrics interval default (`appPreferences.ts:157` versus
    `config.go:49`);
  - a test fixture that copies the whole Go schema
    (`frontend/src/core/settings/appPreferences.test.ts:99-377`).
- **Go states its own defaults two or three times.** Each default appears in the
  descriptor, in `defaultSettingsFile` (`preferences_settings.go:282-319`), and
  in the `normalize*` functions (`:348-430`). For example,
  `dimInactiveNamespaces` defaults to true at `preferences_settings_data.go:219`,
  `preferences_settings.go:291`, and `preferences_settings.go:361`.

## Target model

### Ownership

| Owner | Owns |
| --- | --- |
| Go schema leaf `backend/internal/preferenceschema` | Key, value type, default, min/max, allowed values (string or integer), non-positive rule, validation kind, and declaration order for each preference. Also the zoom bounds and the hex color pattern. |
| Package `backend` (binding) | The `AppSettings` field, the `settings.json` location (existing hand mappings), the effect route, and the change-log text. |
| Generated TypeScript | Nothing. It is a projection of the leaf. |
| Hand-written TypeScript | Presentation (titles, help, steps, units, option labels and icons), the Day.js format validator, the first-paint caches, and the per-key setter API. |

### Go schema leaf

The leaf imports only `internal/config` and `internal/containerlogs`.
`containerlogs`, which itself imports `config`, is already imported by a
generator (`backend/internal/genrefreshcontracts/registry.go:6`), so this
dependency set already compiles outside the root package. No checked package
imports the root `backend` package (grep for the root import path in
`containerlogs`, `kindregistry`, `logspec`, and `refresh/*.go`: none). Sketch:

```go
package preferenceschema

type ValueType string // "boolean" | "integer" | "enum" | "string" | "color"

// NonPositive says what an integer <= 0 means: the default (the "absent" rule
// settings.json has always used) or an ordinary value to clamp.
type NonPositive string // "default" | "clamp"

type Preference struct {
	Key         string
	Type        ValueType
	Default     any      // bool, int, or string, matching Type
	Min, Max    *int     // integers
	Options     []string // enums
	IntOptions  []int    // integers limited to a list (page size, Q4)
	NonPositive NonPositive
	Validation  Validation // "dayjs-format" | "#rrggbb-or-empty"
	Label       string     // names an enum in "invalid <label>: <value>" errors
	RuntimeSideEffect bool // removed in Phase 4 (Q8)
}

// Preferences is in declaration order: subscribers are notified in this order.
var Preferences = []Preference{ /* 36 rows */ }

const KeyKubernetesClientQPS = "kubernetesClientQPS" // … one exported key per row

// Defaults and bounds are exported constants (runtime owners start from them)
// that the rows reference, so each value is stated once.
const DefaultKubernetesClientQPS = config.KubernetesClientQPS // … and so on

// Validate checks a value written through UpdateAppPreferences or an import.
// A wrong type, unknown enum, or malformed color is an error.
//
// An integer with IntOptions keeps the raw number only if it equals an
// option. Anything else (a fraction, an off-list value, <= 0) becomes the
// default, with no truncation.
//
// Any other integer goes through these steps in order:
//  1. NonPositive "default" tests the raw number before truncation.
//  2. Otherwise the number truncates toward zero.
//  3. The result clamps.
func (p Preference) Validate(raw any) (any, error)

// Repair settles a stored value read from settings.json. Anything Validate
// would reject becomes the default; integers behave as in Validate.
func (p Preference) Repair(raw any) any

const (DefaultZoomLevel = 100; MinZoomLevel = 50; MaxZoomLevel = 200)
const HexColorPattern = `^#[0-9a-fA-F]{6}$`
```

- Integers never reject; they repair or clamp, as today. Only type errors,
  enums, and colors reject, as today (`preferences_settings_data.go:95-138`).
- **Integer conversion order.** The steps are the ones listed in the sketch.
  - **Option-list integers** (page size) match options exactly: the raw
    number is kept only if it equals an option, and anything else becomes the
    default.
    - This is what the frontend does today: `isTablePageSize` is an `includes`
      check, so 25.5 becomes 50 (`pageSizeOptions.ts:15-20`).
    - Go apply today truncates 25.5 to 25 and keeps it
      (`preferences_settings.go:929-932`,
      `preferences_settings_data.go:259-261`).
    - Truncating before the option check would have kept 25 and changed the
      frontend ([review round 2](#review-round-2-2026-10-23)).
  - **Range integers** (all the others) apply the non-positive test to the raw
    number, then truncate toward zero, then clamp. Testing before truncation
    keeps today's result for positive fractions on both sides. Go truncates
    first today (`preferences_settings.go:929-932`). The existing TypeScript
    test expects QPS 0.9 to become the minimum, 1
    (`frontend/src/core/settings/appPreferences.test.ts:1389-1390`).
  - Truncation toward zero is Go's conversion. A scratch probe confirmed that
    a JSON `float64` 0.9, −0.5, and −10.7 become 0, 0, and −10 under `int()`.
  - Fractions reach only `UpdateAppPreferences`. The same probe showed that
    `encoding/json` refuses a fraction in a Go `int` field, so a fraction
    fails the whole parse before reaching `Validate` or `Repair`:
    - in `settings.json` (`preferences_settings.go:560-563`);
    - in an import file, which decodes into the same `settingsPreferences`
      `int` fields (`data_management_import_export.go:206-208`;
      `preferences_settings.go:122,150-155`).

  | Input | Today, Go apply | Today, TypeScript | Plan |
  | --- | --- | --- | --- |
  | QPS 0.9 (`default` rule) | 1 | 1 | 1 |
  | QPS 0 | 1 | 200 | 200 |
  | QPS −0.1 | 1 | 200 | 200 |
  | Layout width 0.5 | 500 | 500 | 500 |
  | Page size 25.5 (option list) | 25 | 50 | 50 |
  | Page size 100.5 | 100 | 50 | 50 |
  | Page size 37 | 37 | 50 | 50 |
  | Brightness −0.5 (`clamp` rule) | 0 | −1 | 0 |
  | Brightness −10.7 | −10 | −11 | −10 |

  Go's results come from reading `preferences_settings.go:929-932,243-265`
  and `preferences_settings_data.go:227-303`. TypeScript's come from
  `appPreferences.ts:524-546` with each key's options at `:599-632,1066,1090-1113`.
  The changes are three:
  - Go apply on a raw number ≤ 0 for `default`-rule keys (Q5);
  - Go apply on an off-list or fractional page size (Q4);
  - TypeScript on negative fractions for the palette, which moves from floor
    to truncation.

  The frontend keeps today's result for every positive fraction, including
  page sizes.
- The table becomes a package `var`. The comment that it is rebuilt per call
  "because the metrics-interval default is derived at read time"
  (`preferences_settings_data.go:162-163`) is stale.
  `config.RefreshMetricsInterval` is a constant: it sits in the `const` block
  at `config.go:28-55`.

### Go binding and the single normalization path

- `appPreferenceDescriptors()` becomes binding rows keyed by the spec. Each
  row gives the `AppSettings` field, the effect flag (the six routes in
  `settingsSideEffects`, `preferences_settings.go:941-948`), and the log text.
  A row no longer restates a default, bound, or option.
- Apply calls `Validate`, then writes the field and flags the effect.
- `normalizeSettingsFile` stays the one file chokepoint. Load, save, export,
  and import all pass through it (`preferences_settings.go:565,574`;
  `backend/data_management_import_export.go:54,222`). It splits into two steps:
  1. **complete:** absent means default, under the rules that exist today. A
     nil section, a nil `*bool`, an empty string, or a non-positive integer
     gets its default. The legacy migrations are unchanged
     (`preferences_settings.go:150-172,439-455`).
  2. **repair:** the file is mapped to `AppSettings` with the existing mapping
     (`:722-768`, without its normalize call). `Repair` runs per key. The
     result is written back with the existing save mapping, factored out of
     `saveAppSettings` (`:780-831`).

  This reuses the two hand mappings instead of adding a third per-key file
  accessor.
- Import validates after complete and before repair. Today it rejects an
  unknown enum or a malformed color, because normalization leaves them for
  `apply` (`data_management_import_export.go:222-235`). The enum case is
  tested (`backend/data_management_import_export_test.go:448`, the `"sepia"`
  case); the color case is not. Both must stay true once load repairs them.
- These are deleted: the six clamp helpers (`preferences_settings.go:243-265`),
  `defaultOrClampInt` (`:432-437`), the save re-clamps (`:797-810`), and the
  duplicated defaults in `defaultSettingsFile` and `normalize*`.
  `defaultSettingsFile` builds its preferences from spec defaults.
- The runtime sinks keep their guards and call the spec instead of the deleted
  helpers (`backend/runtime_setting_policies.go:19,24,43,48`). The global
  limiter reads the source constant and is unchanged
  (`backend/refresh/containerlogsstream/limiter.go:28-29,41-42,55`).
- `ApplyTheme` copies raw theme values into the in-memory cache
  (`preferences_settings.go:1217-1230`), while the file goes through repair
  (`:1213`, then `saveSettingsFile` → `normalizeSettingsFile`). For an
  out-of-range theme value, the cache would disagree with the file.
  - Such a value can exist: `SaveTheme` checks only the ID, name, and cluster
    pattern (`:1106-1134`). Import checks those plus ID uniqueness
    (`data_management_import_export.go:242-262`).
  - The fix: after a successful save, the cache takes its palette, accent, and
    link values from the normalized file. A failed save returns before the
    cache is touched, as it does today (`:1213-1215`).
  - Phase 1 adds the regression tests for both cases.

### Generator

The generator is a sibling, `backend/internal/genpreferences`, with a `cmd/`.
It joins one line in `backend/generate.go` (Q2). It writes two files:

1. `frontend/src/core/settings/appPreferences.generated.ts`, sketched below.
2. `frontend/src/core/settings/appPreferences.parity.generated.json`, the
   parity vectors (Q12). Each key gets the boundary inputs that apply to its
   type, each with Go's `Repair` output:
   - for range integers: below min, min, max, above max, 0, −1, a positive
     fraction below 1 (0.9), a fraction just above min (min + 0.5), and
     negative fractions (−0.5, and −10.7 where the range allows it);
   - for option-list integers: each option, fractions next to options (25.5
     and 100.5), an off-list integer (37), above the largest option (1001), 0,
     and −1;
   - for enums: an unknown enum;
   - for colors: a malformed color;
   - for every type: a wrong-typed value.

   The Day.js key gets only the cases where Go and TypeScript agree by design
   ([TypeScript side](#typescript-side)).

```ts
// Code generated by genpreferences; DO NOT EDIT.
//
// backend/internal/preferenceschema is the source of truth.
// Regenerate with: go generate ./backend

const contract = {"preferences":[
  {"key":"sidebarClusterResourcesExpanded","type":"boolean","defaultValue":true},
  {"key":"appearanceMode","type":"enum","defaultValue":"system","enumOptions":["light","dark","system"]},
  {"key":"kubernetesClientQPS","type":"integer","defaultValue":200,"min":1,"max":5000,"nonPositive":"default"},
  {"key":"defaultTablePageSize","type":"integer","defaultValue":50,"intOptions":[25,50,100,250,500,1000],"nonPositive":"default"},
  …],
  "zoomLevel":{"defaultValue":100,"min":50,"max":200},
  "hexColorPattern":"^#[0-9a-fA-F]{6}$"} as const;

export interface AppPreferences {
  sidebarClusterResourcesExpanded: boolean;
  appearanceMode: 'light' | 'dark' | 'system';
  kubernetesClientQPS: number;
  defaultTablePageSize: 25 | 50 | 100 | 250 | 500 | 1000;
  …
}
export type AppPreferenceKey = keyof AppPreferences;
export const APP_PREFERENCE_SPECS = contract.preferences;
export type AppPreferenceSpec = (typeof APP_PREFERENCE_SPECS)[number];
export const ZOOM_LEVEL = contract.zoomLevel;
export const HEX_COLOR_PATTERN = contract.hexColorPattern;
```

- The sketch shows the final shape. Until Phase 4 the rows also carry
  `runtimeSideEffect`, so the Phase 2 parity test can see the known drift.
- The generator renders an ordered slice, never a map. `encoding/json` sorts
  map keys (as the map-based catalog in
  `backend/internal/genobjectactions/render.go:76-82,125` does). The store
  notifies subscribers in declaration order (`appPreferences.ts:663-664`).
- It follows the existing freshness pattern: a test in package `backend`
  compares `Render()` with the committed files, as
  `backend/kind_facets_test.go:21-33` does.

### TypeScript side

- `appPreferences.ts` imports the generated module. It derives the three named
  unions, using `AppPreferences['appearanceMode']` and the like,
  `DEFAULT_PREFERENCES`, and `getPreferenceMetadata` from it. These are
  deleted:
  - the interface;
  - the 12 private and 18 exported literals;
  - `FALLBACK_PREFERENCE_METADATA`;
  - the runtime-schema merge (`:475-495,962-995`).
- One `normalizePreferenceValue(key, raw)` implements `Repair` from the spec
  rule: `NonPositive`, `IntOptions`, clamp, enum default, and color pattern. It
  replaces the seven per-key wrappers (`:599-632`) and the type-specific
  normalizers (`:559-585`).
- **The Day.js timestamp format is the one deliberate difference from Go.** It
  applies to the one key whose validation kind is `dayjs-format`,
  `objPanelLogsApiTimestampFormat`. For it, `normalizePreferenceValue` first
  applies Go's `Repair` (a wrong type or an empty string becomes the default).
  It then applies the existing TypeScript check,
  `normalizeObjPanelLogsApiTimestampFormat`
  (`frontend/src/utils/objPanelLogsApiTimestampFormat.ts:118-128`), which
  trims the value and turns an unsupported format into the default.
  - Go accepts any non-empty string (`preferences_settings_data.go:173-189`,
    `preferences_settings.go:414-416`). So for `"foo"` or a padded format, Go
    keeps the stored value while the UI shows the default or the trimmed
    format.
  - Only hand edits, imports, and non-UI callers reach this. The setter
    validates and trims before sending (`appPreferences.ts:1355-1365`).
  - The backend never reads the format: a grep of `backend` outside the
    settings files and DTOs finds nothing.
  - The checks are a typed record keyed by the generated validation kinds: the
    color kind uses `HEX_COLOR_PATTERN` (exact Go parity), and the Day.js kind
    uses the TypeScript checker. A new kind without a checker fails
    `qc:typecheck`.
  - The parity vectors cover only the cases both sides share for this key: a
    wrong type, an empty string, and the default. The stricter repair keeps its
    own TypeScript tests (Q10).
- `normalizePreferences` (`:997-1130`) becomes a loop over the specs. Error
  reporting still fails closed when the settings read fails (`:1031-1038`).
  The `defaultOnNonPositive` option disappears, because the spec carries the
  rule. That removes it from `normalizeIntegerPreferenceValue` (`:524-546`),
  `commitIntegerPreferenceInput` (`:548-557`), `SettingsControls.tsx:159-161`,
  and `ObjectPanelSection.tsx:112-114`.
- A type-level guard checks that every generated field is assignable to the
  Wails model `types.AppSettings`
  (`frontend/bindings/github.com/luxury-yacht/app/backend/resources/types/models.ts`).
  A renamed Go DTO field then fails `qc:typecheck`.
- The per-key setters (`:1243-1486`) keep their names and signatures.

### How the Settings UI reads bounds

The UI API does not change. `getIntegerPreferenceMetadata(key)` and
`getPreferenceMetadata(key)` read the generated spec directly, with no runtime
merge:

- `frontend/src/ui/settings/sections/SettingsControls.tsx:110-116`;
- `ObjectPanelSection.tsx:144-152`;
- `AppearanceSection.tsx:673-684,767,771`.

A grep of the non-test Settings sections for numeric literals, `min=`, `max=`,
"range", and "between" found no copy that hard-codes a preference range. The
literals it did find are titles, steps, an example timestamp, icon sizes, and
default theme colors. Two places divide by the palette maxima (100 for
saturation, 50 for brightness) to map a value onto CSS: `utils/paletteTint.ts:53-54`
and the slider preview at `AppearanceSection.tsx:1096-1099`. Both read the
generated max (Q14).

## Inventory

Every place where either side defines a preference's key, type, default,
bound, or allowed values. The Fate column refers to the phases below.

### Go: schema and runtime contract

| Where | What | Fate |
| --- | --- | --- |
| `backend/preferences_settings.go:29-64` | 36 key constants | Move to the leaf as exported keys (P1). About 190 references in 6 files: `preferences_settings{,_data,_test}.go`, `preferences_themes_test.go`, `error_reporting_installation_telemetry_test.go`, `data_management_import_export.go` (grep count). |
| `preferences_settings.go:196-241` | Defaults and bounds, plus the "frontend clamps to the same range" comment | Leaf table (P1); the comment goes. |
| `preferences_settings.go:219-221` | "page-size values are owned by the frontend" | Reversed by Q4 (P1). |
| `preferences_settings.go:243-265,432-437` | Clamp helpers and `defaultOrClampInt` | Replaced by `Validate`/`Repair` (P1). |
| `preferences_settings.go:282-319` | `defaultSettingsFile` literal defaults | Built from spec defaults (P1). |
| `preferences_settings.go:348-430` | `normalize*` defaults and clamps | Complete step plus `Repair` (P1). |
| `preferences_settings.go:797-810` | Save re-clamps and the timestamp-empty default | Deleted (P1). |
| `preferences_settings.go:21` | Hex color pattern | Leaf (P1), emitted (P2). |
| `preferences_settings.go:1020-1051` | Zoom 50/200/100, as get-default and set-clamp | Leaf `ZoomLevel` (P1, Q7). |
| `backend/preferences_settings_data.go:16-158` | Descriptor type and builders carrying type, default, bounds, options, validation, runtime flag | Split: the spec goes to the leaf, the binding stays (P1). |
| `preferences_settings_data.go:162-310` | The table | Binding rows over the spec (P1). |
| `preferences_settings_data.go:324-344` | `buildAppSettingsSchema` | Deleted with the RPC (P4). |
| `backend/resources/types/types.go:79-97` | `AppPreferenceSchema`, `AppSettingsSchema` | Deleted (P4). |
| `types.go:37-77` | `AppSettings` DTO; comments restate ranges (`:54-56,66-71`) | DTO kept. Comment ranges point to the leaf instead (P1). |
| `backend/desktop_service.go:44,328-329` | `GetAppSettingsSchema` passthrough | Deleted (P4). |
| `backend/runtime_setting_policies.go:19,24,43,48` | Sink guards using the clamp helpers and defaults | Call the spec (P1). |
| `backend/refresh/containerlogsstream/limiter.go:28-29,41-42,55` | `<= 0` → config default | Unchanged; it reads the source constant. |
| `backend/internal/containerlogs/targets.go:9-21`, `backend/internal/config/config.go:14,17,49,164,248` | Source constants | Unchanged; the leaf references them. |

### Go: persistence and migration (compatibility, kept)

| Where | What | Fate |
| --- | --- | --- |
| `preferences_settings.go:19` | `settingsSchemaVersion = 1` | Unchanged. |
| `preferences_settings.go:108-148,175-194` | Nested `settings.json` layout; `omitempty` `*bool` fields mean "absent → default" | Unchanged. |
| `preferences_settings.go:150-172` | `preferences.theme` → `appearanceMode` migration | Unchanged. |
| `preferences_settings.go:129-132,439-455` | Single palette → per-mode migration | Unchanged. |
| `preferences_settings.go:722-768,780-831` | File ↔ `AppSettings` mappings | Kept; refactored to serve repair (P1). |
| `backend/data_management_import_export.go:32-38,54-67,205-238` | Export/import document; import validation through descriptors (enum rejection tested at `data_management_import_export_test.go:448`) | Format unchanged. Import validates before repair (P1). |

### TypeScript: copies of the schema

| Where (`frontend/src/core/settings/appPreferences.ts`) | What | Fate |
| --- | --- | --- |
| `:43-45` | `AppearanceMode`, `GridTablePersistenceMode`, `ObjectPanelPosition` | Derived from the generated interface (P3). |
| `:59-96,102` | `AppPreferences`, `AppPreferenceKey` | Generated (P3). |
| `:104-114` | `AppPreferenceMetadata`, value-type union `:106` | From `AppPreferenceSpec`; `currentValue` dropped, no reader outside this file (grep of `.currentValue` in non-test `frontend/src`) (P3). |
| `:157-168` | 12 private literals | Deleted (P3). |
| `:170-187` | 18 exported literals | Deleted; consumers read the spec (P3). |
| `:189-229` | `DEFAULT_PREFERENCES` | Derived (P3). |
| `:231-431` | `createPreferenceMetadata`, `FALLBACK_PREFERENCE_METADATA` | Deleted (P3). |
| `:475-495` | `isPreferenceKey`, `schemaEntryToMetadata` | Deleted or replaced by a spec lookup (P3). |
| `:524-632` | Integer, enum, boolean, and color normalizers; hex regex `:575`; `isAppearanceMode` `:590-591`; seven wrappers | One spec-driven `normalizePreferenceValue` (P3). |
| `:962-995` | Schema-then-settings fetch chain | `GetAppSettings` only (P4). |
| `:997-1130` | `normalizePreferences` | Loop over specs, fail-closed error reporting kept (P3). |
| `:1534-1543` | Test reset from `DEFAULT_PREFERENCES` | Derived defaults (P3). |
| `:48-57,634-645` | Sidebar and palette key groupings | Unchanged; typed against `AppPreferenceKey`, so the compiler checks them. |

### TypeScript: other definitions and consumers

| Where | What | Fate |
| --- | --- | --- |
| `frontend/src/core/refresh/streaming/containerLogsStreamManager.ts:15,586` | Initial buffer size (the only production use of an exported literal; grep) | Spec default (P3). |
| `frontend/src/shared/components/tables/pageSizeOptions.ts:9-20` | Options, default, snap | Derived from the spec (P3, Q4). It stays the import point for pagination footers and Display. |
| `frontend/src/utils/objPanelLogsApiTimestampFormat.ts:6,118-128` | Default format; Day.js validation | The default comes from the spec. Validation stays in TypeScript (Q10). |
| `frontend/src/core/contexts/ZoomContext.tsx:26-29,123,141,145,165-166` | Zoom min/max/default | Spec (P3, Q7). `ZOOM_STEP` stays. |
| `frontend/src/utils/appearanceMode.ts:44` | Enum literal check | Spec options (P3). |
| `frontend/src/ui/settings/sections/AppearanceColorControl.tsx:38` | Hex pattern | `HEX_COLOR_PATTERN` (P3, Q9). |
| `frontend/src/utils/paletteTint.ts:53-54`, `AppearanceSection.tsx:1096-1099` | Divisors equal to the palette maxima | Spec max (P3, Q14). The CSS mapping constants `paletteTint.ts:27,31` stay. |
| `frontend/index.html:33-36` | First-paint default `'system'` in the inline script | Sanctioned exception: it runs before the bundle (Q13). |
| `frontend/src/test-utils/appState/harness.tsx:705` | `GetZoomLevel` answers 100 | Spec default (P3). |

### Settings UI

| Where | What | Fate |
| --- | --- | --- |
| `SettingsControls.tsx:110-116,159-161` | Bounds from metadata; passes `defaultOnNonPositive` | API unchanged; option removed (P3). |
| `ObjectPanelSection.tsx:112-114,144-152` | Same | Same (P3). |
| `AppearanceSection.tsx:673-684,767,771` | Enum filter, palette bounds, reset to default | API unchanged (P3). |
| `AdvancedSection.tsx:28-57`, `LogsSection.tsx:33-58`, `DisplaySection.tsx:26` | Titles, help, step, unit, options rendered from the list | Presentation; stays TypeScript. |

### Tests that pin literals or copy the schema

| Where | What | Fate |
| --- | --- | --- |
| `frontend/src/core/settings/appPreferences.test.ts:99-377` | Hand copy of the whole Go schema as a fake RPC payload | Deleted with the RPC (P4). Tests that need a value use the generated spec. |
| `appPreferences.test.ts:24-40,1354-1558` | Bound tests built on the 17 imported literals | Read the spec (P3). |
| `appPreferences.test.ts:1445` | Pins `5000` | Dropped; Go keeps the product pin (`preferences_settings_test.go:614`). |
| `appPreferences.test.ts:498-624` | Schema-hydration tests | Rewritten for `GetAppSettings`-only hydration (P4). |
| `frontend/src/ui/settings/sections/AdvancedSection.test.tsx:128-129,153` | Expects 10000, citing `KUBERNETES_CLIENT_BURST_MAX` | Expects the spec max (P3). |
| `frontend/src/modules/object-panel/components/ObjectPanel/Logs/LogViewer.test.tsx:28-29,969,1014`; `…/NodeLogs/NodeLogsTab.test.tsx:18,922` | Buffer literals | Spec (P3). |
| `harness.tsx:660` | Schema RPC answered `null` | Answer deleted (P4). |
| `backend/preferences_settings_test.go:1042-1068,1070-1088` | Schema RPC defaults and key coverage | Replaced by the spec/binding coverage tests (P1, P4). |
| `preferences_settings_test.go:221-240` | Error reporting defaults on in settings and schema | The schema half moves to the spec test (P4). |
| `preferences_settings_test.go:1514-1557` | Page size: 250 kept, 999999 → 1000 | 999999 → default 50; 250 kept (P1, Q4). |
| `preferences_settings_test.go:215-218,614` | Layout defaults and the 5,000-line buffer | Kept as product-decision pins. |
| `backend/preferences_themes_test.go:292-326,467-518` | `TestApplyTheme` (disk only, valid values); the publish-after-persistence table (no `apply` case) | Extended for the cache change (P1). |

### Docs and configuration

| Where | Fate |
| --- | --- |
| `docs/architecture/app-preferences.md:8-27,42-47,68-70` | Rewritten: the leaf, generation, no runtime schema RPC, no fallback metadata (P5). |
| `backend/generate.go` | One `go:generate` line (P2). |
| `frontend/biome.jsonc:30-32,45-47,59-61`; `frontend/scripts/check-biome-suppressions.mjs:54-56` | Add the generated TS file (P2). |
| `.agents/skills/app-shell/SKILL.md:29` | Add the leaf and generator paths (P5). |

## Non-goals

- The `settings.json` layout, `settingsSchemaVersion`, and the export format
  and version are unchanged.
- **The Appearance live-preview drafts.** The palette, accent, and link
  controls keep live-preview drafts, and page styling re-reads those values
  only on a light/dark change or when a theme is applied
  ([app-preferences.md:61-64](../architecture/app-preferences.md);
  `frontend/src/utils/appearanceMode.ts:22-37` reads the store only when
  called; `AppearanceSection.tsx:762,784,815` apply drafts directly). This is
  about state ownership and runtime effects, not schema, defaults, or bounds.
  The schema work neither fixes nor worsens it. The finding-5 note in the
  shared session notes records that John chose on 2026-10-20 to leave it, so
  it is not re-proposed.
- Theme-library validation. The palette ranges in saved themes
  (`types.go:129-134`; `SaveTheme`, `preferences_settings.go:1106-1134`, does
  not clamp them) are separate state.
- Day.js format validation in Go. Go keeps "empty means default".
- Per-key setter names, Settings copy, steps, units, labels, and icons.
- Window geometry defaults (`preferences_settings.go:692-695`): backend-only,
  with no TypeScript copy.
- The 22 per-test `UpdateAppPreferences` fakes across 18 frontend test files
  (grep of `answer('UpdateAppPreferences'`). They are a candidate follow-up for
  a shared harness helper, not schema.
- The unused `settings:appearance-mode-resolved` event (finding-5 note).

## Phases

Each phase starts with the Claude Code impact-analysis entry
(`docs/workflows/impact-analysis.md`) and follows red/green/refactor. Each
phase ends green, with no behavior change beyond the ones it names.

### Phase 1: Go schema leaf and one normalization path (no wire change)

- [x] Guard tests, green today, protecting the refactor:
  - an import with a malformed accent color is rejected, next to the existing
    unknown-`appearanceMode` case
    (`backend/data_management_import_export_test.go:448`);
  - legacy files still load: the `preferences.theme` key, the single-value
    palette, the removed `refresh.background` key
    (`preferences_settings_test.go:1584`), the retired `maxTableRows` key
    rejected (`:621`), and absent `*bool` fields giving their defaults.
- [x] Red tests for the intended Go changes:
  - (Q5) `UpdateAppPreferences` with 0 or −0.1 for QPS, burst, SSRR, buffer,
    both target limits, and the four layout sizes yields each default (today:
    each minimum).
  - (Q5) As guards, green today: QPS 0.9 gives 1, a layout width of 0.5 gives
    500, and palette brightness −0.5 gives 0.
  - (Q6) A `settings.json` with an unknown enum, a malformed color, an
    out-of-range palette value, and an off-list page size loads as the values
    the UI shows today. This holds for `GetAppSettings`, for export, and for
    the next save.
  - (Q4) `UpdateAppPreferences` with page size 37, 999999, 25.5, or 100.5
    stores 50 (today: 37, 1000, 25, and 100).
  - (Q4) An import with page size 37 or 999999 stores 50 (today: 37 and 1000).
  - (Q4) As a guard, green today: an import with a fractional page size fails
    with the parse error and leaves settings unchanged. It decodes into the
    `int` field before any validation (`data_management_import_export.go:206-208`,
    `preferences_settings.go:122,150-155`).
- [x] Red spec test (the package does not exist yet):
  - each default has its spec type and lies within bounds or options;
  - enums have options; `IntOptions` are non-empty, ascending, and contain the
    default (a key with `IntOptions` has no min/max);
  - keys are unique;
  - spec keys equal binding keys, and equal the `AppSettings` JSON tags minus
    `anonymizedId`, `selectedKubeconfigs`, and `themes` (reflection over
    `types.AppSettings`).
- [x] Table-driven persistence round trip over the spec: write a valid
  non-default value per key, save, reload, compare. This catches a new key
  that is missing a file mapping.
- [x] Theme-application tests for the `ApplyTheme` cache change, in
  `backend/preferences_themes_test.go`.

  Every case calls `ensurePreferencesLoaded` before the theme is applied, so
  the cache exists when `ApplyTheme` runs. Otherwise a broken cache update
  would go unseen:
  - the fixture loads lazily (`preferences_settings_test.go:1560`);
  - `ApplyTheme` updates the cache only when it exists
    (`preferences_settings.go:1217-1218`);
  - `EnsureLoaded` serves the cache once loaded
    (`backend/preferences_service.go:140-146`) but reads the disk otherwise
    (`:147-162`).

  So a read after an apply on an unloaded service would return the repaired
  disk values and pass anyway.
  - **Repaired values agree (red today).** Load. Save a theme with palette hue
    999, saturation 150, brightness −80, and accent `"#zzz"`, which `SaveTheme`
    accepts. Apply it. `GetAppSettings` (now the cached snapshot) and
    `loadSettingsFile` (the disk) both hold 360, 100, −50, and `""`. Today the
    cache holds the raw values (`preferences_settings.go:1218-1230`), and the
    disk does too, because nothing repairs them.
  - **A later unrelated save keeps them (red today).** Then save
    `useShortResourceNames` through `UpdateAppPreferences`. The disk still
    holds the repaired values, and the response settings and the cache equal
    the disk. This catches a cache that would write raw values back through
    `saveAppSettings` (`:780-831`).
  - **A failed save changes nothing (guard, green today).** This is its own
    test, modeled on `TestThemeLibraryMutationsPublishOnlyAfterPersistence`
    (`preferences_themes_test.go:467-518`) rather than a row in it. That table
    seeds themes with zero-valued palettes (`:473-474`) and asserts only
    `Themes` (`:497-499`), so it could not see an apply leaking into the active
    values.
    - Seed distinct active values through `UpdateAppPreferences`, for example
      hue 10, saturation 20, brightness 5, accent `"#112233"`, and link
      `"#445566"`. Save a theme with different valid values, then load.
    - With `writeSettingsFileAtomic` failing, `ApplyTheme` returns the error.
      The active palette, accent, and link fields in `GetAppSettings` still
      equal the seeded values, and the disk bytes are unchanged.
    - After the write is restored, the same apply succeeds, and the cache and
      the disk both equal the theme's values.
  - **A valid theme updates the cache.** Extend `TestApplyTheme`
    (`preferences_themes_test.go:292-326`), which checks only the disk
    (`:316-325`). It loads before applying and asserts that the cache equals
    the disk.
- [x] Build the leaf, the binding rows, `Validate`/`Repair`, and the split
  `normalizeSettingsFile`, with import validating before repair. Delete the
  duplicate helpers and defaults listed in the inventory. Fix the `ApplyTheme`
  cache sync. Rename the key references.
- [x] `gocognit -over 12` on every changed or new Go function.

#### Phase 1 record (2026-10-23, uncommitted)

- **Red, confirmed before the fix:**
  - every default-rule integer gave its minimum for 0 and −0.1 (the metrics
    interval already defaulted);
  - 1001 normalized to 1000;
  - a stored `"sepia"`, `"per-cluster"`, `"left"`, `"#zzz"`, `"blue"`, 999,
    −5, 80, and 37 all survived load, export, and the next save;
  - page size 37 stayed 37;
  - an applied out-of-range theme stayed raw in the cache and on disk;
  - the leaf test failed to compile.
- **Guards, green before and after:**
  - the color-import rejection;
  - the fractional-import parse failure, with the settings file unchanged;
  - QPS 0.9 → 1, width 0.5 → 500, brightness −0.5 → 0 and −10.7 → −10;
  - the failed-apply test;
  - `TestApplyTheme`, now loading first and comparing the cache to the disk;
  - the existing legacy tests: theme key, palette migration, `background`,
    `maxTableRows`, and the absent-field defaults.
- **Built as sketched, with these refinements:**
  - Defaults and bounds are exported leaf constants that the rows reference,
    because `app.go`, the cluster runtime, refresh setup, and the gateway start
    their owners from them.
  - The zoom bounds are constants, and `TablePageSizeOptions()` returns the
    list.
  - `Validation` is a typed string, and `Label` carries the enum error noun, so
    the existing error text is unchanged.
  - The sink guards (`runtime_setting_policies.go`,
    `cluster_runtime_clients.go`) now repair (0 → default) instead of clamping.
    No test or caller feeds them 0 (grep).
- **Other changes:**
  - The comment-only `AppSettings` edits changed the generated
    `frontend/bindings/.../types/models.ts` (JSDoc only). It was regenerated
    with the pinned Wails command, and `qc:bindings` passes.
  - The backend bullet of `app-preferences.md` was corrected now rather than
    left false until Phase 5. The rest of the rewrite stays in Phase 5.
  - Test edits:
    - The old "0 → minimum" assertions were removed; the non-positive table
      test supersedes them.
    - The page-size test now expects off-list values to become 50.
    - `TestAppSaveAndLoadAppSettingsRoundTrip` seeded a malformed accent color
      (`"#326ce5."`) and expected it to survive. That is the stored-invalid
      behavior Q6 replaces, so the fixture is now `"#326ce5"`.
- **Evidence:**
  - `go test ./backend/ ./backend/internal/preferenceschema/` passed.
  - `wails3 task test:backend-coverage` passed. Statement coverage:
    `preferenceschema/schema.go` 88.6%, `preferences_settings.go` 89.0%,
    `preferences_settings_data.go` 96.2%, `data_management_import_export.go`
    84.5%, `cluster_runtime_clients.go` 84.5%.
  - `runtime_setting_policies.go` (77.8%) and `kubernetes_rate_limiter.go`
    (54.3%) are below 80%. The changed lines are covered; the gaps are
    pre-existing nil-receiver guards and untouched floor branches.
  - `gocognit` maximum: 8.
  - `wails3 task qc:prerelease` exited 0 (frontend 4979 tests passed), and the
    worktree was unchanged afterwards.
- **Not run:** the native check, which comes at the end of the work
  ([Validation](#validation)).

### Phase 2: generator and parity vectors (no frontend consumer change)

- [x] Red render tests in `backend/internal/genpreferences`:
  - every spec key appears in declaration order;
  - enum and `IntOptions` unions are typed;
  - the zoom and hex pattern are emitted;
  - the vectors contain each rule's boundary cases.
- [x] Generator, `cmd`, the `generate.go` line, both outputs, and freshness
  tests in package `backend` modeled on `kind_facets_test.go:21-33`.
- [x] Biome excludes (three blocks) and the suppression-script list.
- [x] TypeScript parity test, red today:
  1. the hand-written fallback metadata equals the generated spec field by
     field (expected to fail on the SSRR runtime flag);
  2. the current TypeScript normalization over the vectors equals Go's
     `Repair`. It runs each input through hydration, so each key keeps its
     current options. By code reading, it is expected to fail on two cases:
     - negative palette fractions: Go truncates
       (`preferences_settings.go:929-932`), TypeScript floors
       (`appPreferences.ts:538`). The positive-fraction cases are expected to
       pass;
     - a wrong-typed integer, for example a string: TypeScript returns `NaN`,
       because `Number.isNaN` is false for a string and the comparisons with
       `NaN` are false (`appPreferences.ts:530-545`).

  Record the failing output.

### Phase 3: frontend reads the generated contract

- [x] Delete the TypeScript copies and derive from the generated module (see
  the inventory tables for TypeScript). Add the type guard against
  `types.AppSettings`.
- [x] Update the other definitions and consumers, and the TypeScript tests in
  the inventory.
- [x] Wire the Day.js exception through the typed validation-kind record. Keep
  the `"foo"` hydration test and add the padded-format case (Q10). This test
  is separate from the parity test.
- [x] The Phase 2 parity test is green. No harness Settings suite needs a
  behavioral change: `AdvancedSection`, `LogsSection`, `ObjectPanelSection`,
  `DisplaySection`, `AppearanceSection`, `DataManagementSection`, and
  `preferenceConcurrency`.
- [x] `npm run complexity --prefix frontend -- <changed files>`, max 12.

### Phase 4: retire the runtime schema RPC (Q3, Q8)

- [x] Red: remove the harness's `GetAppSettingsSchema` answer
  (`harness.tsx:660`). Hydration still calls it. An unanswered call rejects
  (`frontend/src/test-utils/appState/transport.ts:114-117`), and the harness
  fails any test that left an RPC unfaked (`harness.tsx:951-953`), so every
  harness test goes red until hydration stops calling it.
- [x] Hydrate from `GetAppSettings` only. Keep and test fail-closed error
  reporting when that read fails.
- [x] Delete:
  - `GetAppSettingsSchema` (`preferences_settings.go:881-889`,
    `desktop_service.go:44,328-329`);
  - the schema DTOs (`types.go:79-97`);
  - `buildAppSettingsSchema` and `appPreferenceKeys` if it is left unused;
  - `RuntimeSideEffect` in the leaf;
  - `readAppSettingsSchema` (`frontend/src/core/app-state-access/readers.ts:22`);
  - the schema fixture and the schema tests.
- [x] Regenerate the Wails bindings (`generate:bindings`,
  `build/Taskfile.yml:191-206`) and pass `qc:bindings`.

#### Phases 2–4 record (2026-10-23, uncommitted)

- **Phase 2.**
  - Red: the generator package did not compile; the freshness tests reported
    the missing outputs.
  - The TS parity test was red with 51 failures:
    - 18 metadata rows: no `nonPositive` on range integers, no `intOptions` on
      page size, and SSRR `runtimeSideEffect: false`;
    - 33 hydration vectors: wrong-typed booleans kept the raw string,
      wrong-typed integers became `NaN`, and negative palette fractions floored
      (−0.5, −10.7, −49.5).
  - Green: 291 vectors across 36 keys.
- **Phase 3.**
  - One `repairPreferenceValue` replaces every per-key normalizer, behind a
    typed validation-kind record.
  - The parity test went green after fixing `Math.trunc`'s `-0` to the `0`
    that Go gives.
  - These were deleted: the two tests of runtime metadata overriding
    (`exposes typed preference metadata from the backend schema`,
    `tracks schema metadata for every appPreferences key`). Their behavior is
    intentionally removed, and the parity test covers every key.
  - The two tests that used the schema fixture were rewritten, and the fixture
    (`appPreferences.test.ts:99-377`) was deleted with them.
  - Added: the padded Day.js format case.
- **Phase 4.**
  - Red: removing the harness schema answer failed 12/12 harness tests in the
    bootstrap and Advanced suites (`Unfaked RPCs: GetAppSettingsSchema`).
  - These were deleted: the RPC, the DTOs, the backend aliases,
    `buildAppSettingsSchema`, `appPreferenceKeys`, `RuntimeSideEffect`,
    `readAppSettingsSchema`, and the facade export.
  - The bindings were regenerated.
  - `desktop_service_ownership_contract_test.go` now counts 12 preference
    commands and 117 in total.
  - The Go tests of the schema RPC (defaults and key coverage) were deleted;
    the spec and binding-coverage tests replace them.
- **Complexity.** `gocognit` and the Biome complexity check report no changed
  function above 12.
  - `getObjPanelLogsApiTimestampFormatValidationError` scores 14. It is
    unchanged and pre-existing; only that file's default constant changed.

- **Final gate, all phases.**
  - `test:backend-coverage` passed. Statement coverage:
    `preferenceschema/schema.go` 88.6%, `genpreferences/render.go` 97.3%,
    `preferences_settings.go` 88.8%, `preferences_settings_data.go` 96.7%,
    `data_management_import_export.go` 84.5%, `cluster_runtime_clients.go`
    84.5%.
  - Below 80%, untouched beyond a line or two: `runtime_setting_policies.go`
    77.8% (nil guards) and `desktop_service.go` 33.8% (two lines removed).
  - `test:frontend-coverage` passed. Changed files: `appPreferences.ts` 98.7%,
    the generated contract 100%, `pageSizeOptions.ts` 100%, `paletteTint.ts`
    100%, `ZoomContext.tsx` 98.2%, `AppearanceSection.tsx` 83.3%, and the
    others are at least 93%.
  - The first `qc:prerelease` run failed once, on
    `refresh/containerlogsstream` `TestTargetLimitWarningFollowsANewPod`
    ("Condition never satisfied" under the full `-race` load). That package has
    no changes and does not import the new code. The test passed 5/5 alone
    under `-race`.
  - The rerun of `qc:prerelease` exited 0: every stage, with frontend 5303
    tests passing. `git diff --check` is clean.

### Phase 5: documentation and close-out

- [x] Rewrite the affected parts of `app-preferences.md`:
  - backend schema: the leaf owns the metadata, the binding owns the fields
    and effects, and settings are generated;
  - frontend metadata: there is no fallback metadata, and Settings reads the
    generated spec;
  - remove the runtime-effect flag bullet.

  Then update the `generate.go` comment and the `app-shell` skill paths.
- [ ] Release note: decide with John. None is expected, because the UI already
  shows repaired values [assumed until the native check].
- [ ] Move durable guidance into `app-preferences.md`, then delete this plan.

## Open questions (recommended answers first)

1. **Where does the Go schema live?** In a leaf package,
   `backend/internal/preferenceschema`, with the binding in package `backend`.
   - The alternative is an exported render function in package `backend`. A
     generator importing the root Wails package would compile the whole
     backend.
   - In that alternative, the freshness test in package `backend` could not
     import the generator without an import cycle.
   - The leaf follows the precedent of the kind registry feeding
     `genkindfacets`.
2. **Sibling generator or `genrefreshcontracts`?** A sibling,
   `genpreferences`. `genrefreshcontracts` reflects the refresh wire DTOs. The
   value catalogs (`genobjectactions`, `genkindfacets`) are already separate
   siblings (`backend/generate.go:15-21`).
3. **Keep runtime delivery of metadata?** No: retire `GetAppSettingsSchema`
   and hydrate from `GetAppSettings`.
   - The frontend and backend ship as one binary, so build-time metadata
     always matches the runtime.
   - The RPC's only reader is hydration (`readers.ts:22`). The rest are the
     harness and tests (grep).
   - Its values duplicate `GetAppSettings`.

   Keeping it would leave vestigial fields and a second channel.
4. **Who owns the page-size list?** The Go spec, as `IntOptions`.
   - Membership is exact: only a raw number equal to an option is kept, so
     fractions such as 25.5 count as off-list, as they do in the frontend today
     (`pageSizeOptions.ts:15-20`).
   - An off-list value repairs to the default everywhere: update, import, and
     load. It never rejects, so an older export with an unusual size still
     imports.
   - A fractional size can arrive only through `UpdateAppPreferences`. In
     `settings.json` or an import file it fails to parse, as it does today
     ([Go schema leaf](#go-schema-leaf)). The list
   has not changed since it was introduced (`git log -S TABLE_PAGE_SIZE_OPTIONS`
   on `pageSizeOptions.ts` shows only `ed7d8125`). `pageSizeOptions.ts` stays
   the frontend import point.
5. **Non-positive integers?** One spec rule used by Go apply, Go load, and
   TypeScript: `default` for every integer whose minimum is ≥ 1, and `clamp`
   for the palette.
   - The rule tests the raw number before truncation (see
     [the conversion order](#go-schema-leaf)). QPS 0.9 therefore stays the
     minimum, 1, on both sides, as today.
   - Go apply changes for a raw number ≤ 0, including −0.1: it becomes the
     default instead of the minimum. The UI never sends one
     (`SettingsControls.tsx:159-161`, `appPreferences.ts:604-632`).
   - TypeScript changes only for negative palette fractions, from floor to
     truncation (−0.5 becomes 0 instead of −1). Sliders and `parseInt` give
     integers.
   - The alternative is to truncate first, as Go does today. Then QPS 0.9
     would become the default, 200, and break the existing expectation at
     `appPreferences.test.ts:1389-1390`.
6. **Should Go load repair everything the UI repairs?** Yes. Go then holds what
   the UI already shows, and the file is corrected on the next save. Import
   still rejects unknown enums and malformed colors, because it validates
   before repair.
7. **Zoom?** Emit the bounds and default as `ZOOM_LEVEL`; do not make zoom an
   `AppPreference`. It keeps its own commands
   (`preferences_settings.go:1020-1051`). `ZOOM_STEP` stays in the frontend.
8. **`runtimeSideEffect`?** Remove it in Phase 4. It has no reader (grep), it
   has already drifted (SSRR), and the six effect routes are encoded
   separately in `settingsSideEffects`. The alternative is to emit it and
   update `app-preferences.md:68-70`, which reserves it for diagnostics.
9. **Hex color pattern?** Emit it from Go and replace the three TypeScript
   copies.
10. **Day.js validation?** It stays in TypeScript
    (`objPanelLogsApiTimestampFormat.ts`). Go keeps "non-empty, else default".
    - This is the one sanctioned normalization difference between Go and
      TypeScript (see [TypeScript side](#typescript-side)). Go may hold a
      non-empty unsupported format, which the UI shows as the default.
    - It is tested apart from exact parity. The existing hydration test for
      `"foo"` (`appPreferences.test.ts:640-649`) is kept. A case for a padded
      format that hydrates trimmed is added; a grep of `appPreferences.test.ts`
      found none.
    - The alternative is to move the supported-token list into the spec and
      port the tokenizer to Go with its own vectors. That would be a second
      tokenizer for a value only the frontend reads, so it is not recommended.
11. **Appearance live-preview?** A separate, already-declined item (see
    [Non-goals](#non-goals)). It is not folded in.
12. **Where do the parity vectors live?** In a generated JSON fixture beside
    the store, imported only by its test, so they never reach the bundle. The
    alternative is to embed them in the generated TypeScript module.
13. **The `index.html` first-paint default?** Keep it as a documented
    exception. It is an inline script that runs before any module loads, and a
    source-text test of it would be the kind of test `testing.md` rules out.
14. **Palette CSS divisors?** Use the spec maxima in `paletteTint.ts:53-54` and
    `AppearanceSection.tsx:1096-1099`. Do not deduplicate the preview math
    further; that is presentation and out of scope.

## Validation

Apply the [completion evidence gate](../workflows/completion.md). Each item
below is required before this work may be called done.

- **Generator output.**
  - Render tests (Phase 2).
  - Freshness tests for both generated files fail when the committed output is
    stale. Prove it once by editing a scratch copy, never with `git stash`.
- **Parity.**
  - The TypeScript parity test: generated spec versus TypeScript metadata, and
    the TypeScript normalizer versus Go `Repair` vectors. It fails when Go and
    TypeScript disagree. It was red in Phase 2, with the output recorded, and
    green in Phase 3.
  - The stricter Day.js repair is tested separately (Q10). The vectors exclude
    the cases where the two sides differ by design, so the exception cannot
    hide a real parity failure for any other key.
  - The type guard against `types.AppSettings` fails `qc:typecheck` on a
    renamed field. Prove it once in a scratch copy.
  - The Go spec test: keys match the binding and the `AppSettings` JSON tags.
- **Settings behavior on the real-state harness.**
  - The seven Settings suites listed in Phase 3 pass, including bound clamping
    to the spec max (`AdvancedSection.test.tsx:122-157`) and rollback and
    other-window updates (`preferenceConcurrency.test.tsx`).
  - Every harness test passes with no `GetAppSettingsSchema` answer.
- **Persisted-settings compatibility (Go).**
  - The Phase 1 guard tests: legacy keys and migrations, absent fields, and
    import rejection.
  - The repair tests (Q4–Q6).
  - The per-key round trip.
  - The theme-application tests: repaired theme values agree across the
    cache, the disk, and a later unrelated save, and a failed apply changes
    neither.
  - The existing whole-batch rejection and six-route tests stay green:
    `preferences_settings_test.go:1136,1154,1239` and
    `data_management_import_export_test.go:498`.
- **Coverage.** `mise exec -- wails3 task test:backend-coverage` and
  `test:frontend-coverage` on the changed files, targeting 80%; report any gap.
- **Complexity.** `gocognit -over 12` and the Biome complexity check on every
  changed function.
- **Final gate.** `mise exec -- wails3 task qc:prerelease`, then inspect the
  worktree. Also run `qc:docs` and `git diff --check` for the doc changes.
- **Native check.** First ask John which cluster the app may reach, because
  the app autoconnects the persisted cluster. In the native window:
  - Settings → Advanced, Logs, Object Panel, Display, and Appearance show the
    defaults and enforce the bounds;
  - a `settings.json` with out-of-range and invalid values opens repaired;
  - zoom stops at 50% and 200%.

## Adversarial self-review (2026-10-23)

Each item was checked against the code before this plan was presented.

1. **"Follow the genrefreshcontracts reflection pattern."** That pattern
   reflects Go wire types. Preferences are value data, like the action catalog
   and the kind facets, so a sibling value generator fits (Q2).
2. **Map ordering.** A naive JSON map would sort the keys and silently reorder
   subscriber notifications (`appPreferences.ts:663-664`). The plan renders an
   ordered slice.
3. **Import weakening.** Repairing at load would have let an import with an
   unknown enum through, because import normalizes before validating
   (`data_management_import_export.go:222-235`). The plan validates before
   repair. The enum case already has a test
   (`data_management_import_export_test.go:448`); the plan adds the color case
   first.
4. **Page-size rejection would break old exports.** An early draft rejected
   off-list sizes. Import validates through apply, so an older export holding
   an unusual size would have failed whole. Changed to repair-to-default
   everywhere (Q4).
5. **"Retiring the RPC is safe."** Checked the consumers: one reader
   (`readers.ts:22`), the harness answer, and tests (grep). Fail-closed error
   reporting depends on the read failure flag (`appPreferences.ts:1031-1038`),
   which `GetAppSettings` still provides through `fetchPreferences`
   (`:944-960`).
6. **"No UI behavior changes."** The Go apply change (Q5) is unreachable from
   the UI, which normalizes before sending. Load repair (Q6) yields the values
   the UI already showed. The one TypeScript change is negative palette
   fractions (truncate instead of floor), which only `setPaletteTint` callers
   with fractional input could reach; sliders and `parseInt` give integers.
   Positive fractions keep today's frontend result in both cases:
   - range integers, because the non-positive rule tests the raw number first
     ([review round 1](#review-round-1-2026-10-23), item 1);
   - page sizes, because they match options exactly with no truncation
     ([review round 2](#review-round-2-2026-10-23), item 2).

   Go apply does change for fractional page sizes (25.5 becomes 50, not 25),
   within Q4.
   Confirming this in the native window is still required
   ([Validation](#validation)).
7. **Cycle risk of the leaf.** Its imports (`config`, `containerlogs`) are
   already imported by generator packages, and none of the checked packages
   imports the root (grep). The import graph beyond those packages was not
   traced; `go build` in Phase 1 is the proof.
8. **Theme cache mismatch.** Found while tracing `ApplyTheme` (its cache sync
   is at `preferences_settings.go:1217-1230`). It is handled in Phase 1, with
   its own tests ([review round 1](#review-round-1-2026-10-23), item 3), not
   left as a latent mismatch.
9. **Dead code.** These are removed in the change that makes them vestigial:
   the `defaultOnNonPositive` option, `currentValue` in the metadata,
   `runtimeSideEffect`, the schema DTOs, and, if left unused,
   `appPreferenceKeys`.
10. **Corrections from re-reading.** A first draft said:
    - no import test rejects an invalid enum: wrong, line 448 does;
    - only the bootstrap suites would go red without the schema answer: every
      harness test fails on an unfaked RPC.

    Five line ranges were also off by a few lines. All are fixed above.
11. **Wrong-typed values.** Tracing the TypeScript integer normalizer for the
    vectors showed it returns `NaN` for a string (`appPreferences.ts:530-545`).
    This is now an expected red case in Phase 2, not an unexamined gap.
12. **Test value.** The parity vectors cover distinct normalization rules
    (`testing.md`: "boundary values" and "nontrivial data contract"). They are
    not a copy of the table. The schema-copy fixture
    (`appPreferences.test.ts:99-377`) is deleted, not regenerated.

## Review round 1 (2026-10-23)

Each comment was checked against the code before the plan was revised.

1. **Integer conversion order and positive fractions (P2): accepted.**
   - Go truncates before any rule (`preferences_settings.go:929-932`). The
     first draft applied the non-positive rule after truncation, so QPS 0.9
     would have become the default, 200. The existing TypeScript test expects
     the minimum, 1 (`appPreferences.test.ts:1389-1390`).
   - Revision: the rule tests the raw number before truncation, and the
     conversion order is now explicit in the sketch and in
     [Go schema leaf](#go-schema-leaf), with a table of today's and planned
     results.
   - Positive fractions keep today's result on both sides. Round 2 corrected
     this: under this round's order, page sizes did not keep it. The remaining
     changes are listed: Go apply for ≤ 0 (Q5), Go apply for off-list page
     sizes (Q4), and TypeScript for negative palette fractions.
   - Positive-fraction vectors (0.9 and min + 0.5) and Go guard tests were
     added.
   - A scratch probe confirmed Go's truncation and that a fraction in
     `settings.json` fails the parse instead of reaching `Repair`.
2. **The Day.js exception (P2): accepted.**
   - Go keeps any non-empty format (`preferences_settings_data.go:173-189`).
     TypeScript repairs `"foo"` to the default (`appPreferences.test.ts:640-649`)
     and trims (`objPanelLogsApiTimestampFormat.ts:118-128`).
   - Revision: [TypeScript side](#typescript-side) names it the one sanctioned
     difference, keeps that normalization in the TypeScript checker behind a
     typed validation-kind record, and limits that key's vectors to the cases
     both sides share.
   - Q10 and Phase 3 test it separately: the `"foo"` case is kept and a
     padded-format case is added.
3. **Theme-cache regression tests (P2): accepted.**
   - `TestApplyTheme` checks only valid values on disk
     (`preferences_themes_test.go:292-326`). The publish-after-persistence
     table has no apply case (`:467-518`).
   - Revision: Phase 1 adds four cases:
     - repaired theme values agree across the cache and the disk;
     - a later unrelated save keeps them;
     - a failed apply changes neither;
     - a valid apply updates the cache.

     Validation lists them.

## Review round 2 (2026-10-23)

Each comment was checked against the code before the plan was revised.

1. **Theme-cache tests must run on a loaded cache (P2): accepted.**
   - `ApplyTheme` updates the cache only when it exists
     (`preferences_settings.go:1217-1218`). The fixture loads lazily
     (`preferences_settings_test.go:1560`). `EnsureLoaded` serves the cache
     once loaded (`preferences_service.go:140-146`) and reads the disk
     otherwise (`:147-162`).
   - So the round-1 success cases, which read after applying, could have
     passed off the repaired disk with a broken cache update.
   - The round-1 failure case, as a row in the existing table, could not have
     seen an apply leak into the active values: the table seeds zero palettes
     (`preferences_themes_test.go:473-474`) and asserts only `Themes`
     (`:497-499`).
   - Revision: every theme case loads before applying. The failure case is its
     own test: it seeds distinct active palette, accent, and link values, and
     asserts them after the failed apply.
2. **Fractional page sizes would have changed the frontend (P2): accepted.**
   - Round 1's order truncated before the option check, so 25.5 would have
     become 25. The frontend's `includes` check turns it into the default, 50
     (`pageSizeOptions.ts:15-20`).
   - Revision: option-list integers match the raw number exactly, so a
     fraction is off-list and becomes the default. Only range integers
     truncate.
   - 25.5, 100.5, 37, and 1001 vectors were added, and table rows for them.
   - The Phase 1 Q4 red test now covers 25.5 and 100.5 (today Go keeps 25 and
     100).
   - The positive-fraction claim in self-review item 6 was corrected. The
     frontend keeps today's result for every positive fraction; Go apply
     changes for fractional page sizes, within Q4.

## Review round 3 (2026-10-23)

1. **Fractional page sizes in imports cannot reach validation (P2):
   accepted.**
   - Import decodes straight into `settingsPreferences`
     (`data_management_import_export.go:206-208`, through the alias at
     `preferences_settings.go:150-155`). Its page-size field is an `int`
     (`:122`), and `encoding/json` refuses a fraction there (the round-1
     scratch probe). So an import with 25.5 fails to parse, and round 2's
     "import with 25.5 stores 50" test could never pass.
   - Revision: Phase 1 now splits the Q4 tests:
     - `UpdateAppPreferences` covers 37, 999999, 25.5, and 100.5;
     - import covers 37 and 999999;
     - a green-today guard pins that a fractional import fails with the parse
       error and leaves settings unchanged.
   - The fraction-path note in [Go schema leaf](#go-schema-leaf) and Q4 now
     name import files alongside `settings.json`.
