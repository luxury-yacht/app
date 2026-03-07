Resource Creation Frontend Review

I've read every file in the create-resource/ directory and the parent modal. Here's my assessment organized by severity.

Architecture: What's Working Well

- YAML as source of truth with bidirectional sync is a solid design
- Declarative form definitions (formDefinitions.ts) driving a generic renderer is the right approach
- Extracted primitives (FormSectionCard, FormFieldRow, FormActionPrimitives, FormKeyValueListField, FormNestedListField, FormCompactNumberInput, FormTriStateBooleanDropdown,
  FormContainerResourcesField) are all well-shaped and reusable
- Multi-cluster awareness is properly handled — cluster ID is pinned at creation time

---

Critical Issues

1. ResourceForm.tsx is a 2,224-line monolith — GroupListField alone is ~1,100 lines

The GroupListField component (lines 1008–2122) contains the volume source editor (~500 lines), ConfigMap/Secret items editors, volume mount special cases, container resources wiring, and nested
group-list rendering — all inline. This is the single biggest reusability blocker. When you add a StatefulSet or DaemonSet form, you'll need all the same volume/container logic but it's trapped inside
this function.

Key extractions needed:

- FormVolumeSourceField — the case 'volume-source' block (lines 1218–1707) should be its own component
- FormVolumeItemListField — ConfigMap items (lines 1550–1626) and Secret items (lines 1628–1703) are nearly identical; they should share a single component parameterized by source type
- FormVolumeMountFields — the volume mount special cases for readOnly, subPath/subPathExpr toggle (lines 1849–1961) should be extracted

2. Duplicate utility code across files

INPUT_BEHAVIOR_PROPS is defined 3 separate times:

- ResourceForm.tsx:435
- FormKeyValueListField.tsx:19
- FormCompactNumberInput.tsx:23

getNestedValue is implemented twice with identical behavior:

- ResourceForm.tsx:58 — getNestedValue
- FormContainerResourcesField.tsx:39 — getNestedResourceValue

toPersistedMap and arePersistedMapsEqual are duplicated between KeyValueListField (lines 729–758) and SelectorListField (lines 910–931).

These should live in a shared formUtils.ts.

3. CSS uses data-field-key attribute selectors for field sizing — tightly coupling styling to specific field names

There are ~140 lines of CSS rules like:
.resource-form-nested-group-list[data-field-key="ports"] ...
.resource-form-nested-group-list[data-field-key="env"] ...
.resource-form-nested-group-list[data-field-key="volumeMounts"] ...
.resource-form-nested-group-field input[data-field-key="containerPort"] ...

This means every new resource type that uses ports, env vars, or any field with specific sizing requires new CSS rules. The sizing should be driven by the form definition (e.g., a width or sizing
property on FormFieldDefinition) and applied via inline styles or utility classes, not content-coupled selectors.

4. Hardcoded field-specific logic in the renderer defeats the purpose of declarative definitions

Several places in ResourceForm.tsx check specific field keys:

- buildSelectOptions (line 144): field.key !== 'protocol' — hardcoded empty-option exclusion
- getSelectFieldValue (line 158): field.key === 'protocol' — hardcoded default
- getItemTitle (line 1084): checks isContainerGroup, isVolumeGroup
- handleAdd in KeyValueListField (line 839): hardcoded behavior for labels/annotations
- addButtonLabel/addGhostText (lines 780–793): hardcoded for labels/annotations
- showInlineKeyValueLabels (line 715): hardcoded for labels/annotations

Each of these should be a property on FormFieldDefinition so the renderer stays generic. For example:

- includeEmptyOption?: boolean (defaults true)
- implicitDefault?: string (e.g., 'TCP' for protocol)
- itemTitleField?: string (e.g., 'name' so the header shows the container name)
- addButtonLabel?: string, addGhostText?: string
- inlineLabels?: boolean

---

Moderate Issues

5. CSS has significant duplication and inconsistent units

- Lines 448–471: ConfigMap items and Secret items field sizing are copy-pasted
- Lines 534–590: Port and env var sizing blocks are structurally identical
- resource-form-nested-group-label, resource-form-kv-inline-label, resource-form-container-resources-metric-label, and resource-form-container-resources-row-label are all nearly identical small-caps
  label styles
- Mix of 0.5rem, var(--spacing-xs), var(--spacing-sm), and bare 1rem/6px values for gaps/padding — should consistently use CSS variables

6. FormEmptyActionRow is over-parameterized

It takes 11 props including raw CSS class names (rowClassName, spacerClassName, actionsClassName, alignLeftClassName). This tightly couples it to specific CSS structures. A simpler API with a layout
variant prop ('inline' | 'block') and an align prop ('left' | 'right') would be more reusable.

7. No FormTextField or FormSelectField sub-field components

Text inputs are rendered inline in at least 4 places within GroupListField:

- renderSubField case 'text' (line 1107)
- renderNestedLeafField case 'text' (line 1964)
- Volume source extra fields text (line 1478)
- Volume source name/value inputs (lines 1529, 1510)

Same for select/dropdown rendering (3+ inline instances). Extracting FormSubTextField and FormSubSelectField would eliminate this duplication and make the renderer much shorter.

---

Minor Issues

- Commented-out CSS on line 12: /_ padding: var(--spacing-sm); _/
- FormFieldRow silently drops the label when fullWidth is true (line 27) — this implicit behavior could surprise consumers
- FormContainerResourcesField uses raw autoCapitalize/autoCorrect/spellCheck props instead of the shared INPUT_BEHAVIOR_PROPS pattern (line 100–103)
- canRemoveEntry in FormKeyValueListField defaults to () => true via inline check (line 46) rather than a prop default

---

Recommendations Summary (prioritized)

1. ✅ Extract FormVolumeSourceField from the 500-line inline block — this is the biggest single win for readability and reusability
2. ✅ Create formUtils.ts for shared utilities: getNestedValue, setNestedValue, unsetNestedValue, INPUT_BEHAVIOR_PROPS, toStringMap, toMapEntries, toPersistedMap, arePersistedMapsEqual
3. ✅ Add definition-driven sizing to FormFieldDefinition (e.g., width?: string, implicitDefault?: string, includeEmptyOption?: boolean, itemTitleField?: string, addLabel?: string) to eliminate hardcoded
   field-key checks in the renderer
4. ✅ Replace data-field-key CSS sizing with definition-driven inline styles or a small set of width utility classes (--compact, --medium, --wide)
5. ✅ Extract a shared FormVolumeItemListField for ConfigMap/Secret items (key/path/mode pattern)
6. ✅ Consolidate label CSS — unify the 4 nearly-identical small-caps label classes into one

⏺ Good, the background agent confirmed the existing app patterns. Key context that reinforces my review:

- The app uses a well-defined design token system (--spacing-xs/sm/md/lg, --color-_, --font-size-_, --border-radius-\*)
- Object panel sections use .overview-item with .overview-label (min-width 8rem, uppercase) — the ResourceForm.css correctly mirrors this
- The BEM-inspired naming with kebab-case is consistent

My review above is complete. The biggest wins for reusability are:

1. Extract FormVolumeSourceField (~500 lines out of ResourceForm.tsx)
2. Create formUtils.ts to deduplicate INPUT_BEHAVIOR_PROPS, getNestedValue, toPersistedMap, etc.
3. Move field sizing into FormFieldDefinition to eliminate ~140 lines of data-field-key CSS selectors
4. Add renderer-configuration props to FormFieldDefinition (includeEmptyOption, implicitDefault, itemTitleField, addLabel, inlineLabels) to eliminate hardcoded field-key checks
