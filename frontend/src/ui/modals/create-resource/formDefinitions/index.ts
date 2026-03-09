/**
 * Declarative form definitions for the guided resource creation mode.
 *
 * Each resource kind has its own file. This barrel re-exports
 * the types, the full registry, and the lookup helper.
 */

export type {
  FormFieldOption,
  FormFieldDefinition,
  FormSectionDefinition,
  ResourceFormDefinition,
} from './types';

import type { ResourceFormDefinition } from './types';
import { deploymentDefinition } from './deployment';
import { serviceDefinition } from './service';
import { configMapDefinition } from './configMap';
import { secretDefinition } from './secret';
import { jobDefinition } from './job';
import { cronJobDefinition } from './cronJob';
import { ingressDefinition } from './ingress';

// --- Registry ---

export const allFormDefinitions: ResourceFormDefinition[] = [
  deploymentDefinition,
  serviceDefinition,
  configMapDefinition,
  secretDefinition,
  jobDefinition,
  cronJobDefinition,
  ingressDefinition,
];

const definitionsByKind = new Map<string, ResourceFormDefinition>(
  allFormDefinitions.map((d) => [d.kind, d])
);

/**
 * Look up a form definition by Kubernetes kind.
 * Returns undefined if no handcrafted form exists for this kind.
 */
export function getFormDefinition(kind: string): ResourceFormDefinition | undefined {
  return definitionsByKind.get(kind);
}
