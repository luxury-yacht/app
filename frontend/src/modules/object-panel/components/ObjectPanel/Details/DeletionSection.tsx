import { LiveAgeText } from '@shared/components/LiveAgeText';
import type { ObjectDeletionMetadata } from '@/core/refresh/types.generated';
import { finalizerGuidance } from './finalizerCatalog';
import type { NamespaceFinalizationDetails } from './objectDetailModel';
import './DeletionSection.css';

interface DeletionSectionProps {
  deletion: ObjectDeletionMetadata | null;
  namespaceFinalization: NamespaceFinalizationDetails | null;
}

const normalizedFinalizers = (values?: string[]): string[] =>
  Array.from(new Set((values ?? []).map((value) => value.trim()).filter(Boolean))).sort();

function FinalizerGroup({ source, values }: Readonly<{ source: string; values?: string[] }>) {
  const finalizers = normalizedFinalizers(values);
  if (finalizers.length === 0) {
    return null;
  }

  return (
    <div className="deletion-finalizer-group">
      <div className="deletion-subtitle">{source}</div>
      <div className="deletion-card-list">
        {finalizers.map((finalizer) => {
          const guidance = finalizerGuidance(finalizer);
          return (
            <div className="deletion-card" key={`${source}:${finalizer}`}>
              <code className="deletion-finalizer-name">{finalizer}</code>
              <div className="deletion-guidance-title">{guidance.title}</div>
              <div>{guidance.explanation}</div>
              <div className="deletion-next-step">{guidance.nextStep}</div>
              {!!guidance.consequence && (
                <div className="deletion-consequence">{guidance.consequence}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function DeletionSection({
  deletion,
  namespaceFinalization,
}: Readonly<DeletionSectionProps>) {
  if (!deletion) {
    return null;
  }

  const metadataFinalizers = normalizedFinalizers(deletion.finalizers);
  const namespaceFinalizers = normalizedFinalizers(namespaceFinalization?.finalizers);
  const hasFinalizers = metadataFinalizers.length > 0 || namespaceFinalizers.length > 0;
  const conditions = namespaceFinalization?.conditions ?? [];

  return (
    <div className="object-panel-section deletion-section">
      <div className="object-panel-section-title">Deletion</div>
      <div className="deletion-summary">
        Terminating for{' '}
        <LiveAgeText timestamp={deletion.deletionTimestamp} fullDateTitle fallback="unknown" />
      </div>
      <p className="deletion-explanation">
        Finalizers keep an object present until its controller finishes protected cleanup.
      </p>

      <FinalizerGroup source="metadata.finalizers" values={metadataFinalizers} />
      <FinalizerGroup source="spec.finalizers" values={namespaceFinalizers} />

      {!hasFinalizers && (
        <div className="deletion-empty">
          No finalizers remain on this object. Kubernetes may still be completing deletion.
        </div>
      )}

      {conditions.length > 0 && (
        <div className="deletion-conditions">
          <div className="deletion-subtitle">Namespace deletion conditions</div>
          <div className="deletion-card-list">
            {conditions.map((condition) => (
              <div
                className="deletion-card"
                key={`${condition.type ?? 'condition'}:${condition.reason ?? ''}`}
              >
                <div className="deletion-condition-header">
                  <code>{condition.type || 'Condition'}</code>
                  <span className="deletion-condition-status">{condition.status}</span>
                </div>
                {!!condition.reason && (
                  <div className="deletion-guidance-title">{condition.reason}</div>
                )}
                {!!condition.message && <div>{condition.message}</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
