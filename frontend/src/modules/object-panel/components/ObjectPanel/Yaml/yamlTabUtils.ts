/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Yaml/yamlTabUtils.ts
 *
 * Utility helpers for yamlTabUtils.
 * Provides shared helper functions for the object panel feature.
 */

import * as YAML from 'yaml';
import {
  ApplyObjectYaml,
  CheckObjectYamlOwnership,
  MergeObjectYamlWithLatest,
} from '@/core/backend-api';
import type { ObjectYamlMutationResponse } from './yamlErrors';
import { YAML_STRINGIFY_OPTIONS } from './yamlTabConfig';
import type { ObjectIdentity } from './yamlValidation';

export { sanitizeYamlForSemanticCompare } from './yamlFieldPolicy';

export const normalizeYamlString = (raw: string): string => {
  try {
    const doc = YAML.parseDocument(raw);
    if (doc.errors.length > 0) {
      throw doc.errors[0];
    }
    return doc.toString(YAML_STRINGIFY_OPTIONS);
  } catch {
    return raw;
  }
};

export const prepareDraftYaml = (raw: string, includeManagedFields: boolean): string => {
  try {
    const doc = YAML.parseDocument(raw);
    if (doc.errors.length > 0) {
      throw doc.errors[0];
    }
    if (!includeManagedFields) {
      const metadata = doc.get('metadata');
      if (metadata && typeof metadata === 'object') {
        doc.deleteIn(['metadata', 'managedFields']);
      }
    }
    return doc.toString(YAML_STRINGIFY_OPTIONS);
  } catch {
    return raw;
  }
};

export const applyResourceVersionToYaml = (yamlText: string, resourceVersion: string): string => {
  if (!resourceVersion) {
    return yamlText;
  }
  try {
    const doc = YAML.parseDocument(yamlText);
    doc.setIn(['metadata', 'resourceVersion'], resourceVersion);
    return doc.toString(YAML_STRINGIFY_OPTIONS);
  } catch {
    return yamlText;
  }
};

export const applyYamlOnServer = async (
  clusterId: string,
  baseYAML: string,
  yamlContent: string,
  identity: ObjectIdentity,
  resourceVersion: string
): Promise<ObjectYamlMutationResponse> => {
  return ApplyObjectYaml(clusterId, {
    baseYAML,
    yaml: yamlContent,
    kind: identity.kind,
    apiVersion: identity.apiVersion,
    namespace: identity.namespace ?? '',
    name: identity.name,
    uid: identity.uid ?? '',
    resourceVersion,
  });
};

export interface ObjectYamlOwnershipConflict {
  field: string;
  manager: string;
  message: string;
}

export interface ObjectYamlOwnershipCheckResponse {
  conflicts: ObjectYamlOwnershipConflict[] | null;
}

export const checkYamlOwnershipOnServer = async (
  clusterId: string,
  baseYAML: string,
  yamlContent: string,
  identity: ObjectIdentity,
  resourceVersion: string
): Promise<ObjectYamlOwnershipCheckResponse> => {
  return CheckObjectYamlOwnership(clusterId, {
    baseYAML,
    yaml: yamlContent,
    kind: identity.kind,
    apiVersion: identity.apiVersion,
    namespace: identity.namespace ?? '',
    name: identity.name,
    uid: identity.uid ?? '',
    resourceVersion,
  });
};

export interface ObjectYamlReloadMergeResponse {
  mergedYAML: string;
  currentYAML: string;
  resourceVersion: string;
}

export const mergeYamlWithLatestOnServer = async (
  clusterId: string,
  baseYAML: string,
  draftYAML: string,
  identity: ObjectIdentity
): Promise<ObjectYamlReloadMergeResponse> => {
  return MergeObjectYamlWithLatest(clusterId, {
    baseYAML,
    draftYAML,
    kind: identity.kind,
    apiVersion: identity.apiVersion,
    namespace: identity.namespace ?? '',
    name: identity.name,
    uid: identity.uid ?? '',
  });
};
