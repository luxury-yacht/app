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

	namespacedCRDs := make([]*apiextensionsv1.CustomResourceDefinition, 0, len(crds))
	for i := range crds {
		crd := crds[i]
		if crd != nil && crd.Spec.Scope == "Namespaced" && !IsFirstClassCustomResourceDefinition(crd) {
			namespacedCRDs = append(namespacedCRDs, crd)
		}
	}

	if len(namespacedCRDs) == 0 {
		applog.Info(b.logger, "namespace-custom: no namespaced CRDs discovered", logsources.Refresh)
		return &refresh.Snapshot{
			Domain:  namespaceCustomDomainName,
			Scope:   parsedScope.CanonicalScope,
			Version: 0,
			Payload: NamespaceCustomSnapshot{
				ClusterMeta: meta,
				Resources:   []NamespaceCustomSummary{},
				Kinds:       []string{},
			},
			Stats: refresh.SnapshotStats{ItemCount: 0},
		}, nil
	}

	kinds := make([]string, 0, len(namespacedCRDs))
	for _, crd := range namespacedCRDs {
		if crd == nil {
			continue
		}
		kinds = append(kinds, crd.Spec.Names.Kind)
	}
	kinds = snapshotSortedUniqueStrings(kinds)

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

			listNamespace := parsedScope.Namespace
			if parsedScope.AllNamespaces {
				listNamespace = metav1.NamespaceAll
			}
			resourceList, err := b.dynamic.Resource(gvr).Namespace(listNamespace).List(ctx, metav1.ListOptions{})
			if err != nil {
				if shouldSkipError(err) {
					return nil
				}
				applog.Warn(b.logger, fmt.Sprintf("namespace-custom: list %s failed: %v", gvr.String(), err), logsources.Refresh)
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
				// Delegate to the shared row builder so the full-snapshot
				// path and the streaming/incremental update path emit
				// identical row shapes. See BuildNamespaceCustomSummary in
				// streaming_helpers.go. `namespace` is the scope fallback
				// for items that don't carry their own. `crdCopy.Name` is
				// the canonical CRD name (`<plural>.<group>`) used to
				// open the owning CRD from the row.
				items = append(items, customresource.BuildNamespaceStreamSummary(
					meta,
					item,
					gvr.Group,
					gvr.Version,
					crdCopy.Spec.Names.Kind,
					crdCopy.Name,
					parsedScope.Namespace,
				))
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

	if err := parallel.RunLimited(ctx, config.SnapshotNamespaceCustomWorkerLimit, tasks...); err != nil {
		return nil, err
	}

	if len(summaries) == 0 && firstErr != nil {
		return nil, firstErr
	}

	sortNamespaceCustomSummaries(summaries)

	payload := NamespaceCustomSnapshot{ClusterMeta: meta, Resources: summaries, Kinds: kinds}
	if payload.Resources == nil {
		payload.Resources = []NamespaceCustomSummary{}
	}

	stats := refresh.SnapshotStats{
		ItemCount: len(payload.Resources),
	}
	if len(warnings) > 0 {
		stats.Warnings = append(stats.Warnings, warnings...)
	}

	return &refresh.Snapshot{
		Domain:  namespaceCustomDomainName,
		Scope:   parsedScope.CanonicalScope,
		Version: version,
		Payload: payload,
		Stats:   stats,
	}, nil
}

func sortNamespaceCustomSummaries(resources []NamespaceCustomSummary) {
	sort.SliceStable(resources, func(i, j int) bool {
		if resources[i].Namespace != resources[j].Namespace {
			return resources[i].Namespace < resources[j].Namespace
		}
		if resources[i].Group != resources[j].Group {
			return resources[i].Group < resources[j].Group
		}
		if resources[i].Kind != resources[j].Kind {
			return resources[i].Kind < resources[j].Kind
		}
		return resources[i].Name < resources[j].Name
	})
}
