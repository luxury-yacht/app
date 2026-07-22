package snapshot

import (
	"context"
	"fmt"
	"sort"

	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
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
	return querypageSchemaFromAdapter(autoscalingTableQueryAdapter(), []string{"name", "kind", "namespace", "target", "min", "max", "current", "age"})
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
		kindOf:           func(resource AutoscalingSummary) string { return resource.Ref.Kind },
		sortRows:         sortAutoscalingSummaries,
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
) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	// namespace-autoscaling has no IngestOwned kinds (HPA is CustomStreamHandler, not
	// cut), so the ingest manager is nil here — the cut-kind availability branch is never
	// taken and the ingest feed is a no-op.
	collectIndexer := unconditionalSharedIndexers(factory, namespaceAutoscalingDomainName, nil)
	maintained, err := newRegisteredTypedTableStore(reg, namespaceAutoscalingDomainSpec(), clusterMeta, collectIndexer, factory, nil, nil)
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
