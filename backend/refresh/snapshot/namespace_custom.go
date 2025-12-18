package snapshot

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"

	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	apiextensionsinformers "k8s.io/apiextensions-apiserver/pkg/client/informers/externalversions"
	apiextensionslisters "k8s.io/apiextensions-apiserver/pkg/client/listers/apiextensions/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"

	"github.com/luxury-yacht/app/backend/internal/parallel"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/logstream"
)

const (
	namespaceCustomDomainName = "namespace-custom"
	customWorkerLimit         = 8
)

// NamespaceCustomBuilder discovers custom resources via the dynamic client.
type NamespaceCustomBuilder struct {
	dynamic   dynamic.Interface
	crdLister apiextensionslisters.CustomResourceDefinitionLister
	logger    logstream.Logger
}

// NamespaceCustomSnapshot is returned to clients.
type NamespaceCustomSnapshot struct {
	Resources []NamespaceCustomSummary `json:"resources"`
}

// NamespaceCustomSummary captures key CR instance fields.
type NamespaceCustomSummary struct {
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	APIGroup  string `json:"apiGroup"`
	Namespace string `json:"namespace"`
	Age       string `json:"age"`
}

// RegisterNamespaceCustomDomain wires the builder into the registry.
func RegisterNamespaceCustomDomain(
	reg *domain.Registry,
	apiextFactory apiextensionsinformers.SharedInformerFactory,
	dynamicClient dynamic.Interface,
	logger logstream.Logger,
) error {
	if apiextFactory == nil {
		return fmt.Errorf("apiextensions informer factory is nil")
	}
	if dynamicClient == nil {
		return fmt.Errorf("dynamic client is nil")
	}

	builder := &NamespaceCustomBuilder{
		dynamic:   dynamicClient,
		crdLister: apiextFactory.Apiextensions().V1().CustomResourceDefinitions().Lister(),
		logger:    logger,
	}

	return reg.Register(refresh.DomainConfig{
		Name:          namespaceCustomDomainName,
		BuildSnapshot: builder.Build,
	})
}

func (b *NamespaceCustomBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	trimmed := strings.TrimSpace(scope)
	if trimmed == "" {
		return nil, fmt.Errorf("namespace scope is required")
	}

	isAll := isAllNamespaceScope(trimmed)
	namespace := normalizeNamespaceScope(scope)
	if isAll {
		namespace = ""
	}
	if namespace == "" && !isAll {
		return nil, fmt.Errorf("namespace scope is required")
	}

	if b.crdLister == nil {
		return nil, fmt.Errorf("crd lister not initialised")
	}

	crds, err := b.crdLister.List(labels.Everything())
	if err != nil {
		return nil, err
	}

	namespacedCRDs := make([]*apiextensionsv1.CustomResourceDefinition, 0, len(crds))
	for i := range crds {
		crd := crds[i]
		if crd != nil && crd.Spec.Scope == "Namespaced" {
			namespacedCRDs = append(namespacedCRDs, crd)
		}
	}

	if len(namespacedCRDs) == 0 {
		if b.logger != nil {
			b.logger.Info("namespace-custom: no namespaced CRDs discovered", "Refresh")
		}
		snapshotScope := namespace
		if isAll {
			snapshotScope = "namespace:all"
		}
		return &refresh.Snapshot{
			Domain:  namespaceCustomDomainName,
			Scope:   snapshotScope,
			Version: 0,
			Payload: NamespaceCustomSnapshot{Resources: []NamespaceCustomSummary{}},
			Stats:   refresh.SnapshotStats{ItemCount: 0},
		}, nil
	}

	summaries := make([]NamespaceCustomSummary, 0)
	var version uint64
	var firstErr error
	var warnings []string
	var mu sync.Mutex

	tasks := make([]func(context.Context) error, 0, len(namespacedCRDs))

	for _, crd := range namespacedCRDs {
		crdCopy := crd
		if crdCopy == nil {
			continue
		}

		tasks = append(tasks, func(ctx context.Context) error {
			select {
			case <-ctx.Done():
				return ctx.Err()
			default:
			}

			crdVersion := preferredCRDVersion(crdCopy)
			if crdVersion == "" {
				return nil
			}

			gvr := schema.GroupVersionResource{
				Group:    crdCopy.Spec.Group,
				Version:  crdVersion,
				Resource: crdCopy.Spec.Names.Plural,
			}

			listNamespace := namespace
			if isAll {
				listNamespace = metav1.NamespaceAll
			}
			resourceList, err := b.dynamic.Resource(gvr).Namespace(listNamespace).List(ctx, metav1.ListOptions{})
			if err != nil {
				if shouldSkipError(err) {
					return nil
				}
				if b.logger != nil {
					b.logger.Warn(fmt.Sprintf("namespace-custom: list %s failed: %v", gvr.String(), err), "Refresh")
				}
				mu.Lock()
				warning := fmt.Sprintf("Failed to list %s: %v", gvr.String(), err)
				warnings = append(warnings, warning)
				if firstErr == nil {
					firstErr = fmt.Errorf("list %s: %w", gvr.String(), err)
				}
				mu.Unlock()
				return nil
			}

			if resourceList == nil || len(resourceList.Items) == 0 {
				return nil
			}

			items := make([]NamespaceCustomSummary, 0, len(resourceList.Items))
			var snapshotVersion uint64
			for i := range resourceList.Items {
				item := &resourceList.Items[i]
				itemNamespace := item.GetNamespace()
				if itemNamespace == "" {
					itemNamespace = namespace
				}
				items = append(items, NamespaceCustomSummary{
					Kind:      resourceKind(item, crdCopy.Spec.Names.Kind),
					Name:      item.GetName(),
					APIGroup:  gvr.Group,
					Namespace: itemNamespace,
					Age:       formatAge(item.GetCreationTimestamp().Time),
				})
				if v := resourceVersionOrTimestamp(item); v > snapshotVersion {
					snapshotVersion = v
				}
			}

			mu.Lock()
			summaries = append(summaries, items...)
			if snapshotVersion > version {
				version = snapshotVersion
			}
			mu.Unlock()

			return nil
		})
	}

	if err := parallel.RunLimited(ctx, customWorkerLimit, tasks...); err != nil {
		return nil, err
	}

	if len(summaries) == 0 && firstErr != nil {
		return nil, firstErr
	}

	sortNamespaceCustomSummaries(summaries)

	payload := NamespaceCustomSnapshot{Resources: summaries}
	if payload.Resources == nil {
		payload.Resources = []NamespaceCustomSummary{}
	}

	stats := refresh.SnapshotStats{
		ItemCount: len(payload.Resources),
	}
	if len(warnings) > 0 {
		stats.Warnings = append(stats.Warnings, warnings...)
	}

	snapshotScope := namespace
	if isAll {
		snapshotScope = "namespace:all"
	}

	return &refresh.Snapshot{
		Domain:  namespaceCustomDomainName,
		Scope:   snapshotScope,
		Version: version,
		Payload: payload,
		Stats:   stats,
	}, nil
}

func normalizeNamespaceScope(scope string) string {
	value := strings.TrimSpace(scope)
	if value == "" {
		return ""
	}
	if after, ok := strings.CutPrefix(value, "namespace:"); ok {
		value = after
	}
	return strings.TrimPrefix(value, ":")
}

func sortNamespaceCustomSummaries(resources []NamespaceCustomSummary) {
	sort.SliceStable(resources, func(i, j int) bool {
		if resources[i].Namespace != resources[j].Namespace {
			return resources[i].Namespace < resources[j].Namespace
		}
		if resources[i].APIGroup != resources[j].APIGroup {
			return resources[i].APIGroup < resources[j].APIGroup
		}
		if resources[i].Kind != resources[j].Kind {
			return resources[i].Kind < resources[j].Kind
		}
		return resources[i].Name < resources[j].Name
	})
}
