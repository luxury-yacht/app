package snapshot

import (
	"context"
	"fmt"
	"sort"
	"sync"
	"time"

	"golang.org/x/sync/errgroup"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/release"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/labels"
	informers "k8s.io/client-go/informers"
	corelisters "k8s.io/client-go/listers/core/v1"
)

const namespaceHelmDomainName = "namespace-helm"

// HelmActionFactory creates a Helm action configuration scoped to the provided namespace.
type HelmActionFactory func(namespace string) (*action.Configuration, error)

// NamespaceHelmSnapshot payload returned to the frontend.
type NamespaceHelmSnapshot struct {
	ClusterMeta
	Releases []NamespaceHelmSummary `json:"releases"`
}

// NamespaceHelmSummary captures the fields required by the Helm table.
type NamespaceHelmSummary struct {
	ClusterMeta
	Name               string `json:"name"`
	Namespace          string `json:"namespace"`
	Chart              string `json:"chart"`
	AppVersion         string `json:"appVersion"`
	Status             string `json:"status"`
	StatusState        string `json:"statusState,omitempty"`
	StatusPresentation string `json:"statusPresentation,omitempty"`
	StatusReason       string `json:"statusReason,omitempty"`
	Revision           int    `json:"revision"`
	Updated            string `json:"updated"`
	Description        string `json:"description,omitempty"`
	Age                string `json:"age"`
}

// RegisterNamespaceHelmDomain registers the Helm snapshot builder.
func RegisterNamespaceHelmDomain(
	reg *domain.Registry,
	informerFactory informers.SharedInformerFactory,
	helmFactory HelmActionFactory,
) error {
	if informerFactory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	if helmFactory == nil {
		return fmt.Errorf("helm action factory is nil")
	}
	builder := &NamespaceHelmBuilder{
		factory:         helmFactory,
		namespaceLister: informerFactory.Core().V1().Namespaces().Lister(),
	}
	return reg.Register(refresh.DomainConfig{
		Name:          namespaceHelmDomainName,
		BuildSnapshot: builder.Build,
	})
}

// NamespaceHelmBuilder renders Helm releases for a namespace.
type NamespaceHelmBuilder struct {
	factory         HelmActionFactory
	namespaceLister corelisters.NamespaceLister
}

func (b *NamespaceHelmBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	meta := ClusterMetaFromContext(ctx)
	parsedScope, err := parseNamespaceSnapshotScope(scope, "namespace scope is required")
	if err != nil {
		return nil, err
	}

	if parsedScope.AllNamespaces {
		return b.buildAllNamespaces(ctx, parsedScope.CanonicalScope, meta)
	}
	return b.buildSingleNamespace(parsedScope.CanonicalScope, meta, parsedScope.Namespace)
}

func (b *NamespaceHelmBuilder) buildSingleNamespace(snapshotScope string, meta ClusterMeta, namespace string) (*refresh.Snapshot, error) {
	actionCfg, err := b.factory(namespace)
	if err != nil {
		return nil, err
	}

	list := action.NewList(actionCfg)
	list.All = false
	releases, err := list.Run()
	if err != nil {
		return nil, err
	}

	summaries, version := mapHelmReleases(releases, namespace, meta)

	return &refresh.Snapshot{
		Domain:  namespaceHelmDomainName,
		Scope:   snapshotScope,
		Version: version,
		Payload: NamespaceHelmSnapshot{ClusterMeta: meta, Releases: summaries},
		Stats: refresh.SnapshotStats{
			ItemCount: len(summaries),
		},
	}, nil
}

func (b *NamespaceHelmBuilder) buildAllNamespaces(
	ctx context.Context,
	snapshotScope string,
	meta ClusterMeta,
) (*refresh.Snapshot, error) {
	if b.namespaceLister == nil {
		return nil, fmt.Errorf("namespace lister unavailable for helm aggregation")
	}

	namespaceObjs, err := b.namespaceLister.List(labels.Everything())
	if err != nil {
		return nil, err
	}

	namespaces := uniqueNamespaceNames(namespaceObjs)
	if len(namespaces) == 0 {
		return &refresh.Snapshot{
			Domain:  namespaceHelmDomainName,
			Scope:   snapshotScope,
			Version: 0,
			Payload: NamespaceHelmSnapshot{ClusterMeta: meta, Releases: []NamespaceHelmSummary{}},
			Stats: refresh.SnapshotStats{
				ItemCount: 0,
			},
		}, nil
	}

	sem := make(chan struct{}, config.SnapshotNamespaceHelmWorkerLimit)

	var (
		mu        sync.Mutex
		summaries []NamespaceHelmSummary
		version   uint64
	)

	g, gctx := errgroup.WithContext(ctx)
	for _, ns := range namespaces {
		ns := ns
		g.Go(func() error {
			select {
			case sem <- struct{}{}:
			case <-gctx.Done():
				return gctx.Err()
			}
			defer func() { <-sem }()

			actionCfg, err := b.factory(ns)
			if err != nil {
				return fmt.Errorf("helm namespace %s: %w", ns, err)
			}

			list := action.NewList(actionCfg)
			list.All = false
			releases, err := list.Run()
			if err != nil {
				return fmt.Errorf("helm namespace %s: %w", ns, err)
			}

			if len(releases) == 0 {
				list.All = true
				list.AllNamespaces = true
				releases, err = list.Run()
				if err != nil {
					return fmt.Errorf("helm namespace %s: %w", ns, err)
				}
			}

			localSummaries, localVersion := mapHelmReleases(releases, ns, meta)
			if len(localSummaries) == 0 {
				return nil
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

	if err := g.Wait(); err != nil {
		return nil, err
	}

	sort.Slice(summaries, func(i, j int) bool {
		if summaries[i].Namespace == summaries[j].Namespace {
			return summaries[i].Name < summaries[j].Name
		}
		return summaries[i].Namespace < summaries[j].Namespace
	})

	return &refresh.Snapshot{
		Domain:  namespaceHelmDomainName,
		Scope:   snapshotScope,
		Version: version,
		Payload: NamespaceHelmSnapshot{ClusterMeta: meta, Releases: summaries},
		Stats: refresh.SnapshotStats{
			ItemCount: len(summaries),
		},
	}, nil
}

func mapHelmReleases(
	releases []*release.Release,
	namespaceFilter string,
	meta ClusterMeta,
) ([]NamespaceHelmSummary, uint64) {
	summaries := make([]NamespaceHelmSummary, 0, len(releases))
	var version uint64

	for _, release := range releases {
		if release == nil {
			continue
		}
		ns := release.Namespace
		if ns == "" && namespaceFilter != "" {
			ns = namespaceFilter
		}
		if namespaceFilter != "" && ns != namespaceFilter {
			continue
		}
		model := resourcemodel.BuildHelmReleaseResourceModel(
			meta.ClusterID,
			release,
			namespaceFilter,
			nil,
			nil,
			resourcemodel.ResourceModelBuildOptions{Materialization: resourcemodel.MaterializeSummaryFacts},
		)
		facts := model.Facts.HelmRelease
		chartName := facts.Chart
		appVersion := facts.AppVersion
		status := model.Status.Label
		updated := ""
		description := ""
		age := ""
		if facts.Updated != nil && !facts.Updated.IsZero() {
			updated = facts.Updated.Time.Format(time.RFC3339)
		}
		description = facts.Description
		if !model.Metadata.CreationTimestamp.IsZero() {
			age = formatAge(model.Metadata.CreationTimestamp.Time)
		}
		summaries = append(summaries, NamespaceHelmSummary{
			ClusterMeta:        meta,
			Name:               release.Name,
			Namespace:          ns,
			Chart:              chartName,
			AppVersion:         appVersion,
			Status:             status,
			StatusState:        model.Status.State,
			StatusPresentation: model.Status.Presentation,
			StatusReason:       model.Status.Reason,
			Revision:           release.Version,
			Updated:            updated,
			Description:        description,
			Age:                age,
		})
		if v := uint64(release.Version); v > version {
			version = v
		}
	}

	return summaries, version
}

func uniqueNamespaceNames(namespaces []*corev1.Namespace) []string {
	set := make(map[string]struct{}, len(namespaces))
	for _, ns := range namespaces {
		if ns == nil || ns.Name == "" {
			continue
		}
		set[ns.Name] = struct{}{}
	}
	result := make([]string, 0, len(set))
	for name := range set {
		result = append(result, name)
	}
	sort.Strings(result)
	return result
}
