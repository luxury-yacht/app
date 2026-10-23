import type { PanelBlockReason } from '@/core/panel-windows/panelLifecycleGuards';
import { sanitizeYamlForSemanticCompare } from './yamlFieldPolicy';

interface YamlPanelGuardState {
  isEditing: boolean;
  isSaving: boolean;
  /** The draft holds edits Save would apply (hasUnsavedYamlEdits). */
  hasUnsavedEdits: boolean;
}

const normalizeYamlText = (value: string): string =>
  sanitizeYamlForSemanticCompare(value).replace(/\r\n/g, '\n').trimEnd();

/**
 * The draft differs from the YAML editing began from, ignoring the fields the
 * editable draft leaves out (status, managedFields, and other server-owned
 * fields). A change someone else makes to the live object is not an edit.
 */
export const hasUnsavedYamlEdits = (draftYaml: string, baselineYaml: string): boolean =>
  normalizeYamlText(draftYaml) !== normalizeYamlText(baselineYaml);

export const getYamlPanelBlockReason = ({
  isEditing,
  isSaving,
  hasUnsavedEdits,
}: YamlPanelGuardState): PanelBlockReason | null => {
  if (isSaving) {
    return 'mutation-in-flight';
  }
  if (isEditing && hasUnsavedEdits) {
    return 'unsaved-yaml';
  }
  return null;
};
