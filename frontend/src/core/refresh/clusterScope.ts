/**
 * frontend/src/core/refresh/clusterScope.ts
 *
 * Decodes the cluster prefix of refresh scopes ("<clusterId>|<tail>"). The
 * prefix is one opaque cluster id ("<kubeconfig file>:<context>", which may
 * contain commas), never a list. Build scopes, and decode their tails, with
 * the scope codec (scopeSelector.ts).
 */

const CLUSTER_SCOPE_DELIMITER = '|';

// Splits at the first delimiter; a scope without a cluster prefix has an empty clusterId.
export const parseClusterScope = (value?: string | null): { clusterId: string; scope: string } => {
  const trimmed = (value ?? '').trim();
  const delimiterIndex = trimmed.indexOf(CLUSTER_SCOPE_DELIMITER);
  if (delimiterIndex <= 0) {
    return { clusterId: '', scope: trimmed };
  }
  return {
    clusterId: trimmed.slice(0, delimiterIndex).trim(),
    scope: trimmed.slice(delimiterIndex + 1).trim(),
  };
};
