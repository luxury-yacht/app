/**
 * frontend/src/core/refresh/scopeSelector.ts
 *
 * The refresh scope codec. A scope is "<clusterId>|<tail>"; each domain's tail
 * grammar (accepted selectors and query mode) is authored in
 * refresh-domain-contract.json and generated into REFRESH_DOMAIN_POLICIES. The
 * backend codec (backend/refresh/scope_selector.go) decodes the same language;
 * both run the contract's examples. Build and inspect scopes only through here.
 */

import { parseClusterScope } from './clusterScope';
import {
  type GeneratedRefreshScopeQuery,
  type GeneratedRefreshScopeSelector,
  REFRESH_DOMAIN_POLICIES,
  type RefreshDomain,
} from './types';

/** Complete object identity in a scope; an empty namespace is cluster-scoped. */
export interface ScopeObjectIdentity {
  namespace: string;
  group: string;
  version: string;
  kind: string;
  name: string;
}

export type ScopeSelector =
  | { kind: 'cluster' }
  | { kind: 'namespace'; namespace: string }
  | { kind: 'all-namespaces' }
  | { kind: 'node'; node: string }
  | { kind: 'workload'; object: ScopeObjectIdentity }
  | { kind: 'object'; object: ScopeObjectIdentity }
  | { kind: 'helm-release'; namespace: string; name: string };

export type ScopeSelectorKind = GeneratedRefreshScopeSelector;

export const CLUSTER_SELECTOR: ScopeSelector = { kind: 'cluster' };
export const ALL_NAMESPACES_SELECTOR: ScopeSelector = { kind: 'all-namespaces' };

export interface RefreshScope {
  clusterId: string;
  selector: ScopeSelector;
  /** Raw query after the selector (or the whole catalog tail); '' when absent. */
  query: string;
}

interface ScopeGrammar {
  selectors: readonly ScopeSelectorKind[];
  query: GeneratedRefreshScopeQuery;
}

const CLUSTER_DELIMITER = '|';
const QUERY_DELIMITER = '?';
const NAMESPACE_PREFIX = 'namespace:';
const ALL_NAMESPACES = `${NAMESPACE_PREFIX}all`;
const NODE_PREFIX = 'node:';
const WORKLOAD_PREFIX = 'workload:';
/** Stands in for the namespace of cluster-scoped objects and releases. */
const CLUSTER_SCOPE_TOKEN = '__cluster__';
// Kubernetes namespace names are DNS-1123 labels.
const DNS_1123_LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
const DNS_1123_LABEL_MAX_LENGTH = 63;

const grammarByDomain = new Map<RefreshDomain, ScopeGrammar>(
  REFRESH_DOMAIN_POLICIES.map((policy) => [policy.domain, policy.scope])
);

const grammarFor = (domain: RefreshDomain): ScopeGrammar => {
  const grammar = grammarByDomain.get(domain);
  if (!grammar) {
    throw new Error(`Unknown refresh domain "${domain}"`);
  }
  return grammar;
};

/** The selector kinds a domain's scopes may use. */
export const domainScopeSelectors = (domain: RefreshDomain): readonly ScopeSelectorKind[] =>
  grammarFor(domain).selectors;

/**
 * True when a decoded scope carries a one-shot query after its selector
 * (typed-table and catalog pages, object-map limits). Query readers keep
 * current through their domain's base scope, which streams.
 */
export const hasOneShotQuery = (scope: RefreshScope): boolean => scope.query !== '';

/**
 * The namespace views' selection is a namespace name, or the all-namespaces
 * tail ("namespace:all", ALL_NAMESPACES_SCOPE) as a sentinel. Translate it to
 * the selector its scopes use.
 */
export const selectorForNamespaceSelection = (selection: string): ScopeSelector =>
  selection === ALL_NAMESPACES
    ? ALL_NAMESPACES_SELECTOR
    : { kind: 'namespace', namespace: selection };

const namespaceToken = (namespace: string): string => namespace || CLUSTER_SCOPE_TOKEN;

const namespaceFromToken = (token: string): string => (token === CLUSTER_SCOPE_TOKEN ? '' : token);

// Object names are path segments, and RBAC names may contain "?", the query
// delimiter. The name field escapes "%" and "?" so a name never reads as a
// query; every other character, ":" included, stays literal.
const escapeObjectName = (name: string): string => name.replace(/%/g, '%25').replace(/\?/g, '%3F');

// Only the canonical escape (the one escapeObjectName produces) decodes.
const unescapeObjectName = (value: string): string | null => {
  const name = value.replace(/%25|%3F/g, (token) => (token === '%25' ? '%' : '?'));
  return escapeObjectName(name) === value ? name : null;
};

/** The canonical scope tail for a selector, without cluster prefix or query. */
export const encodeScopeSelector = (selector: ScopeSelector): string => {
  switch (selector.kind) {
    case 'cluster':
      return '';
    case 'namespace':
      return `${NAMESPACE_PREFIX}${selector.namespace}`;
    case 'all-namespaces':
      return ALL_NAMESPACES;
    case 'node':
      return `${NODE_PREFIX}${selector.node}`;
    case 'workload': {
      const { namespace, group, version, kind, name } = selector.object;
      return `${WORKLOAD_PREFIX}${[namespace, group, version, kind, name].join(':')}`;
    }
    case 'object': {
      const { namespace, group, version, kind, name } = selector.object;
      return `${namespaceToken(namespace)}:${group}/${version}:${kind}:${escapeObjectName(name)}`;
    }
    case 'helm-release':
      return `${namespaceToken(selector.namespace)}:${selector.name}`;
  }
};

const encodeTail = (grammar: ScopeGrammar, selector: ScopeSelector, query: string): string => {
  if (grammar.query === 'catalog') {
    return query;
  }
  const encoded = encodeScopeSelector(selector);
  return query ? `${encoded}${QUERY_DELIMITER}${query}` : encoded;
};

/**
 * Encodes a scope for `domain`. Throws when the domain does not accept the
 * selector or the query, so an impossible scope never reaches the backend.
 */
export const buildRefreshScope = (
  domain: RefreshDomain,
  scope: { clusterId: string; selector: ScopeSelector; query?: string }
): string => {
  const clusterId = scope.clusterId.trim();
  if (!clusterId) {
    throw new Error(`A ${domain} scope requires a cluster id`);
  }
  const grammar = grammarFor(domain);
  const raw = `${clusterId}${CLUSTER_DELIMITER}${encodeTail(grammar, scope.selector, scope.query ?? '')}`;
  // Round-trip through the parser so a builder can only emit what decodes.
  parseRefreshScope(domain, raw);
  return raw;
};

/**
 * The whole-cluster scope for `domain`, or '' when no cluster is selected yet
 * (callers treat '' as "no scope").
 */
export const buildClusterRefreshScope = (
  domain: RefreshDomain,
  clusterId: string | null | undefined
): string => {
  const id = clusterId?.trim();
  return id ? buildRefreshScope(domain, { clusterId: id, selector: CLUSTER_SELECTOR }) : '';
};

const splitQuery = (tail: string, mode: GeneratedRefreshScopeQuery): [string, string] => {
  if (mode === 'catalog') {
    // The catalog tail is the query; a leading "?" would join the first key.
    if (tail.startsWith(QUERY_DELIMITER)) {
      throw new Error(`Catalog scope "${tail}" must not start with "${QUERY_DELIMITER}"`);
    }
    return ['', tail];
  }
  const delimiter = tail.indexOf(QUERY_DELIMITER);
  if (delimiter < 0) {
    return [tail, ''];
  }
  if (mode === 'none') {
    throw new Error(`Scope "${tail}" does not accept a query`);
  }
  const query = tail.slice(delimiter + 1);
  if (!query) {
    throw new Error(`Scope "${tail}" has an empty query`);
  }
  return [tail.slice(0, delimiter), query];
};

const singleSegmentAfter = (value: string, prefix: string): string | null => {
  if (!value.startsWith(prefix)) {
    return null;
  }
  const segment = value.slice(prefix.length);
  return segment && !segment.includes(':') ? segment : null;
};

const isNamespaceName = (value: string): boolean =>
  value.length <= DNS_1123_LABEL_MAX_LENGTH && DNS_1123_LABEL.test(value);

const decodeNamespace = (value: string): ScopeSelector | null => {
  if (!value.startsWith(NAMESPACE_PREFIX) || value === ALL_NAMESPACES) {
    return null;
  }
  const namespace = value.slice(NAMESPACE_PREFIX.length);
  return isNamespaceName(namespace) ? { kind: 'namespace', namespace } : null;
};

const decodeNode = (value: string): ScopeSelector | null => {
  const node = singleSegmentAfter(value, NODE_PREFIX);
  return node ? { kind: 'node', node } : null;
};

const decodeWorkload = (value: string): ScopeSelector | null => {
  if (!value.startsWith(WORKLOAD_PREFIX)) {
    return null;
  }
  const parts = value.slice(WORKLOAD_PREFIX.length).split(':');
  if (parts.length !== 5 || parts.some((part) => !part)) {
    return null;
  }
  const [namespace, group, version, kind, name] = parts;
  return { kind: 'workload', object: { namespace, group, version, kind, name } };
};

/** Splits on the first `count - 1` colons; the last part keeps the remainder. */
const splitColons = (value: string, count: number): string[] => {
  const parts: string[] = [];
  let rest = value;
  while (parts.length < count - 1) {
    const index = rest.indexOf(':');
    if (index < 0) {
      break;
    }
    parts.push(rest.slice(0, index));
    rest = rest.slice(index + 1);
  }
  parts.push(rest);
  return parts;
};

const decodeObject = (value: string): ScopeSelector | null => {
  // Object names may contain ":" (ClusterRole "system:node"), so only the first
  // three colons separate fields.
  const parts = splitColons(value, 4);
  if (parts.length !== 4) {
    return null;
  }
  const [namespace, groupVersion, kind, encodedName] = parts;
  const groupVersionParts = groupVersion.split('/');
  if (!namespace || groupVersionParts.length !== 2) {
    return null;
  }
  const [group, version] = groupVersionParts;
  const name = unescapeObjectName(encodedName);
  if (!version || !kind || !name) {
    return null;
  }
  return {
    kind: 'object',
    object: { namespace: namespaceFromToken(namespace), group, version, kind, name },
  };
};

const decodeHelmRelease = (value: string): ScopeSelector | null => {
  const [namespace, name] = splitColons(value, 2);
  if (!namespace || !name) {
    return null;
  }
  return { kind: 'helm-release', namespace: namespaceFromToken(namespace), name };
};

const selectorDecoders: Record<ScopeSelectorKind, (value: string) => ScopeSelector | null> = {
  cluster: (value) => (value === '' ? { kind: 'cluster' } : null),
  namespace: decodeNamespace,
  'all-namespaces': (value) => (value === ALL_NAMESPACES ? { kind: 'all-namespaces' } : null),
  node: decodeNode,
  workload: decodeWorkload,
  object: decodeObject,
  'helm-release': decodeHelmRelease,
};

/**
 * Decodes a complete single-cluster scope for `domain`. Throws for anything
 * outside the domain's grammar; only canonical encodings decode.
 */
export const parseRefreshScope = (domain: RefreshDomain, raw: string): RefreshScope => {
  const grammar = grammarFor(domain);
  const { clusterId, scope: tail } = parseClusterScope(raw);
  if (!clusterId) {
    throw new Error(`Refresh scope "${raw}" has no cluster prefix`);
  }
  const [selectorTail, query] = splitQuery(tail, grammar.query);
  for (const kind of grammar.selectors) {
    const selector = selectorDecoders[kind](selectorTail);
    if (selector) {
      return { clusterId, selector, query };
    }
  }
  throw new Error(
    `${domain} scope "${tail}" matches none of the accepted selectors ${grammar.selectors.join(', ')}`
  );
};

/** parseRefreshScope for inspectors that must tolerate any string; null when it does not decode. */
export const tryParseRefreshScope = (domain: RefreshDomain, raw: string): RefreshScope | null => {
  try {
    return parseRefreshScope(domain, raw);
  } catch {
    return null;
  }
};
