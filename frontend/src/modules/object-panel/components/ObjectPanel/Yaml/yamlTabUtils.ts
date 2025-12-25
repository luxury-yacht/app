/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Yaml/yamlTabUtils.ts
 *
 * Module source for yamlTabUtils.
 */
import * as YAML from 'yaml';
import { ValidateObjectYaml, ApplyObjectYaml } from '@wailsjs/go/backend/App';
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

export const validateYamlOnServer = async (
  yamlContent: string,
  identity: ObjectIdentity,
  resourceVersion: string
): Promise<ObjectYamlMutationResponse> => {
  return ValidateObjectYaml({
    yaml: yamlContent,
    kind: identity.kind,
    apiVersion: identity.apiVersion,
    namespace: identity.namespace ?? '',
    name: identity.name,
    resourceVersion,
  });
};

export const applyYamlOnServer = async (
  yamlContent: string,
  identity: ObjectIdentity,
  resourceVersion: string
): Promise<ObjectYamlMutationResponse> => {
  return ApplyObjectYaml({
    yaml: yamlContent,
    kind: identity.kind,
    apiVersion: identity.apiVersion,
    namespace: identity.namespace ?? '',
    name: identity.name,
    resourceVersion,
  });
};
