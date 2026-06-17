package snapshot

import (
	"context"
	"fmt"
	"sort"
	"strings"

	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/streamrows"
	"github.com/luxury-yacht/app/backend/refresh/streamspec"
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
) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	builder := &NamespaceAutoscalingBuilder{
		collectIndexer: unconditionalSharedIndexers(factory, namespaceAutoscalingDomainName),
	}
	return reg.Register(refresh.DomainConfig{
		Name:          namespaceAutoscalingDomainName,
		BuildSnapshot: builder.Build,
	})
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

	resources, sources, version, err := collectDescriptorTableRows[AutoscalingSummary](ctx, namespaceAutoscalingDomainName, b.collectIndexer, meta, parsedScope.Namespace)
	if err != nil {
		return nil, fmt.Errorf("namespace autoscaling: failed to list hpas: %w", err)
	}

	sort.Slice(resources, func(i, j int) bool {
		if resources[i].Namespace == resources[j].Namespace {
			return resources[i].Name < resources[j].Name
		}
		return resources[i].Namespace < resources[j].Namespace
	})

	resolved := resolveTypedSnapshotPage(
		namespaceAutoscalingDomainName,
		resources,
		query,
		autoscalingTableQueryAdapter(),
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
