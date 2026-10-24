package snapshot

import (
	"context"
	"sort"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/doorbell"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/querypage"
	"github.com/luxury-yacht/app/backend/resources/hpa"
)

// HPAGVR is the GVR the HorizontalPodAutoscaler ingest store is registered under.
var HPAGVR = hpa.Identity.GVR()

const (
	namespaceAutoscalingDomainName       = "namespace-autoscaling"
	errNamespaceAutoscalingScopeRequired = "namespace scope is required"
)

// NamespaceAutoscalingBuilder constructs HPA summaries via the shared typed-table
// domain skeleton (typed_table_domain.go).
type NamespaceAutoscalingBuilder struct {
	available kindAvailability
	// maintained, when set, is a reflector-fed store the builder serves rows from
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
		adapter:          autoscalingTableQueryAdapter(),
		schema:           autoscalingQuerypageSchema(),
		capabilities:     namespaceAutoscalingQueryCapabilities(),
		sortRows:         sortAutoscalingSummaries,
		payload: func(meta ClusterMeta, envelope ResourceQueryEnvelope, rows []AutoscalingSummary) any {
			return NamespaceAutoscalingSnapshot{ClusterMeta: meta, ResourceQueryEnvelope: envelope, Rows: rows}
		},
		derived: rowDerivation[AutoscalingSummary]{changes: hpaWorkloadChanges, domains: []string{namespaceWorkloadsDomainName}},
	}
}

// hpaWorkloadChanges rings the namespace's workload rows for an HPA change: the
// workloads table joins each row's HPA at serve, so the change can flip a
// workload's "HPA managed" flag. HPAs are few, so every change rings rather
// than parsing the row's display target.
func hpaWorkloadChanges(row AutoscalingSummary) []doorbell.Change {
	return []doorbell.Change{{
		Domain: namespaceWorkloadsDomainName,
		Source: doorbell.SourceObject,
		Target: doorbell.Scopes(namespaceDoorbellScopes(row.Ref.Namespace)...),
	}}
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
	clusterMeta ClusterMeta,
	ingestManager *ingest.IngestManager,
	bell doorbell.Bell,
) error {
	available := unconditionalIngestAvailability(namespaceAutoscalingDomainName, ingestManager)
	maintained, err := newRegisteredTypedTableStore(reg, namespaceAutoscalingDomainSpec(), clusterMeta,
		ingestManager, bell)
	if err != nil {
		return err
	}

	builder := &NamespaceAutoscalingBuilder{
		available:  available,
		maintained: maintained,
	}
	return reg.Register(refresh.DomainConfig{
		Name:          namespaceAutoscalingDomainName,
		BuildSnapshot: builder.Build,
	})
}

// Build assembles HPA summaries for a namespace.
func (b *NamespaceAutoscalingBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	return buildTypedTableSnapshot(ctx, scope, namespaceAutoscalingDomainSpec(), b.available, b.maintained)
}
