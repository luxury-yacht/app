1. ✅ GroupListField is still a ~750-line god component

Extracted the nested group-list rendering (~290 lines) into NestedGroupListField.tsx. GroupListField dropped from ~630 to ~340 lines. Moved shared helpers (shouldOmitEmptyValue, buildSelectOptions, getSelectFieldValue, fieldFlexStyle) to formUtils.ts. Removed hardcoded availableVolumeNames — disableAdd is now computed generically from dynamic options resolution. Added disabledGhostText to FormFieldDefinition for definition-driven disabled state messaging.

2. ✅ Volume mount logic is still hardcoded against field keys in the renderer

Added `boolean-toggle` field type, `alternatePath`/`alternateLabel` for text-with-toggle, and `dynamicOptionsPath`/`dynamicOptionsField` for runtime-resolved select options. All `isVolumeMountsList` hardcoded checks removed from renderNestedLeafField; behavior now driven entirely by formDefinitions.

3. ✅ Dead code in FormVolumeSourceField JSX

Removed the unreachable fallback text input.

4. ✅ VolumeSourceExtraFieldDefinition is a parallel type system

Eliminated VolumeSourceExtraFieldDefinition; extra fields now use FormFieldDefinition directly.

5. ✅ ConfigMap/Secret items handlers are copy-pasted

Replaced with makeSourceItemsHandlers factory.

6. ✅ Leaky prop interface on FormVolumeSourceField

Changed from items/itemIndex/updateItems to item/updateItem callback pattern.

7. ✅ Three redundant constants for the same mapping

Removed VOLUME_SOURCE_ROOT_PATHS; derived from Object.values(VOLUME_SOURCE_ROOT_BY_KEY).

8. ✅ sourceOptions is recomputed every render

Moved to module-level VOLUME_SOURCE_OPTIONS constant.

9. ✅ CSS button duplication

Consolidated .resource-form-add-btn and .resource-form-remove-btn shared base styles.

---

Of these, item 1 is the remaining work — decomposing GroupListField into smaller, focused components.
