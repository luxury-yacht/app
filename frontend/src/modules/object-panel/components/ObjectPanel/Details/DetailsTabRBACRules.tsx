/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/DetailsTabRBACRules.tsx
 *
 * Dedicated Rules section for Role / ClusterRole detail views. Renders one
 * card per policyRule, with verbs as risk-colored StatusChips and bare `*`
 * wildcards in apiGroups / resources / nonResourceURLs highlighted inline.
 *
 * Sibling to Overview / Containers / Resource Utilization in the Details
 * tab — rules are the primary content of a Role/ClusterRole and earn their
 * own top-level section.
 */

import React from 'react';
import { StatusChip, type StatusChipVariant } from '@shared/components/StatusChip';
import '../shared.css';
import './DetailsTabRBACRules.css';

interface PolicyRule {
  apiGroups?: string[];
  resources?: string[];
  resourceNames?: string[];
  verbs?: string[];
  nonResourceURLs?: string[];
}

interface RBACRulesProps {
  policyRules?: PolicyRule[];
}

// Map a verb to a StatusChip variant by risk level. The split tracks
// Kubernetes RBAC convention plus the well-known privilege-escalation verbs
// (escalate / bind / impersonate) that gate access to other identities.
const WRITE_VERBS = new Set([
  'create',
  'update',
  'patch',
  'delete',
  'deletecollection',
  'escalate',
  'bind',
  'impersonate',
]);
const READ_VERBS = new Set(['get', 'list', 'watch']);

const verbVariant = (verb: string): StatusChipVariant => {
  if (verb === '*') return 'unhealthy';
  if (WRITE_VERBS.has(verb)) return 'warning';
  if (READ_VERBS.has(verb)) return 'healthy';
  return 'info';
};

// Render a list of comma-joined values, wrapping bare `*` in a warning-style
// span so over-permissive wildcards stand out. A `mapValue` hook lets the
// caller customise how non-wildcard values render (e.g. apiGroup's `""` rule).
const joinRuleValues = (
  values: string[],
  mapValue: (v: string) => React.ReactNode = (v) => v
): React.ReactNode =>
  values.map((v, i) => (
    <React.Fragment key={`${v}-${i}`}>
      {i > 0 && ', '}
      {v === '*' ? <span className="rule-wildcard">*</span> : mapValue(v)}
    </React.Fragment>
  ));

// apiGroup convention: empty string = "core" API group on the wire. We
// surface "core" so the value reads as a name rather than as an empty-string
// artifact.
const renderApiGroup = (g: string): React.ReactNode => (g === '' ? 'core' : g);

const Rules: React.FC<RBACRulesProps> = ({ policyRules }) => {
  if (!policyRules || policyRules.length === 0) {
    return null;
  }

  return (
    <div className="object-panel-section">
      <div className="object-panel-section-title">Rules</div>
      <div className="rules-card-list">
        {policyRules.map((rule, index) => {
          const hasResources = !!rule.resources && rule.resources.length > 0;
          const hasNonResourceURLs = !!rule.nonResourceURLs && rule.nonResourceURLs.length > 0;
          const hasResourceNames = !!rule.resourceNames && rule.resourceNames.length > 0;

          return (
            <div key={index} className="rules-card">
              <div className="rules-card-header">
                <span className="rules-card-title">
                  {hasResources
                    ? joinRuleValues(rule.resources!)
                    : hasNonResourceURLs
                      ? joinRuleValues(rule.nonResourceURLs!)
                      : '(no resources)'}
                </span>
                {hasResources && (
                  <span className="rules-card-meta">
                    in{' '}
                    {rule.apiGroups && rule.apiGroups.length > 0
                      ? joinRuleValues(rule.apiGroups, renderApiGroup)
                      : 'core'}
                  </span>
                )}
                {hasResourceNames && (
                  <span className="rules-card-meta">named {rule.resourceNames!.join(', ')}</span>
                )}
                {hasResources && hasNonResourceURLs && (
                  <span className="rules-card-meta">
                    and URLs: {joinRuleValues(rule.nonResourceURLs!)}
                  </span>
                )}
              </div>
              {rule.verbs && rule.verbs.length > 0 && (
                <div className="rule-verbs">
                  {rule.verbs.map((v, i) => (
                    <StatusChip key={`${v}-${i}`} variant={verbVariant(v)}>
                      {v === '*' ? '* (all)' : v}
                    </StatusChip>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default Rules;
