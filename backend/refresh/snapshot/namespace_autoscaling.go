package snapshot

import (
	"context"
	"fmt"
	"sort"

	autoscalingv1 "k8s.io/api/autoscaling/v1"
	"k8s.io/apimachinery/pkg/labels"
	informers "k8s.io/client-go/informers"
	autoscalinglisters "k8s.io/client-go/listers/autoscaling/v1"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/resourcemodel"
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
	Resources []AutoscalingSummary `json:"resources"`
	Kinds     []string             `json:"kinds,omitempty"`
}

// AutoscalingSummary captures HPA details for display.
//
// Target is the human-readable "Kind/Name" string used by the table column.
// TargetAPIVersion carries the scale target's apiVersion verbatim from
// hpa.Spec.ScaleTargetRef.APIVersion so the frontend can open the target
// in the object panel with a fully-qualified GVK — required for CRDs that
// share a Kind across groups (e.g. two operators each defining a custom
// scalable resource named DBCluster). Without it the strict object-YAML
// path hard-fails on CRD HPA targets.
type AutoscalingSummary struct {
	ClusterMeta
	Kind             string `json:"kind"`
	Name             string `json:"name"`
	Namespace        string `json:"namespace"`
	Target           string `json:"target"`
	TargetAPIVersion string `json:"targetApiVersion,omitempty"`
	Min              int32  `json:"min"`
	Max              int32  `json:"max"`
	Current          int32  `json:"current"`
	Age              string `json:"age"`
}

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
	parsedScope, err := parseNamespaceSnapshotScope(scope, errNamespaceAutoscalingScopeRequired)
	if err != nil {
		return nil, err
	}

	hpas, err := b.listHPAs(parsedScope.Namespace)
	if err != nil {
		return nil, fmt.Errorf("namespace autoscaling: failed to list hpas: %w", err)
	}

	return b.buildSnapshot(meta, parsedScope.CanonicalScope, hpas)
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
	hpas []*autoscalingv1.HorizontalPodAutoscaler,
) (*refresh.Snapshot, error) {
	resources := make([]AutoscalingSummary, 0, len(hpas))
	var version uint64

	for _, hpa := range hpas {
		if hpa == nil {
			continue
		}
		// Delegate to the shared row builder so the full-snapshot path
		// and the streaming/incremental update path emit identical row
		// shapes. See BuildHPASummary in streaming_helpers.go.
		resources = append(resources, BuildHPASummary(meta, hpa))
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

	if len(resources) > config.SnapshotNamespaceAutoscalingEntryLimit {
		resources = resources[:config.SnapshotNamespaceAutoscalingEntryLimit]
	}

	return &refresh.Snapshot{
		Domain:  namespaceAutoscalingDomainName,
		Scope:   scope,
		Version: version,
		Payload: NamespaceAutoscalingSnapshot{
			ClusterMeta: meta,
			Resources:   resources,
			Kinds:       snapshotSortedKinds(resources, func(resource AutoscalingSummary) string { return resource.Kind }),
		},
		Stats: refresh.SnapshotStats{
			ItemCount: len(resources),
		},
	}, nil
}

func describeHPATargetFacts(facts *resourcemodel.HorizontalPodAutoscalerFacts) string {
	if facts == nil {
		return ""
	}
	kind, name := resourceLinkKindName(facts.ScaleTarget)
	return fmt.Sprintf("%s/%s", kind, name)
}

func hpaMinReplicas(facts *resourcemodel.HorizontalPodAutoscalerFacts) int32 {
	if facts == nil || facts.MinReplicas == nil {
		return 1
	}
	return *facts.MinReplicas
}

func scaleTargetAPIVersion(link resourcemodel.ResourceLink) string {
	if link.Ref != nil {
		if link.Ref.Group == "" {
			return link.Ref.Version
		}
		return link.Ref.Group + "/" + link.Ref.Version
	}
	if link.Display != nil {
		if link.Display.Group == "" {
			return link.Display.Version
		}
		return link.Display.Group + "/" + link.Display.Version
	}
	return ""
}

func resourceLinkKindName(link resourcemodel.ResourceLink) (string, string) {
	if link.Ref != nil {
		return link.Ref.Kind, link.Ref.Name
	}
	if link.Display != nil {
		return link.Display.Kind, link.Display.Name
	}
	return "", ""
}
