/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/DetailsTabRBACRules.tsx
 *
 * Permissions section for Role / ClusterRole detail views: one table row per resource (and per
 * non-resource URL) with every verb the role's rules grant it, the same shape `kubectl describe`
 * prints. Verbs are risk-colored chips and bare `*` wildcards are highlighted.
 *
 * Sibling to Overview / Containers / Resource Utilization in the Details tab — rules are the
 * primary content of a Role/ClusterRole and earn their own top-level section.
 */

import {
  createStatusChipMeasurementElement,
  type StatusChipVariant,
} from '@shared/components/StatusChip';
import * as cf from '@shared/components/tables/columnFactories';
import GridTable, { type GridColumnDefinition } from '@shared/components/tables/GridTable';
import type React from 'react';
import { useMemo } from 'react';
import { useTableSort } from '@/hooks/useTableSort';
import {
  buildPermissionRows,
  type PermissionRow,
  type PolicyRuleInput,
} from './rbacPermissionRows';
import '../shared.css';
import './DetailsTabRBACRules.css';

interface RBACRulesProps {
  policyRules?: PolicyRuleInput[] | null;
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
  if (verb === '*') {
    return 'unhealthy';
  }
  if (WRITE_VERBS.has(verb)) {
    return 'warning';
  }
  if (READ_VERBS.has(verb)) {
    return 'healthy';
  }
  return 'info';
};

const verbLabel = (verb: string): string => (verb === '*' ? '* (all)' : verb);

// A bare `*` means every group/resource — highlight it without promoting it to a chip.
const renderWildcard = (value: string): React.ReactNode =>
  value === '*' ? <span className="rule-wildcard">*</span> : value;

const apiGroupLabel = (row: PermissionRow): string => {
  if (row.apiGroup === null) {
    return 'Non-resource URL';
  }
  return row.apiGroup === '' ? 'core' : row.apiGroup;
};

const namesLabel = (count: number): string => (count === 1 ? '1 name' : `${count} names`);

// Cells render host elements only: GridTable's auto-width measurer copies host markup and its
// classes without mounting components, so the chips carry StatusChip's own classes.
const renderVerbChips = (verbs: string[]): React.ReactNode => (
  <span className="rule-verbs rule-verbs--nowrap">
    {verbs.map((verb) => {
      const chip = createStatusChipMeasurementElement(verbVariant(verb), verbLabel(verb));
      return (
        <span key={verb} className={chip.className}>
          {chip.textContent}
        </span>
      );
    })}
  </span>
);

const columns: GridColumnDefinition<PermissionRow>[] = cf.withColumnSizing(
  [
    {
      ...cf.createTextColumn<PermissionRow>('resource', 'Resource', (row) => row.resource),
      // A grant limited to named objects must not read as a grant on every object.
      render: (row) => (
        <span>
          {renderWildcard(row.resource)}
          {row.resourceNames.length > 0 && (
            <span className="rbac-permission-names">{namesLabel(row.resourceNames.length)}</span>
          )}
        </span>
      ),
    },
    {
      ...cf.createTextColumn<PermissionRow>('apiGroup', 'API group', apiGroupLabel),
      render: (row) => renderWildcard(apiGroupLabel(row)),
    },
    {
      ...cf.createTextColumn<PermissionRow>('verbs', 'Verbs', (row) => row.verbs.join(', ')),
      render: (row) => renderVerbChips(row.verbs),
    },
    cf.createTextColumn<PermissionRow>(
      'resourceNames',
      'Resource names',
      (row) => row.resourceNames.join(', ') || undefined
    ),
  ],
  {
    resource: { autoWidth: true },
    apiGroup: { autoWidth: true },
    verbs: { autoWidth: true },
    resourceNames: { autoWidth: true },
  }
);

const permissionRowKey = (row: PermissionRow): string => row.key;

const Rules: React.FC<RBACRulesProps> = ({ policyRules }) => {
  const rows = useMemo(() => buildPermissionRows(policyRules), [policyRules]);
  const { sortedData, sortConfig, handleSort } = useTableSort(rows, undefined, 'asc', {
    columns,
  });

  if (rows.length === 0) {
    return null;
  }

  return (
    <div className="object-panel-section">
      <div className="object-panel-section-title">Permissions</div>
      <GridTable<PermissionRow>
        embedded
        data={sortedData}
        columns={columns}
        keyExtractor={permissionRowKey}
        sortConfig={sortConfig}
        onSort={handleSort}
      />
    </div>
  );
};

export default Rules;
