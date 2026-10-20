package snapshot

import (
	"context"
	"fmt"
	"sort"
	"strings"

	appsv1 "k8s.io/api/apps/v1"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/doorbell"
	"github.com/luxury-yacht/app/backend/refresh/querypage"
	"github.com/luxury-yacht/app/backend/resources/hpa"
)

const (
	namespaceAutoscalingDomainName       = "namespace-autoscaling"
	errNamespaceAutoscalingScopeRequired = "namespace scope is required"
)

// NamespaceAutoscalingBuilder constructs HPA summaries via the shared typed-table
// domain skeleton (typed_table_domain.go).
type NamespaceAutoscalingBuilder struct {
	collectIndexer func(streamspec.Descriptor) cache.Indexer
	// maintained, when set, is an informer-fed store the builder serves rows from
	// instead of listing + re-projecting per request. nil falls back to the list path.
	maintained *typedMaintainedStore[AutoscalingSummary]
}

// autoscalingQuerypageSchema derives the querypage Schema for the autoscaling table
// from the existing typed-table adapter, via the shared generic schema builder. It
// REUSES the adapter's exact comparable sort-value encoder and row key, so the
// querypage engine orders rows byte-identically to the live typed-table executor.
func autoscalingQuerypageSchema() querypage.Schema[AutoscalingSummary] {
	return querypageSchemaFromAdapter(autoscalingTableQueryAdapter(), namespaceAutoscalingQueryCapabilities().SortableFields)
}

// NamespaceAutoscalingSnapshot payload for autoscaling tab.
type NamespaceAutoscalingSnapshot struct {
	ClusterMeta
	ResourceQueryEnvelope
	Rows []AutoscalingSummary `json:"rows"`
}

func namespaceAutoscalingQueryCapabilities() ResourceQueryCapabilities {
	return newTypedResourceCapabilities(
		[]string{"name", "kind", "namespace", "target", "min", "max", "current", "age"},
		[]string{"kinds", "namespaces"},
		[]string{"kind", "name", "namespace", "target", "targetApiVersion"},
		[]string{hpa.Identity.Kind},
	)
}

// AutoscalingSummary captures HPA details for display. The type lives in the
// streamrows leaf so the hpa package can build it; this alias keeps the
// snapshot-side name and wire JSON unchanged.
type AutoscalingSummary = streamrows.AutoscalingSummary

func namespaceAutoscalingDomainSpec() typedTableDomainSpec[AutoscalingSummary] {
	return typedTableDomainSpec[AutoscalingSummary]{
		domain:           namespaceAutoscalingDomainName,
		scopeRequiredErr: errNamespaceAutoscalingScopeRequired,
		entryLimit:       config.SnapshotNamespaceAutoscalingEntryLimit,
		description:      "autoscaling resources",
		listErrorPrefix:  "namespace autoscaling: failed to list hpas",
		adapter:          autoscalingTableQueryAdapter(),
		schema:           autoscalingQuerypageSchema(),
		capabilities:     namespaceAutoscalingQueryCapabilities(),
		sortRows:         sortAutoscalingSummaries,
		derived:          hpaWorkloadChanges,
	}
}

// hpaWorkloadChanges rings the namespace's workload rows when an HPA targets a
// workload: the workloads table joins each row's HPA from the lister at serve
// (namespace_workloads.go), so the HPA change can change its target's row.
func hpaWorkloadChanges(obj metav1.Object) []doorbell.Change {
	hpaObject, ok := obj.(*autoscalingv1.HorizontalPodAutoscaler)
	if !ok || !hpaTargetsWorkload(hpaObject.Spec.ScaleTargetRef) {
		return nil
	}
	return []doorbell.Change{{
		Domain:          namespaceWorkloadsDomainName,
		Source:          doorbell.SourceObject,
		Target:          doorbell.Scopes(namespaceDoorbellScopes(hpaObject.Namespace)...),
		ResourceVersion: hpaObject.ResourceVersion,
	}}
}

// hpaTargetsWorkload reports whether the scale target is a kind the workloads
// table lists.
func hpaTargetsWorkload(ref autoscalingv1.CrossVersionObjectReference) bool {
	gvk := schema.FromAPIVersionAndKind(ref.APIVersion, ref.Kind)
	if strings.TrimSpace(ref.Name) == "" {
		return false
	}
	switch gvk.GroupVersion() {
	case appsv1.SchemeGroupVersion:
		return gvk.Kind == "Deployment" || gvk.Kind == "StatefulSet" || gvk.Kind == "DaemonSet"
	case batchv1.SchemeGroupVersion:
		return gvk.Kind == "Job" || gvk.Kind == "CronJob"
	case corev1.SchemeGroupVersion:
		return gvk.Kind == "Pod"
	default:
		return false
	}
}

func sortAutoscalingSummaries(resources []AutoscalingSummary) {
	sort.Slice(resources, func(i, j int) bool {
		if resources[i].Ref.Namespace == resources[j].Ref.Namespace {
			return resources[i].Ref.Name < resources[j].Ref.Name
		}
		return resources[i].Ref.Namespace < resources[j].Ref.Namespace
	})
}

// RegisterNamespaceAutoscalingDomain registers the autoscaling domain.
func RegisterNamespaceAutoscalingDomain(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
	clusterMeta ClusterMeta,
	bell doorbell.Bell,
) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	// namespace-autoscaling has no IngestOwned kinds (HPA stays a typed informer, not
	// cut), so the ingest manager is nil here — the cut-kind availability branch is never
	// taken and the ingest feed is a no-op.
	collectIndexer := unconditionalSharedIndexers(factory, namespaceAutoscalingDomainName, nil)
	maintained, err := newRegisteredTypedTableStore(reg, namespaceAutoscalingDomainSpec(), clusterMeta,
		typedTableStoreInputs{indexers: collectIndexer, shared: factory}, bell)
	if err != nil {
		return err
	}

	builder := &NamespaceAutoscalingBuilder{
		collectIndexer: collectIndexer,
		maintained:     maintained,
	}
	return reg.Register(refresh.DomainConfig{
		Name:          namespaceAutoscalingDomainName,
		BuildSnapshot: builder.Build,
	})
}

// Build assembles HPA summaries for a namespace.
func (b *NamespaceAutoscalingBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	return buildTypedTableSnapshot(ctx, scope, namespaceAutoscalingDomainSpec(), b.collectIndexer, b.maintained,
		func(meta ClusterMeta, envelope ResourceQueryEnvelope, rows []AutoscalingSummary) any {
			return NamespaceAutoscalingSnapshot{ClusterMeta: meta, ResourceQueryEnvelope: envelope, Rows: rows}
		})
}
