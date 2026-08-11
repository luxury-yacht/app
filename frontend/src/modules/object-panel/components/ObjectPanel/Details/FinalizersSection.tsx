import type { CapabilityState } from '@modules/object-panel/components/ObjectPanel/types';
import type { ObjectPanelRef } from '@modules/object-panel/objectPanelRef';
import type { FinalizerPath } from '@shared/actions/objectActionClient';
import { LiveAgeText } from '@shared/components/LiveAgeText';
import { StatusChip, type StatusChipVariant } from '@shared/components/StatusChip';
import Tooltip from '@shared/components/Tooltip';
import { useObjectActionController } from '@shared/hooks/useObjectActionController';
import type { ObjectDeletionMetadata } from '@/core/refresh/types.generated';
import type { DetailCondition, NamespaceFinalizationDetails } from './objectDetailModel';
import './FinalizersSection.css';

interface FinalizersSectionProps {
  deletion: ObjectDeletionMetadata | null;
  namespaceFinalization: NamespaceFinalizationDetails | null;
  objectData: ObjectPanelRef;
  removalCapabilities: {
    metadata: CapabilityState;
    namespaceSpec: CapabilityState;
  };
  onAfterAction: () => void;
}

interface FinalizerEntry {
  name: string;
  path: FinalizerPath;
  capability: CapabilityState;
}

const normalizedFinalizers = (values?: string[]): string[] =>
  Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean))).sort();

const disabledReason = (capability: CapabilityState): string | undefined => {
  if (capability.pending) {
    return 'Checking permission…';
  }
  if (!capability.allowed) {
    return capability.reason ?? 'You do not have permission to remove this finalizer.';
  }
  return undefined;
};

// Namespace deletion conditions are negative-polarity: every type names a
// failure or leftover content. False therefore carries no diagnosis and is
// dropped, so the conditions that do explain the block stand alone.
const blockingCondition = (condition: DetailCondition): boolean => condition.status !== 'False';

const deletionConditionVariant = (status: string): StatusChipVariant =>
  status === 'True' ? 'unhealthy' : 'warning';

interface FinalizerRowProps {
  entry: FinalizerEntry;
  /** Namespaces carry two finalizer lists; naming the field disambiguates them. */
  showPath: boolean;
  onRemove: (finalizer: string, path: FinalizerPath) => void;
}

function FinalizerRow({ entry, showPath, onRemove }: Readonly<FinalizerRowProps>) {
  return (
    <div className="deletion-finalizer-row">
      <div className="deletion-finalizer-heading">
        <code className="deletion-finalizer-name">{entry.name}</code>
        {showPath ? <span className="deletion-finalizer-path">{entry.path}</span> : null}
      </div>
      <button
        type="button"
        className="button danger deletion-remove-button"
        aria-label={`Remove finalizer ${entry.name}`}
        disabled={!entry.capability.allowed || entry.capability.pending}
        title={disabledReason(entry.capability)}
        onClick={() => onRemove(entry.name, entry.path)}
      >
        Remove
      </button>
    </div>
  );
}

export default function FinalizersSection({
  deletion,
  namespaceFinalization,
  objectData,
  removalCapabilities,
  onAfterAction,
}: Readonly<FinalizersSectionProps>) {
  const actionController = useObjectActionController({
    context: 'object-panel',
    useDefaultHandlers: false,
    onAfterAction: () => onAfterAction(),
  });

  if (!deletion) {
    return null;
  }

  const metadataFinalizers = normalizedFinalizers(deletion.finalizers);
  const namespaceFinalizers = normalizedFinalizers(namespaceFinalization?.finalizers);
  const entries: FinalizerEntry[] = [
    ...metadataFinalizers.map((name) => ({
      name,
      path: 'metadata.finalizers' as const,
      capability: removalCapabilities.metadata,
    })),
    ...namespaceFinalizers.map((name) => ({
      name,
      path: 'spec.finalizers' as const,
      capability: removalCapabilities.namespaceSpec,
    })),
  ];
  // spec.finalizers is a different API from metadata.finalizers — it is cleared
  // through the /finalize subresource — so once one exists every row names its
  // field. Objects with only metadata.finalizers have nothing to disambiguate.
  const showPaths = namespaceFinalizers.length > 0;
  const conditions = (namespaceFinalization?.conditions ?? []).filter(blockingCondition);
  const removeFinalizer = actionController.requestFinalizerRemoval.bind(null, objectData);

  return (
    <div className="object-panel-section deletion-section">
      <div className="object-panel-section-header">
        <div className="object-panel-section-title deletion-section-title">
          <span>Finalizers</span>
          <Tooltip
            maxWidth={420}
            content={
              <div className="deletion-finalizers-tooltip-copy">
                <p>
                  Finalizers are used to ensure that required cleanup is completed before an object
                  is deleted. A Finalizer can block object deletion until its controller has
                  finished its work.
                </p>
                <p>
                  There is no simple way to determine what is preventing a Finalizer from
                  completing. You may be able to get more information by checking Events, the logs
                  of the responsible controller, or the YAML <code>status</code> block of this
                  object.
                </p>
                <p>
                  If you are certain that this object can be safely deleted, you can remove the
                  finalizer(s) below.
                </p>
              </div>
            }
          />
        </div>
        <div className="deletion-age">
          Terminating for{' '}
          <LiveAgeText timestamp={deletion.deletionTimestamp} fullDateTitle fallback="unknown" />
        </div>
      </div>

      {entries.length > 0 ? (
        <div className="deletion-finalizer-list">
          {entries.map((entry) => (
            <FinalizerRow
              key={`${entry.path}:${entry.name}`}
              entry={entry}
              showPath={showPaths}
              onRemove={removeFinalizer}
            />
          ))}
        </div>
      ) : (
        <p className="deletion-empty">
          No finalizers remain on this object. Kubernetes may still be completing deletion.
        </p>
      )}

      {conditions.length > 0 && (
        <div className="deletion-conditions">
          <span className="deletion-conditions-label">Namespace deletion conditions</span>
          {conditions.map((condition) => (
            <div
              className="deletion-condition"
              key={`${condition.type ?? 'condition'}:${condition.reason ?? ''}`}
            >
              <StatusChip variant={deletionConditionVariant(condition.status)}>
                {condition.type || 'Condition'}
              </StatusChip>
              {!!(condition.message || condition.reason) && (
                <span className="deletion-condition-message">
                  {condition.message || condition.reason}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
      {actionController.modals}
    </div>
  );
}
