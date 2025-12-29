/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Yaml/yamlTabTypes.ts
 *
 * Type definitions for yamlTabTypes.
 * Defines shared interfaces and payload shapes for the object panel feature.
 */

export interface YamlTabProps {
  scope: string | null;
  isActive?: boolean;
  canEdit?: boolean;
  editDisabledReason?: string | null;
  clusterId?: string | null;
}
