/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Yaml/yamlTabTypes.ts
 *
 * Type definitions for yamlTabTypes.
 */
export interface YamlTabProps {
  scope: string | null;
  isActive?: boolean;
  canEdit?: boolean;
  editDisabledReason?: string | null;
}
