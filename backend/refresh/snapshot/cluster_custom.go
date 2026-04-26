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

	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/internal/parallel"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/containerlogsstream"
	"github.com/luxury-yacht/app/backend/refresh/domain"
)

const (
	clusterCustomDomainName  = "cluster-custom"
	clusterCustomWorkerLimit = 8
)

// ClusterCustomBuilder discovers cluster-scoped custom resources.
type ClusterCustomBuilder struct {
	dynamic   dynamic.Interface
	crdLister apiextensionslisters.CustomResourceDefinitionLister
	logger    containerlogsstream.Logger
}

// ClusterCustomSummary captures key cluster custom resource fields.
//
// APIGroup and APIVersion together identify the owning CRD's GroupVersion
// so the frontend can disambiguate colliding Kinds across API groups.
// See the NamespaceCustomSummary comment for details.
type ClusterCustomSummary struct {
	ClusterMeta
	Kind       string `json:"kind"`
	Name       string `json:"name"`
	APIGroup   string `json:"apiGroup"`
	APIVersion string `json:"apiVersion"`
	// CRDName is the name of the CustomResourceDefinition that defines
	// this resource's Kind, in the canonical Kubernetes form
	// `<plural>.<group>` (e.g. "dbclusters.rds.services.k8s.aws"). The
	// frontend's CRD column renders it as a clickable cell that opens
	// the owning CRD in the object panel. See NamespaceCustomSummary
	// for the same-shape field on the namespace-scoped variant.
	CRDName     string            `json:"crdName,omitempty"`
	Age         string            `json:"age"`
	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`
}

// ClusterCustomSnapshot is returned to clients.
type ClusterCustomSnapshot struct {
	ClusterMeta
	Resources []ClusterCustomSummary `json:"resources"`
	Kinds     []string               `json:"kinds,omitempty"`
}

// RegisterClusterCustomDomain registers the cluster custom domain.
func RegisterClusterCustomDomain(
	reg *domain.Registry,
	apiextFactory apiextensionsinformers.SharedInformerFactory,
	dynamicClient dynamic.Interface,
	logger containerlogsstream.Logger,
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

	meta := ClusterMetaFromContext(ctx)
	crds, err := b.crdLister.List(labels.Everything())
	if err != nil {
		return nil, err
	}

	clusterCRDs := make([]*apiextensionsv1.CustomResourceDefinition, 0, len(crds))
	for _, crd := range crds {
		if crd != nil && crd.Spec.Scope == apiextensionsv1.ClusterScoped && !IsFirstClassCustomResourceDefinition(crd) {
			clusterCRDs = append(clusterCRDs, crd)
		}
	}

	if len(clusterCRDs) == 0 {
		return &refresh.Snapshot{
			Domain:  clusterCustomDomainName,
			Version: 0,
			Payload: ClusterCustomSnapshot{
				ClusterMeta: meta,
				Resources:   []ClusterCustomSummary{},
				Kinds:       []string{},
			},
			Stats: refresh.SnapshotStats{ItemCount: 0},
		}, nil
	}

	kinds := make([]string, 0, len(clusterCRDs))
	for _, crd := range clusterCRDs {
		if crd == nil {
			continue
		}
		kinds = append(kinds, crd.Spec.Names.Kind)
	}
	kinds = snapshotSortedUniqueStrings(kinds)

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
					b.logger.Warn(fmt.Sprintf("cluster-custom: list %s failed: %v", gvr.String(), err), logsources.Refresh)
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
				// Delegate to the shared row builder so the full-snapshot
				// path and the streaming/incremental update path emit
				// identical row shapes. See BuildClusterCustomSummary in
				// streaming_helpers.go. `crdCopy.Name` is the canonical
				// CRD name (`<plural>.<group>`) used to open the owning
				// CRD from the row.
				localSummaries = append(localSummaries, BuildClusterCustomSummary(
					meta,
					item,
					gvr.Group,
					gvr.Version,
					crdCopy.Spec.Names.Kind,
					crdCopy.Name,
				))
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

	payload := ClusterCustomSnapshot{ClusterMeta: meta, Resources: summaries, Kinds: kinds}
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
