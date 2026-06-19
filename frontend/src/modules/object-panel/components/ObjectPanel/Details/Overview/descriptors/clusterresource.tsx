/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/descriptors/clusterresource.tsx
 *
 * Overview descriptors for the cluster-scoped config kinds (X1). Presentation ported verbatim from
 * ClusterResourceOverview.tsx, split into one descriptor per kind: CustomResourceDefinition,
 * IngressClass, Namespace, MutatingWebhookConfiguration, and ValidatingWebhookConfiguration.
 *
 * These kinds are cluster-scoped, so the frame contributes kind/name/labels/annotations only (no
 * namespace value on the DTO).
 */

import React from 'react';
import { admission, apiextensions, ingressclass, namespaces } from '@wailsjs/go/models';
import { StatusChip } from '@shared/components/StatusChip';
import { ObjectPanelLink } from '@shared/components/ObjectPanelLink';
import { buildRequiredObjectReference } from '@shared/utils/objectIdentity';
import type { OverviewDescriptor } from '../schema';
import '@styles/components/badges.css';

type CustomResourceDefinitionDetails = apiextensions.CustomResourceDefinitionDetails;
type IngressClassDetails = ingressclass.IngressClassDetails;
type NamespaceDetails = namespaces.NamespaceDetails;
type MutatingWebhookConfigurationDetails = admission.MutatingWebhookConfigurationDetails;
type ValidatingWebhookConfigurationDetails = admission.ValidatingWebhookConfigurationDetails;

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
const renderCRDVersions = (versions: apiextensions.CRDVersion[] | undefined): React.ReactNode => {
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

export const crdDescriptor: OverviewDescriptor<CustomResourceDefinitionDetails> = {
  displayKind: 'CustomResourceDefinition',
  dtoClass: apiextensions.CustomResourceDefinitionDetails,
  schema: {
    // Order: Scope → Group → Versions → Kind → Plural. Group/Kind/Plural values render in the
    // monospace token font because they're identifiers the user may need to copy/paste verbatim;
    // Scope is a plain label so stays in the regular font.
    items: [
      { field: 'scope', label: 'Scope' },
      { field: 'group', label: 'Group', render: (d) => renderMonoValue(d.group) },
      { field: 'versions', label: 'Versions', render: (d) => renderCRDVersions(d.versions) },
      {
        field: 'names',
        label: 'Kind',
        hidden: (d) => !d.names,
        render: (d) => renderMonoValue(d.names?.kind),
      },
      {
        // Plural also reads from `names`; cover it via derivedFrom rather than a second `names` key.
        label: 'Plural',
        derivedFrom: ['names'],
        hidden: (d) => !d.names,
        render: (d) => renderMonoValue(d.names?.plural),
      },
    ],
  },
  // details (table-summary string), conversionStrategy, and conditions are not surfaced here.
  coveredElsewhere: ['details', 'conversionStrategy', 'conditions'],
};

export const ingressClassDescriptor: OverviewDescriptor<IngressClassDetails> = {
  displayKind: 'IngressClass',
  dtoClass: ingressclass.IngressClassDetails,
  schema: {
    items: [
      {
        field: 'isDefault',
        label: 'Default',
        render: (d) => (
          <StatusChip
            variant={d.isDefault ? 'healthy' : 'unhealthy'}
            tooltip={
              d.isDefault
                ? 'Ingresses that omit ingressClassName are routed through this class.'
                : 'Ingresses that omit ingressClassName are not routed through this class.'
            }
          >
            {d.isDefault ? 'True' : 'False'}
          </StatusChip>
        ),
      },
      {
        field: 'controller',
        label: 'Controller',
        render: (d) => renderMonoValue(d.controller),
      },
      {
        field: 'parameters',
        label: 'Parameters',
        hidden: (d) => !d.parameters,
        render: (d, context) => {
          const params = d.parameters;
          if (!params) return undefined;
          const label = `${params.kind}/${params.name}`;
          // Built-in kinds resolve through GVK lookup; CRD-backed parameters (the common case for
          // cloud providers) only have an apiGroup on the wire and can't build a strict ref. Fall
          // back to plain text in that case rather than throwing.
          let ref;
          try {
            ref = buildRequiredObjectReference({
              kind: params.kind.toLowerCase(),
              name: params.name,
              namespace: params.scope === 'Namespace' ? params.namespace : undefined,
              clusterId: context.clusterId,
              clusterName: context.clusterName,
            });
          } catch {
            ref = null;
          }
          return ref ? <ObjectPanelLink objectRef={ref}>{label}</ObjectPanelLink> : label;
        },
      },
      {
        field: 'ingresses',
        label: 'Used by',
        hidden: (d) => (d.ingresses?.length ?? 0) === 0,
        render: (d) => {
          const count = d.ingresses?.length ?? 0;
          return count === 1 ? '1 Ingress' : `${count} Ingresses`;
        },
      },
    ],
  },
  // details (table-summary string) is not surfaced here.
  coveredElsewhere: ['details'],
};

export const namespaceDescriptor: OverviewDescriptor<NamespaceDetails> = {
  displayKind: 'Namespace',
  dtoClass: namespaces.NamespaceDetails,
  schema: {
    items: [
      { kind: 'status' },
      {
        field: 'hasWorkloads',
        derivedFrom: ['workloadsUnknown'],
        label: 'Has Workloads',
        render: (d) =>
          d.workloadsUnknown ? (
            <span className="status-text warning">Unknown</span>
          ) : d.hasWorkloads ? (
            'Yes'
          ) : (
            'No'
          ),
      },
    ],
  },
  // details (table-summary string) plus resourceQuotas/limitRanges (surfaced in related sections,
  // not the Overview) are not rendered here.
  coveredElsewhere: ['details', 'resourceQuotas', 'limitRanges'],
};

export const mutatingWebhookDescriptor: OverviewDescriptor<MutatingWebhookConfigurationDetails> = {
  displayKind: 'MutatingWebhookConfiguration',
  dtoClass: admission.MutatingWebhookConfigurationDetails,
  schema: {
    items: [
      {
        field: 'webhooks',
        label: 'Webhooks',
        render: (d) => (d.webhooks ? `${d.webhooks.length} webhook(s)` : undefined),
      },
    ],
  },
  // details (table-summary string) is not surfaced here.
  coveredElsewhere: ['details'],
};

export const validatingWebhookDescriptor: OverviewDescriptor<ValidatingWebhookConfigurationDetails> =
  {
    displayKind: 'ValidatingWebhookConfiguration',
    dtoClass: admission.ValidatingWebhookConfigurationDetails,
    schema: {
      items: [
        {
          field: 'webhooks',
          label: 'Webhooks',
          render: (d) => (d.webhooks ? `${d.webhooks.length} webhook(s)` : undefined),
        },
      ],
    },
    // details (table-summary string) is not surfaced here.
    coveredElsewhere: ['details'],
  };
