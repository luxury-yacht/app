package snapshot

import (
	"context"
	"fmt"
	"sort"
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
	clusterCustomDomainName  = "cluster-custom"
	clusterCustomWorkerLimit = 8
)

// ClusterCustomBuilder discovers cluster-scoped custom resources.
type ClusterCustomBuilder struct {
	dynamic   dynamic.Interface
	crdLister apiextensionslisters.CustomResourceDefinitionLister
	logger    logstream.Logger
}

// ClusterCustomSummary captures key cluster custom resource fields.
type ClusterCustomSummary struct {
	Kind     string `json:"kind"`
	Name     string `json:"name"`
	APIGroup string `json:"apiGroup"`
	Age      string `json:"age"`
}

// ClusterCustomSnapshot is returned to clients.
type ClusterCustomSnapshot struct {
	Resources []ClusterCustomSummary `json:"resources"`
}

// RegisterClusterCustomDomain registers the cluster custom domain.
func RegisterClusterCustomDomain(
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

	builder := &ClusterCustomBuilder{
		dynamic:   dynamicClient,
		crdLister: apiextFactory.Apiextensions().V1().CustomResourceDefinitions().Lister(),
		logger:    logger,
	}

	return reg.Register(refresh.DomainConfig{
		Name:          clusterCustomDomainName,
		BuildSnapshot: builder.Build,
	})
}

// Build assembles cluster-scoped custom resource summaries.
func (b *ClusterCustomBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	if b.crdLister == nil {
		return nil, fmt.Errorf("crd lister not initialised")
	}
	if b.dynamic == nil {
		return nil, fmt.Errorf("dynamic client not initialised")
	}

	crds, err := b.crdLister.List(labels.Everything())
	if err != nil {
		return nil, err
	}

	clusterCRDs := make([]*apiextensionsv1.CustomResourceDefinition, 0, len(crds))
	for _, crd := range crds {
		if crd != nil && crd.Spec.Scope == apiextensionsv1.ClusterScoped {
			clusterCRDs = append(clusterCRDs, crd)
		}
	}

	if len(clusterCRDs) == 0 {
		return &refresh.Snapshot{
			Domain:  clusterCustomDomainName,
			Version: 0,
			Payload: ClusterCustomSnapshot{Resources: []ClusterCustomSummary{}},
			Stats:   refresh.SnapshotStats{ItemCount: 0},
		}, nil
	}

	var (
		summaries []ClusterCustomSummary
		version   uint64
		warnings  []string
		firstErr  error
		mu        sync.Mutex
	)

	tasks := make([]func(context.Context) error, 0, len(clusterCRDs))
	for _, crd := range clusterCRDs {
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

			resourceList, err := b.dynamic.Resource(gvr).List(ctx, metav1.ListOptions{})
			if err != nil {
				if shouldSkipError(err) {
					return nil
				}
				if b.logger != nil {
					b.logger.Warn(fmt.Sprintf("cluster-custom: list %s failed: %v", gvr.String(), err), "Refresh")
				}
				mu.Lock()
				if firstErr == nil {
					firstErr = fmt.Errorf("list %s: %w", gvr.String(), err)
				}
				warnings = append(warnings, fmt.Sprintf("Failed to list %s: %v", gvr.String(), err))
				mu.Unlock()
				return nil
			}

			if resourceList == nil || len(resourceList.Items) == 0 {
				return nil
			}

			localSummaries := make([]ClusterCustomSummary, 0, len(resourceList.Items))
			var localVersion uint64
			for i := range resourceList.Items {
				item := resourceList.Items[i].DeepCopy()
				if item == nil {
					continue
				}
				if item.GetNamespace() != "" {
					continue
				}
				localSummaries = append(localSummaries, ClusterCustomSummary{
					Kind:     resourceKind(item, crdCopy.Spec.Names.Kind),
					Name:     item.GetName(),
					APIGroup: gvr.Group,
					Age:      formatAge(item.GetCreationTimestamp().Time),
				})
				if v := resourceVersionOrTimestamp(item); v > localVersion {
					localVersion = v
				}
			}

			if len(localSummaries) == 0 {
				return nil
			}

			if localVersion == 0 {
				localVersion = resourceVersionOrTimestamp(crdCopy)
			}

			mu.Lock()
			summaries = append(summaries, localSummaries...)
			if localVersion > version {
				version = localVersion
			}
			mu.Unlock()
			return nil
		})
	}

	if err := parallel.RunLimited(ctx, clusterCustomWorkerLimit, tasks...); err != nil && firstErr == nil {
		firstErr = err
	}

	sort.Slice(summaries, func(i, j int) bool {
		if summaries[i].Kind == summaries[j].Kind {
			return summaries[i].Name < summaries[j].Name
		}
		return summaries[i].Kind < summaries[j].Kind
	})

	payload := ClusterCustomSnapshot{Resources: summaries}
	stats := refresh.SnapshotStats{ItemCount: len(summaries)}
	if len(warnings) > 0 {
		stats.Warnings = append(stats.Warnings, warnings...)
	}
	if len(summaries) == 0 {
		payload.Resources = []ClusterCustomSummary{}
	}
	if len(summaries) > 0 && version == 0 {
		if len(clusterCRDs) > 0 {
			if v := resourceVersionOrTimestamp(clusterCRDs[0]); v > 0 {
				version = v
			}
		}
		if version == 0 {
			version = uint64(len(summaries))
		}
	}

	return &refresh.Snapshot{
		Domain:  clusterCustomDomainName,
		Version: version,
		Payload: payload,
		Stats:   stats,
	}, firstErr
}
