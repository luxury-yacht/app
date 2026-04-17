/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Yaml/yamlTabUtils.ts
 *
 * Utility helpers for yamlTabUtils.
 * Provides shared helper functions for the object panel feature.
 */

import * as YAML from 'yaml';
import {
  ValidateObjectYaml,
  ApplyObjectYaml,
  MergeObjectYamlWithLatest,
} from '@wailsjs/go/backend/App';
import type { ObjectIdentity } from './yamlValidation';
import type { ObjectYamlMutationResponse } from './yamlErrors';
import { YAML_STRINGIFY_OPTIONS } from './yamlTabConfig';

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
  if (!resourceVersion) return yamlText;
  try {
    const doc = YAML.parseDocument(yamlText);
    doc.setIn(['metadata', 'resourceVersion'], resourceVersion);
    return doc.toString(YAML_STRINGIFY_OPTIONS);
  } catch {
    return yamlText;
  }
};

const deleteYamlPath = (doc: YAML.Document, path: (string | number)[]) => {
  try {
    doc.deleteIn(path);
  } catch {
    // Ignore invalid paths so comparison stays best-effort.
  }
};

export const sanitizeYamlForSemanticCompare = (raw: string): string => {
  try {
    const doc = YAML.parseDocument(raw);
    if (doc.errors.length > 0) {
      throw doc.errors[0];
    }

    deleteYamlPath(doc, ['metadata', 'managedFields']);
    deleteYamlPath(doc, ['metadata', 'resourceVersion']);
    deleteYamlPath(doc, ['metadata', 'uid']);
    deleteYamlPath(doc, ['metadata', 'creationTimestamp']);
    deleteYamlPath(doc, ['metadata', 'deletionTimestamp']);
    deleteYamlPath(doc, ['metadata', 'deletionGracePeriodSeconds']);
    deleteYamlPath(doc, ['metadata', 'generation']);
    deleteYamlPath(doc, ['metadata', 'selfLink']);
    deleteYamlPath(doc, ['status']);

    return doc.toString(YAML_STRINGIFY_OPTIONS);
  } catch {
    return raw;
  }
};

export const validateYamlOnServer = async (
  clusterId: string,
  baseYAML: string,
  yamlContent: string,
  identity: ObjectIdentity,
  resourceVersion: string
): Promise<ObjectYamlMutationResponse> => {
  return ValidateObjectYaml(clusterId, {
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
