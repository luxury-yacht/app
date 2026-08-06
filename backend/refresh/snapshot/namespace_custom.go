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
	namespaceCustomDomainName = "namespace-custom"
)

// NamespaceCustomBuilder discovers custom resources via the dynamic client.
type NamespaceCustomBuilder struct {
	dynamic   dynamic.Interface
	crdLister apiextensionslisters.CustomResourceDefinitionLister
	logger    containerlogsstream.Logger
	// scope is the cluster's namespace scope (docs/plans/namespace-scope.md):
	// the all-namespaces view fans the per-CRD LIST over these namespaces
	// instead of one cluster-wide LIST. Empty means cluster-wide (today).
	scope []string
}

// NamespaceCustomSnapshot is returned to clients.
type NamespaceCustomSnapshot struct {
	ClusterMeta
	Resources []NamespaceCustomSummary `json:"resources"`
	Kinds     []string                 `json:"kinds,omitempty"`
}

// NamespaceCustomSummary captures key CR instance fields.
//
// Group and Version together identify the owning CRD's GroupVersion
// so the frontend can route downstream operations (view YAML, delete,
// capability checks) through GVK-aware backend paths instead of the
// first-match-wins kind-only resolver. Without Version, two CRDs that
// share a Kind (e.g. DBInstance.rds.services.k8s.aws vs
// DBInstance.documentdb.services.k8s.aws) would be indistinguishable on
// the frontend.
// NamespaceCustomSummary lives in the streamrows leaf so the customresource
// package can build it; this alias keeps the snapshot-side name and wire JSON.
type NamespaceCustomSummary = streamrows.NamespaceCustomSummary

// RegisterNamespaceCustomDomain wires the builder into the registry.
func RegisterNamespaceCustomDomain(
	reg *domain.Registry,
	apiextFactory apiextensionsinformers.SharedInformerFactory,
	dynamicClient dynamic.Interface,
	logger containerlogsstream.Logger,
	allowedNamespaces []string,
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
		scope:     append([]string(nil), allowedNamespaces...),
	}

	return reg.Register(refresh.DomainConfig{
		Name:          namespaceCustomDomainName,
		BuildSnapshot: builder.Build,
	})
}

func (b *NamespaceCustomBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	meta := ClusterMetaFromContext(ctx)
	parsedScope, err := parseNamespaceSnapshotScope(scope, "namespace scope is required")
	if err != nil {
		return nil, err
	}

	if b.crdLister == nil {
		return nil, fmt.Errorf("crd lister not initialised")
	}

	crds, err := b.crdLister.List(labels.Everything())
	if err != nil {
		return nil, err
	}
	namespacedCRDs := customResourceDefinitionsForScope(crds, apiextensionsv1.NamespaceScoped)
	if len(namespacedCRDs) == 0 {
		applog.Info(b.logger, "namespace-custom: no namespaced CRDs discovered", logsources.Refresh)
		return emptyNamespaceCustomSnapshot(meta, parsedScope.CanonicalScope), nil
	}

	result := &namespaceCustomBuildResult{}
	tasks := b.buildTasks(meta, parsedScope, namespacedCRDs, result)
	if err := parallel.RunLimited(ctx, config.SnapshotNamespaceCustomWorkerLimit, tasks...); err != nil {
		return nil, err
	}
	return result.snapshot(meta, parsedScope.CanonicalScope, namespacedCRDs)
}

func emptyNamespaceCustomSnapshot(meta ClusterMeta, scope string) *refresh.Snapshot {
	return &refresh.Snapshot{
		Domain: namespaceCustomDomainName,
		Scope:  scope,
		Payload: NamespaceCustomSnapshot{
			ClusterMeta: meta,
			Resources:   []NamespaceCustomSummary{},
			Kinds:       []string{},
		},
		Stats: refresh.SnapshotStats{},
	}
}

func (b *NamespaceCustomBuilder) buildTasks(
	meta ClusterMeta,
	scope NamespaceSnapshotScope,
	crds []*apiextensionsv1.CustomResourceDefinition,
	result *namespaceCustomBuildResult,
) []func(context.Context) error {
	tasks := make([]func(context.Context) error, 0, len(crds))
	for _, crd := range crds {
		crdCopy := crd
		tasks = append(tasks, func(ctx context.Context) error {
			return b.collectCRD(ctx, meta, scope, crdCopy, result)
		})
	}
	return tasks
}

func (b *NamespaceCustomBuilder) collectCRD(
	ctx context.Context,
	meta ClusterMeta,
	scope NamespaceSnapshotScope,
	crd *apiextensionsv1.CustomResourceDefinition,
	result *namespaceCustomBuildResult,
) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	gvr, ok := customResourceGVR(crd)
	if !ok {
		return nil
	}
	items, err := b.listCRD(ctx, gvr, namespaceCustomListTargets(scope, b.scope))
	if err != nil {
		b.recordListError(gvr.String(), err, result)
		return nil
	}
	summaries, version := buildNamespaceCustomSummaries(meta, scope.Namespace, crd, gvr, items)
	result.recordSummaries(summaries, version)
	return nil
}

func namespaceCustomListTargets(scope NamespaceSnapshotScope, allowed []string) []string {
	if !scope.AllNamespaces {
		return []string{scope.Namespace}
	}
	if len(allowed) > 0 {
		return allowed
	}
	return []string{metav1.NamespaceAll}
}

func (b *NamespaceCustomBuilder) listCRD(
	ctx context.Context,
	gvr schema.GroupVersionResource,
	namespaces []string,
) ([]unstructured.Unstructured, error) {
	var items []unstructured.Unstructured
	for _, namespace := range namespaces {
		resourceList, err := b.dynamic.Resource(gvr).Namespace(namespace).List(ctx, metav1.ListOptions{})
		if err != nil && shouldSkipError(err) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if resourceList != nil {
			items = append(items, resourceList.Items...)
		}
	}
	return items, nil
}

func (b *NamespaceCustomBuilder) recordListError(resource string, err error, result *namespaceCustomBuildResult) {
	applog.Warn(b.logger, fmt.Sprintf("namespace-custom: list %s failed: %v", resource, err), logsources.Refresh)
	result.recordListError(resource, err)
}

func buildNamespaceCustomSummaries(
	meta ClusterMeta,
	namespace string,
	crd *apiextensionsv1.CustomResourceDefinition,
	gvr schema.GroupVersionResource,
	items []unstructured.Unstructured,
) ([]NamespaceCustomSummary, uint64) {
	summaries := make([]NamespaceCustomSummary, 0, len(items))
	var version uint64
	for i := range items {
		item := &items[i]
		summaries = append(summaries, customresource.BuildNamespaceStreamSummary(
			meta, item, gvr.Group, gvr.Version, gvr.Resource, crd.Spec.Names.Kind, crd.Name, namespace,
		))
		version = maxSnapshotVersion(version, item)
	}
	return summaries, version
}

type namespaceCustomBuildResult struct {
	mu        sync.Mutex
	summaries []NamespaceCustomSummary
	version   uint64
	warnings  []string
	firstErr  error
}

func (r *namespaceCustomBuildResult) recordListError(resource string, err error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.warnings = append(r.warnings, fmt.Sprintf("Failed to list %s: %v", resource, err))
	if r.firstErr == nil {
		r.firstErr = fmt.Errorf("list %s: %w", resource, err)
	}
}

func (r *namespaceCustomBuildResult) recordSummaries(summaries []NamespaceCustomSummary, version uint64) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.summaries = append(r.summaries, summaries...)
	if version > r.version {
		r.version = version
	}
}

func (r *namespaceCustomBuildResult) snapshot(
	meta ClusterMeta,
	scope string,
	crds []*apiextensionsv1.CustomResourceDefinition,
) (*refresh.Snapshot, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if len(r.summaries) == 0 && r.firstErr != nil {
		return nil, r.firstErr
	}
	sortNamespaceCustomSummaries(r.summaries)
	resources := r.summaries
	if resources == nil {
		resources = []NamespaceCustomSummary{}
	}
	return &refresh.Snapshot{
		Domain:  namespaceCustomDomainName,
		Scope:   scope,
		Version: r.version,
		Payload: NamespaceCustomSnapshot{ClusterMeta: meta, Resources: resources, Kinds: customResourceKinds(crds)},
		Stats: refresh.SnapshotStats{
			ItemCount: len(resources),
			Warnings:  append([]string(nil), r.warnings...),
		},
	}, nil
}

func sortNamespaceCustomSummaries(resources []NamespaceCustomSummary) {
	sort.SliceStable(resources, func(i, j int) bool {
		if resources[i].Ref.Namespace != resources[j].Ref.Namespace {
			return resources[i].Ref.Namespace < resources[j].Ref.Namespace
		}
		if resources[i].Ref.Group != resources[j].Ref.Group {
			return resources[i].Ref.Group < resources[j].Ref.Group
		}
		if resources[i].Ref.Kind != resources[j].Ref.Kind {
			return resources[i].Ref.Kind < resources[j].Ref.Kind
		}
		return resources[i].Ref.Name < resources[j].Ref.Name
	})
}
