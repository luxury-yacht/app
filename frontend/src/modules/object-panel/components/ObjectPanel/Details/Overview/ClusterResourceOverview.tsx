/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/ClusterResourceOverview.tsx
 */

import React from 'react';
import { OverviewItem } from '@modules/object-panel/components/ObjectPanel/Details/Overview/shared/OverviewItem';
import { ResourceHeader } from '@shared/components/kubernetes/ResourceHeader';
import { ResourceMetadata } from '@shared/components/kubernetes/ResourceMetadata';
import { ResourceStatus } from '@shared/components/kubernetes/ResourceStatus';
import '@styles/components/badges.css';

/**
 * Shape of a single CRD version as rendered in the Versions row. Mirrors
 * the backend's `CRDVersion` (name/served/storage/deprecated) but typed
 * locally with optional fields so tests can pass minimal fixtures without
 * depending on Wails-generated types.
 */
interface CRDVersionLike {
  name?: string;
  served?: boolean;
  storage?: boolean;
  deprecated?: boolean;
}

interface ClusterResourceOverviewProps {
  kind?: string;
  name?: string;
  age?: string;
  status?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  // Namespace-specific fields
  hasWorkloads?: boolean;
  workloadsUnknown?: boolean;
  // IngressClass-specific fields
  controller?: string;
  isDefault?: boolean;
  // CRD-specific fields
  group?: string;
  scope?: string;
  versions?: CRDVersionLike[];
  names?: any;
  // Webhook-specific fields
  webhooks?: any[];
}

/**
 * Wraps a string value in a monospace-font span for fields that hold
 * machine-identifier-shaped values (API group, Kind, plural name). These
 * are things a user may need to copy/paste exactly — rendering them in
 * the monospace token font makes them visually distinct from narrative
 * labels and matches how version names render in the Versions row.
 *
 * Returns `undefined` (rather than an empty span) when the value is
 * missing, so OverviewItem collapses the row entirely via its
 * null/undefined-value short-circuit.
 */
const renderMonoValue = (value: string | undefined | null): React.ReactNode => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return (
    <span
      style={{
        fontFamily: 'var(--font-family-mono)',
        fontSize: 'var(--font-size-mono)',
      }}
    >
      {value}
    </span>
  );
};

/**
 * Render the Versions row for a CRD. Each version appears on its own
 * line with the version name (in the monospace token font) optionally
 * followed by a parenthesized list of lowercase flags:
 *
 *   v1
 *   v1beta1
 *   v1alpha1 (deprecated)
 *
 * The primary (storage) version is always hoisted to the top of the
 * list regardless of its position in `crd.Spec.Versions`, and renders
 * in the default text color. All other versions render in the secondary
 * text color to visually de-emphasize them relative to the primary —
 * position + color together are the indication that the top entry is
 * the primary/storage version, so we deliberately don't also annotate
 * it with a "(primary)" label. The relative order of non-primary
 * versions is preserved from the backend.
 *
 * Flag meanings:
 *   - `deprecated` — the CRD author has flagged this version as
 *                    deprecated; new writes should avoid it.
 *   - `not served` — defined in `spec.versions` but not currently
 *                    reachable via the API server (rare/transient,
 *                    typically during migration).
 *
 * A version with no flags renders as just its name. Multiple flags are
 * comma-separated inside the parens.
 *
 * When the CRD has no versions at all (malformed/partial CRD), returns
 * undefined so OverviewItem collapses the row entirely.
 */
const renderCRDVersions = (versions: CRDVersionLike[] | undefined): React.ReactNode => {
  if (!versions || versions.length === 0) {
    return undefined;
  }
  // Hoist the primary (storage) version to the top; keep the relative
  // order of everything else. Stable partition — no sort.
  const primary = versions.filter((v) => v.storage);
  const nonPrimary = versions.filter((v) => !v.storage);
  const ordered = [...primary, ...nonPrimary];
  return (
    <div>
      {ordered.map((version, index) => {
        const key = version.name ?? `version-${index}`;
        // Flags only surface states the reader can't infer from
        // position/color. "primary" is deliberately NOT a flag because
        // the hoisting and default-color styling already communicate it.
        const flags: string[] = [];
        if (version.served === false) flags.push('not served');
        if (version.deprecated) flags.push('deprecated');
        const rowStyle: React.CSSProperties = { marginTop: index > 0 ? '4px' : 0 };
        if (!version.storage) {
          rowStyle.color = 'var(--color-text-secondary)';
        }
        return (
          <div key={key} style={rowStyle}>
            <span
              style={{
                fontFamily: 'var(--font-family-mono)',
                fontSize: 'var(--font-size-mono)',
              }}
            >
              {version.name ?? '(unnamed)'}
            </span>
            {flags.length > 0 ? <span>{` (${flags.join(', ')})`}</span> : null}
          </div>
        );
      })}
    </div>
  );
};

export const ClusterResourceOverview: React.FC<ClusterResourceOverviewProps> = (props) => {
  const { kind, name, age, status } = props;
  const normalizedKind = kind?.toLowerCase();

  return (
    <>
      <ResourceHeader kind={kind || ''} name={name || ''} age={age} />
      <ResourceStatus status={status} />

      {/* Namespace-specific fields */}
      {normalizedKind === 'namespace' && (
        <>
          <OverviewItem
            label="Has Workloads"
            value={
              props.workloadsUnknown ? (
                <span className="status-badge warning">Unknown</span>
              ) : props.hasWorkloads ? (
                'Yes'
              ) : (
                'No'
              )
            }
          />
        </>
      )}

      {/* IngressClass-specific fields */}
      {normalizedKind === 'ingressclass' && (
        <>
          <OverviewItem label="Controller" value={props.controller} />
          <OverviewItem label="Default Class" value={props.isDefault ? 'Yes' : 'No'} />
        </>
      )}

      {/* CRD-specific fields. Order: Scope → Group → Versions → Kind → Plural.
          Group/Kind/Plural values render in the monospace token font
          because they're identifiers the user may need to copy/paste
          verbatim; Scope is a plain label so stays in the regular font. */}
      {normalizedKind === 'customresourcedefinition' && (
        <>
          <OverviewItem label="Scope" value={props.scope} />
          <OverviewItem label="Group" value={renderMonoValue(props.group)} />
          <OverviewItem label="Versions" value={renderCRDVersions(props.versions)} />
          {props.names && (
            <>
              <OverviewItem label="Kind" value={renderMonoValue(props.names.kind)} />
              <OverviewItem label="Plural" value={renderMonoValue(props.names.plural)} />
            </>
          )}
        </>
      )}

      {/* Webhook-specific fields */}
      {(normalizedKind === 'mutatingwebhookconfiguration' ||
        normalizedKind === 'validatingwebhookconfiguration') && (
        <>
          <OverviewItem
            label="Webhooks"
            value={props.webhooks ? `${props.webhooks.length} webhook(s)` : undefined}
          />
        </>
      )}

      {/* Cluster config resources should show metadata like ConfigMaps/Secrets. */}
      {(normalizedKind === 'customresourcedefinition' ||
        normalizedKind === 'ingressclass' ||
        normalizedKind === 'mutatingwebhookconfiguration' ||
        normalizedKind === 'validatingwebhookconfiguration') && (
        <ResourceMetadata labels={props.labels} annotations={props.annotations} />
      )}
    </>
  );
};
