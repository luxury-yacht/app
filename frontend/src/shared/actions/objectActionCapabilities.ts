import {
  OBJECT_ACTION_KIND_CAPABILITIES,
  type ObjectActionKindCapability,
} from './objectActions.generated';

const capabilities = Object.values(OBJECT_ACTION_KIND_CAPABILITIES) as ObjectActionKindCapability[];

const capabilitiesByAlias = new Map<string, ObjectActionKindCapability>();
for (const capability of capabilities) {
  for (const alias of capability.aliases) {
    capabilitiesByAlias.set(alias, capability);
  }
}

export const lookupObjectActionKindCapability = (kind: string): ObjectActionKindCapability | null =>
  capabilitiesByAlias.get(kind) ?? null;

export const normalizeObjectActionKind = (kind: string): string =>
  lookupObjectActionKindCapability(kind)?.kind ?? kind;

export const objectActionKindsWith = (key: keyof ObjectActionKindCapability): readonly string[] =>
  capabilities.filter((capability) => capability[key] === true).map(({ kind }) => kind);
