/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Yaml/yamlTabUtils.ts
 *
 * Utility helpers for yamlTabUtils.
 * Provides shared helper functions for the object panel feature.
 */

import type { backend } from '@core/backend-api/models';
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

export const normalizeYamlString = (raw: string): string => prepareDraftYaml(raw, true);

const yamlRequestIdentity = (identity: ObjectIdentity) => ({
  kind: identity.kind,
  apiVersion: identity.apiVersion,
  namespace: identity.namespace ?? '',
  name: identity.name,
  uid: identity.uid ?? '',
});

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
  const response = await ApplyObjectYaml(clusterId, {
    baseYAML,
    yaml: yamlContent,
    ...yamlRequestIdentity(identity),
    resourceVersion,
  });
  if (!response) {
    throw new Error('Object YAML update returned no response');
  }
  return response;
};

export type ObjectYamlOwnershipConflict = backend.ObjectYAMLOwnershipConflict;
export type ObjectYamlOwnershipCheckResponse = backend.ObjectYAMLOwnershipCheckResponse;

export const checkYamlOwnershipOnServer = async (
  clusterId: string,
  baseYAML: string,
  yamlContent: string,
  identity: ObjectIdentity,
  resourceVersion: string
): Promise<ObjectYamlOwnershipCheckResponse> => {
  const response = await CheckObjectYamlOwnership(clusterId, {
    baseYAML,
    yaml: yamlContent,
    ...yamlRequestIdentity(identity),
    resourceVersion,
  });
  if (!response) {
    throw new Error('Object YAML ownership check returned no response');
  }
  return response;
};

export type ObjectYamlReloadMergeResponse = backend.ObjectYAMLReloadMergeResponse;

export const mergeYamlWithLatestOnServer = async (
  clusterId: string,
  baseYAML: string,
  draftYAML: string,
  identity: ObjectIdentity
): Promise<ObjectYamlReloadMergeResponse> => {
  const response = await MergeObjectYamlWithLatest(clusterId, {
    baseYAML,
    draftYAML,
    ...yamlRequestIdentity(identity),
  });
  if (!response) {
    throw new Error('Object YAML merge returned no response');
  }
  return response;
};
