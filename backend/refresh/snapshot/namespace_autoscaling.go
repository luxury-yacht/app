package snapshot

import (
	"context"
	"fmt"
	"sort"
	"strings"

	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/kind/kindregistry"
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

// NamespaceAutoscalingBuilder constructs HPA summaries by listing the kind's
// informer indexer and projecting it via the hpa package's stream-summary
// builder; Build loops the stream descriptor registry via collectDescriptorTableRows.
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

// RegisterNamespaceAutoscalingDomain registers the autoscaling domain.
func RegisterNamespaceAutoscalingDomain(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
	clusterMeta ClusterMeta,
) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	collectIndexer := unconditionalSharedIndexers(factory, namespaceAutoscalingDomainName)

	// Maintain a per-cluster store fed by each available autoscaling kind's informer.
	// Handlers are registered BEFORE the factory starts, so the snapshot sync gate
	// guarantees the store is populated before the first Build serves from it.
	maintained := newTypedMaintainedStore(clusterMeta, autoscalingQuerypageSchema(), autoscalingTableQueryAdapter())
	for _, d := range kindregistry.StreamDescriptorsForDomain(namespaceAutoscalingDomainName) {
		if collectIndexer(d) == nil || d.Informer == nil {
			continue
		}
		desc := d
		if _, err := d.Informer(factory).AddEventHandler(cache.ResourceEventHandlerFuncs{
			AddFunc:    func(obj interface{}) { maintained.ingest(desc, obj) },
			UpdateFunc: func(_, newObj interface{}) { maintained.ingest(desc, newObj) },
			DeleteFunc: func(obj interface{}) { maintained.evict(desc, obj) },
		}); err != nil {
			return fmt.Errorf("%s: register %s handler: %w", namespaceAutoscalingDomainName, d.Resource, err)
		}
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

// autoscalingSources computes per-descriptor availability for THIS request (indexer
// present AND runtimeResourceAllowed), returning the snapshot sources and a
// Kind→available map — the same gating collectDescriptorTableRows applies, so the
// maintained-store path and the list path agree on which kinds are visible.
func (b *NamespaceAutoscalingBuilder) autoscalingSources(ctx context.Context) ([]typedTableResourceSource, map[string]bool) {
	descriptors := kindregistry.StreamDescriptorsForDomain(namespaceAutoscalingDomainName)
	sources := make([]typedTableResourceSource, 0, len(descriptors))
	available := make(map[string]bool, len(descriptors))
	for _, d := range descriptors {
		ok := b.collectIndexer(d) != nil && runtimeResourceAllowed(ctx, namespaceAutoscalingDomainName, d.Group, d.Resource)
		sources = append(sources, typedTableResourceSource{
			Kind:      d.Kind,
			Group:     d.Group,
			Resource:  d.Resource,
			Available: ok,
		})
		available[d.Kind] = ok
	}
	return sources, available
}

// Build assembles HPA summaries for a namespace.
func (b *NamespaceAutoscalingBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	meta := ClusterMetaFromContext(ctx)
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	baseScope, query, err := parseTypedTableQueryScope(clusterID, strings.TrimSpace(trimmed), namespaceAutoscalingDomainName, "")
	if err != nil {
		return nil, err
	}
	parsedScope, err := parseNamespaceSnapshotScope(refresh.JoinClusterScope(clusterID, baseScope), errNamespaceAutoscalingScopeRequired)
	if err != nil {
		return nil, err
	}

	var resources []AutoscalingSummary
	var sources []typedTableResourceSource
	var version uint64
	if b.maintained != nil {
		// Serve projected rows straight from the informer-fed store (no re-listing /
		// re-projecting); availability + sources mirror the list path exactly.
		var available map[string]bool
		sources, available = b.autoscalingSources(ctx)
		resources = b.maintained.rows(parsedScope.Namespace, available)
		version = b.maintained.snapshotVersion()
	} else {
		var err error
		resources, sources, version, err = collectDescriptorTableRows[AutoscalingSummary](ctx, namespaceAutoscalingDomainName, b.collectIndexer, meta, parsedScope.Namespace)
		if err != nil {
			return nil, fmt.Errorf("namespace autoscaling: failed to list hpas: %w", err)
		}
	}

	sort.Slice(resources, func(i, j int) bool {
		if resources[i].Namespace == resources[j].Namespace {
			return resources[i].Name < resources[j].Name
		}
		return resources[i].Namespace < resources[j].Namespace
	})

	resolved := resolveTypedSnapshotPageViaStore(
		namespaceAutoscalingDomainName,
		resources,
		query,
		autoscalingTableQueryAdapter(),
		autoscalingQuerypageSchema(),
		capabilitiesWithAvailableKinds(namespaceAutoscalingQueryCapabilities(), sources),
		config.SnapshotNamespaceAutoscalingEntryLimit,
		"autoscaling resources",
		func(resource AutoscalingSummary) string { return resource.Kind },
		typedTableQueryResourceIssues(ctx, namespaceAutoscalingDomainName, query, sources),
	)
	return &refresh.Snapshot{
		Domain:  namespaceAutoscalingDomainName,
		Scope:   refresh.JoinClusterScope(clusterID, strings.TrimSpace(trimmed)),
		Version: version,
		Payload: NamespaceAutoscalingSnapshot{
			ClusterMeta:           meta,
			ResourceQueryEnvelope: resolved.Envelope,
			Rows:                  resolved.Rows,
		},
		Stats: resolved.Stats,
	}, nil
}
