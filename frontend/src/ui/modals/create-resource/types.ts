import type { ObjectIdentity } from '@modules/object-panel/components/ObjectPanel/Yaml/yamlValidation';

export interface CreateResourceEditRequest {
  mode: 'edit';
  clusterId: string;
  initialYaml: string;
  scope: string | null;
  identity: ObjectIdentity;
}

export type CreateResourceModalRequest = CreateResourceEditRequest;
