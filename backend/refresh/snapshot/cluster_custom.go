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
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/internal/parallel"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/containerlogsstream"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/resources/customresource"
)

const (
	clusterCustomDomainName = "cluster-custom"
)

// ClusterCustomBuilder discovers cluster-scoped custom resources.
type ClusterCustomBuilder struct {
	dynamic   dynamic.Interface
	crdLister apiextensionslisters.CustomResourceDefinitionLister
	logger    containerlogsstream.Logger
}

// ClusterCustomSummary captures key cluster custom resource fields.
//
// Group and Version together identify the owning CRD's GroupVersion
// so the frontend can disambiguate colliding Kinds across API groups.
// See the NamespaceCustomSummary comment for details.
// ClusterCustomSummary lives in the streamrows leaf so the customresource package
// can build it; this alias keeps the snapshot-side name and wire JSON.
type ClusterCustomSummary = streamrows.ClusterCustomSummary

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
	if err := b.validate(); err != nil {
		return nil, err
	}
	meta := ClusterMetaFromContext(ctx)
	crds, err := b.crdLister.List(labels.Everything())
	if err != nil {
		return nil, err
	}
	clusterCRDs := customResourceDefinitionsForScope(crds, apiextensionsv1.ClusterScoped)
	if len(clusterCRDs) == 0 {
		return emptyClusterCustomSnapshot(meta), nil
	}

	result := &clusterCustomBuildResult{}
	tasks := b.buildTasks(meta, clusterCRDs, result)
	if err := parallel.RunLimited(ctx, config.SnapshotClusterCustomWorkerLimit, tasks...); err != nil {
		result.recordRunError(err)
	}
	return result.snapshot(meta, clusterCRDs), result.firstError()
}

func (b *ClusterCustomBuilder) validate() error {
	if b.crdLister == nil {
		return fmt.Errorf("crd lister not initialised")
	}
	if b.dynamic == nil {
		return fmt.Errorf("dynamic client not initialised")
	}
	return nil
}

func emptyClusterCustomSnapshot(meta ClusterMeta) *refresh.Snapshot {
	return &refresh.Snapshot{
		Domain: clusterCustomDomainName,
		Payload: ClusterCustomSnapshot{
			ClusterMeta: meta,
			Resources:   []ClusterCustomSummary{},
			Kinds:       []string{},
		},
		Stats: refresh.SnapshotStats{},
	}
}

func (b *ClusterCustomBuilder) buildTasks(
	meta ClusterMeta,
	crds []*apiextensionsv1.CustomResourceDefinition,
	result *clusterCustomBuildResult,
) []func(context.Context) error {
	tasks := make([]func(context.Context) error, 0, len(crds))
	for _, crd := range crds {
		crdCopy := crd
		tasks = append(tasks, func(ctx context.Context) error {
			return b.collectCRD(ctx, meta, crdCopy, result)
		})
	}
	return tasks
}

func (b *ClusterCustomBuilder) collectCRD(
	ctx context.Context,
	meta ClusterMeta,
	crd *apiextensionsv1.CustomResourceDefinition,
	result *clusterCustomBuildResult,
) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	gvr, ok := customResourceGVR(crd)
	if !ok {
		return nil
	}
	resourceList, err := b.dynamic.Resource(gvr).List(ctx, metav1.ListOptions{})
	if err != nil {
		b.recordListError(gvr.String(), err, result)
		return nil
	}
	if resourceList == nil {
		return nil
	}
	summaries, version := buildClusterCustomSummaries(meta, crd, gvr, resourceList.Items)
	result.recordSummaries(summaries, version)
	return nil
}

func (b *ClusterCustomBuilder) recordListError(resource string, err error, result *clusterCustomBuildResult) {
	if shouldSkipError(err) {
		return
	}
	applog.Warn(b.logger, fmt.Sprintf("cluster-custom: list %s failed: %v", resource, err), logsources.Refresh)
	result.recordListError(resource, err)
}

func buildClusterCustomSummaries(
	meta ClusterMeta,
	crd *apiextensionsv1.CustomResourceDefinition,
	gvr schema.GroupVersionResource,
	items []unstructured.Unstructured,
) ([]ClusterCustomSummary, uint64) {
	summaries := make([]ClusterCustomSummary, 0, len(items))
	var version uint64
	for i := range items {
		item := items[i].DeepCopy()
		if item == nil || item.GetNamespace() != "" {
			continue
		}
		summaries = append(summaries, customresource.BuildClusterStreamSummary(
			meta, item, gvr.Group, gvr.Version, gvr.Resource, crd.Spec.Names.Kind, crd.Name,
		))
		version = maxSnapshotVersion(version, item)
	}
	if len(summaries) > 0 && version == 0 {
		version = resourceVersionOrTimestamp(crd)
	}
	return summaries, version
}

func maxSnapshotVersion(current uint64, object metav1.Object) uint64 {
	if version := resourceVersionOrTimestamp(object); version > current {
		return version
	}
	return current
}

type clusterCustomBuildResult struct {
	mu        sync.Mutex
	summaries []ClusterCustomSummary
	version   uint64
	warnings  []string
	firstErr  error
}

func (r *clusterCustomBuildResult) recordListError(resource string, err error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.firstErr == nil {
		r.firstErr = fmt.Errorf("list %s: %w", resource, err)
	}
	r.warnings = append(r.warnings, fmt.Sprintf("Failed to list %s: %v", resource, err))
}

func (r *clusterCustomBuildResult) recordRunError(err error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.firstErr == nil {
		r.firstErr = err
	}
}

func (r *clusterCustomBuildResult) recordSummaries(summaries []ClusterCustomSummary, version uint64) {
	if len(summaries) == 0 {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.summaries = append(r.summaries, summaries...)
	if version > r.version {
		r.version = version
	}
}

func (r *clusterCustomBuildResult) firstError() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.firstErr
}

func (r *clusterCustomBuildResult) snapshot(
	meta ClusterMeta,
	crds []*apiextensionsv1.CustomResourceDefinition,
) *refresh.Snapshot {
	r.mu.Lock()
	defer r.mu.Unlock()
	sortClusterCustomSummaries(r.summaries)
	resources := r.summaries
	if resources == nil {
		resources = []ClusterCustomSummary{}
	}
	version := clusterCustomSnapshotVersion(r.version, resources, crds)
	stats := refresh.SnapshotStats{ItemCount: len(resources), Warnings: append([]string(nil), r.warnings...)}
	return &refresh.Snapshot{
		Domain:  clusterCustomDomainName,
		Version: version,
		Payload: ClusterCustomSnapshot{ClusterMeta: meta, Resources: resources, Kinds: customResourceKinds(crds)},
		Stats:   stats,
	}
}

func sortClusterCustomSummaries(summaries []ClusterCustomSummary) {
	sort.Slice(summaries, func(i, j int) bool {
		if summaries[i].Ref.Kind == summaries[j].Ref.Kind {
			return summaries[i].Ref.Name < summaries[j].Ref.Name
		}
		return summaries[i].Ref.Kind < summaries[j].Ref.Kind
	})
}

func clusterCustomSnapshotVersion(
	version uint64,
	resources []ClusterCustomSummary,
	crds []*apiextensionsv1.CustomResourceDefinition,
) uint64 {
	if version > 0 || len(resources) == 0 {
		return version
	}
	if len(crds) > 0 {
		version = resourceVersionOrTimestamp(crds[0])
	}
	if version == 0 {
		version = uint64(len(resources))
	}
	return version
}
