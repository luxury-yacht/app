package snapshot

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	autoscalingv1 "k8s.io/api/autoscaling/v1"
	"k8s.io/apimachinery/pkg/labels"
	informers "k8s.io/client-go/informers"
	autoscalinglisters "k8s.io/client-go/listers/autoscaling/v1"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
)

const (
	namespaceAutoscalingDomainName       = "namespace-autoscaling"
	namespaceAutoscalingEntryLimit       = 1000
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
}

// AutoscalingSummary captures HPA details for display.
type AutoscalingSummary struct {
	ClusterMeta
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Target    string `json:"target"`
	Min       int32  `json:"min"`
	Max       int32  `json:"max"`
	Current   int32  `json:"current"`
	Age       string `json:"age"`
}

func parseAutoscalingNamespace(scope string) (string, error) {
	_, scopeValue := refresh.SplitClusterScope(scope)
	namespace := strings.TrimSpace(scopeValue)
	if strings.HasPrefix(namespace, "namespace:") {
		namespace = strings.TrimPrefix(namespace, "namespace:")
		namespace = strings.TrimLeft(namespace, ":")
	}
	namespace = strings.TrimSpace(namespace)
	if namespace == "" {
		return "", errors.New(errNamespaceAutoscalingScopeRequired)
	}
	return namespace, nil
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
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	trimmed = strings.TrimSpace(trimmed)
	if trimmed == "" {
		return nil, errors.New(errNamespaceAutoscalingScopeRequired)
	}

	isAll := isAllNamespaceScope(trimmed)
	var (
		namespace  string
		err        error
		scopeLabel string
	)
	if isAll {
		scopeLabel = refresh.JoinClusterScope(clusterID, "namespace:all")
	} else {
		namespace, err = parseAutoscalingNamespace(trimmed)
		if err != nil {
			return nil, err
		}
		scopeLabel = refresh.JoinClusterScope(clusterID, trimmed)
	}

	hpas, err := b.listHPAs(namespace)
	if err != nil {
		return nil, fmt.Errorf("namespace autoscaling: failed to list hpas: %w", err)
	}

	return b.buildSnapshot(meta, scopeLabel, hpas)
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
		summary := AutoscalingSummary{
			ClusterMeta: meta,
			Kind:      "HorizontalPodAutoscaler",
			Name:      hpa.Name,
			Namespace: hpa.Namespace,
			Target:    describeHPATarget(hpa),
			Min:       minReplicas(hpa),
			Max:       hpa.Spec.MaxReplicas,
			Current:   hpa.Status.CurrentReplicas,
			Age:       formatAge(hpa.CreationTimestamp.Time),
		}
		resources = append(resources, summary)
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

	if len(resources) > namespaceAutoscalingEntryLimit {
		resources = resources[:namespaceAutoscalingEntryLimit]
	}

	return &refresh.Snapshot{
		Domain:  namespaceAutoscalingDomainName,
		Scope:   scope,
		Version: version,
		Payload: NamespaceAutoscalingSnapshot{ClusterMeta: meta, Resources: resources},
		Stats: refresh.SnapshotStats{
			ItemCount: len(resources),
		},
	}, nil
}

func describeHPATarget(hpa *autoscalingv1.HorizontalPodAutoscaler) string {
	if hpa == nil {
		return ""
	}
	ref := hpa.Spec.ScaleTargetRef
	return fmt.Sprintf("%s/%s", ref.Kind, ref.Name)
}

func minReplicas(hpa *autoscalingv1.HorizontalPodAutoscaler) int32 {
	if hpa == nil || hpa.Spec.MinReplicas == nil {
		return 1
	}
	return *hpa.Spec.MinReplicas
}
