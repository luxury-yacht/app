package snapshot

import (
	"context"
	"fmt"
	"sort"
	"strings"

	autoscalingv1 "k8s.io/api/autoscaling/v1"
	"k8s.io/apimachinery/pkg/labels"
	informers "k8s.io/client-go/informers"
	autoscalinglisters "k8s.io/client-go/listers/autoscaling/v1"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/streamrows"
	hpapkg "github.com/luxury-yacht/app/backend/resources/hpa"
)

const (
	namespaceAutoscalingDomainName       = "namespace-autoscaling"
	errNamespaceAutoscalingScopeRequired = "namespace scope is required"
)

// NamespaceAutoscalingBuilder constructs HPA summaries.
type NamespaceAutoscalingBuilder struct {
	hpaLister autoscalinglisters.HorizontalPodAutoscalerLister
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
		[]string{"HorizontalPodAutoscaler"},
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
		hpaLister: factory.Autoscaling().V1().HorizontalPodAutoscalers().Lister(),
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

	hpas, err := b.listHPAs(parsedScope.Namespace)
	if err != nil {
		return nil, fmt.Errorf("namespace autoscaling: failed to list hpas: %w", err)
	}

	return b.buildSnapshot(meta, refresh.JoinClusterScope(clusterID, strings.TrimSpace(trimmed)), query, hpas)
}

func (b *NamespaceAutoscalingBuilder) listHPAs(namespace string) ([]*autoscalingv1.HorizontalPodAutoscaler, error) {
	if namespace == "" {
		return b.hpaLister.List(labels.Everything())
	}
	return b.hpaLister.HorizontalPodAutoscalers(namespace).List(labels.Everything())
}

func (b *NamespaceAutoscalingBuilder) buildSnapshot(
	meta ClusterMeta,
	scope string,
	query typedTableQuery,
	hpas []*autoscalingv1.HorizontalPodAutoscaler,
) (*refresh.Snapshot, error) {
	resources := make([]AutoscalingSummary, 0, len(hpas))
	var version uint64

	for _, hpa := range hpas {
		if hpa == nil {
			continue
		}
		// The hpa package owns the row builder; the full-snapshot path here
		// and the streaming/incremental path both call it so they cannot drift.
		resources = append(resources, hpapkg.BuildStreamSummary(meta, hpa))
		if v := resourceVersionOrTimestamp(hpa); v > version {
			version = v
		}
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
		namespaceAutoscalingQueryCapabilities(),
		config.SnapshotNamespaceAutoscalingEntryLimit,
		"autoscaling resources",
		func(resource AutoscalingSummary) string { return resource.Kind },
		nil,
	)
	return &refresh.Snapshot{
		Domain:  namespaceAutoscalingDomainName,
		Scope:   scope,
		Version: version,
		Payload: NamespaceAutoscalingSnapshot{
			ClusterMeta:           meta,
			ResourceQueryEnvelope: resolved.Envelope,
			Rows:                  resolved.Rows,
		},
		Stats: resolved.Stats,
	}, nil
}
