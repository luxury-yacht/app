import type { PanelBlockReason } from '@/core/panel-windows/panelLifecycleGuards';

interface YamlPanelGuardState {
  isEditing: boolean;
  isSaving: boolean;
  draftYaml: string;
  baselineYaml: string;
}

const normalizeYamlText = (value: string): string => value.replace(/\r\n/g, '\n').trimEnd();

export const getYamlPanelBlockReason = ({
  isEditing,
  isSaving,
  draftYaml,
  baselineYaml,
}: YamlPanelGuardState): PanelBlockReason | null => {
  if (isSaving) {
    return 'mutation-in-flight';
  }
  if (isEditing && normalizeYamlText(draftYaml) !== normalizeYamlText(baselineYaml)) {
    return 'unsaved-yaml';
  }
  return null;
};
