import {
  OBJECT_ACTION_KIND_CAPABILITIES,
  type ObjectActionKindCapability,
} from './objectActions.generated';

const capabilities = Object.values(OBJECT_ACTION_KIND_CAPABILITIES) as ObjectActionKindCapability[];

export interface ObjectActionKindIdentity {
  group: string;
  version: string;
  kind: string;
}

const identityKey = ({ group, version, kind }: ObjectActionKindIdentity): string =>
  `${group.trim()}\0${version.trim()}\0${kind.trim()}`;

const capabilitiesByIdentity = new Map<string, ObjectActionKindCapability>();
const normalizedKindsByAlias = new Map<string, string>();
for (const capability of capabilities) {
  for (const alias of capability.aliases) {
    capabilitiesByIdentity.set(
      identityKey({ group: capability.group, version: capability.version, kind: alias }),
      capability
    );
    normalizedKindsByAlias.set(alias, capability.kind);
  }
}

export const lookupObjectActionKindCapability = (
  identity: ObjectActionKindIdentity
): ObjectActionKindCapability | null => capabilitiesByIdentity.get(identityKey(identity)) ?? null;

export const normalizeObjectActionKind = (kind: string): string =>
  normalizedKindsByAlias.get(kind) ?? kind;

export const objectActionKindsWith = (key: keyof ObjectActionKindCapability): readonly string[] =>
  capabilities.filter((capability) => capability[key] === true).map(({ kind }) => kind);
