package snapshot

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/errgroup"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/release"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
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
	Name        string `json:"name"`
	Namespace   string `json:"namespace"`
	Chart       string `json:"chart"`
	AppVersion  string `json:"appVersion"`
	Status      string `json:"status"`
	Revision    int    `json:"revision"`
	Updated     string `json:"updated"`
	Description string `json:"description,omitempty"`
	Notes       string `json:"notes,omitempty"`
	Age         string `json:"age"`
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
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	trimmed = strings.TrimSpace(trimmed)
	if trimmed == "" {
		return nil, fmt.Errorf("namespace scope is required")
	}

	isAll := isAllNamespaceScope(trimmed)
	if isAll {
		return b.buildAllNamespaces(ctx, clusterID, meta)
	}

	namespace := normalizeNamespaceScope(trimmed)
	if namespace == "" {
		return nil, fmt.Errorf("namespace scope is required")
	}
	return b.buildSingleNamespace(clusterID, meta, namespace)
}

func (b *NamespaceHelmBuilder) buildSingleNamespace(clusterID string, meta ClusterMeta, namespace string) (*refresh.Snapshot, error) {
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
		Scope:   refresh.JoinClusterScope(clusterID, namespace),
		Version: version,
		Payload: NamespaceHelmSnapshot{ClusterMeta: meta, Releases: summaries},
		Stats: refresh.SnapshotStats{
			ItemCount: len(summaries),
		},
	}, nil
}

func (b *NamespaceHelmBuilder) buildAllNamespaces(
	ctx context.Context,
	clusterID string,
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
			Scope:   refresh.JoinClusterScope(clusterID, "namespace:all"),
			Version: 0,
			Payload: NamespaceHelmSnapshot{ClusterMeta: meta, Releases: []NamespaceHelmSummary{}},
			Stats: refresh.SnapshotStats{
				ItemCount: 0,
			},
		}, nil
	}

	const parallelism = 8
	sem := make(chan struct{}, parallelism)

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
		Scope:   refresh.JoinClusterScope(clusterID, "namespace:all"),
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
		chartName := ""
		appVersion := ""
		if chart := release.Chart; chart != nil {
			chartName = fmt.Sprintf("%s-%s", chart.Name(), chart.Metadata.Version)
			appVersion = chart.Metadata.AppVersion
		}
		status := "unknown"
		updated := ""
		description := ""
		notes := ""
		age := ""
		if info := release.Info; info != nil {
			if info.Status.String() != "" {
				status = info.Status.String()
			}
			if !info.LastDeployed.IsZero() {
				updated = info.LastDeployed.Time.Format(time.RFC3339)
			}
			description = info.Description
			notes = info.Notes
			if !info.FirstDeployed.IsZero() {
				age = formatAge(info.FirstDeployed.Time)
			}
		}
		summaries = append(summaries, NamespaceHelmSummary{
			ClusterMeta: meta,
			Name:        release.Name,
			Namespace:   ns,
			Chart:       chartName,
			AppVersion:  appVersion,
			Status:      status,
			Revision:    release.Version,
			Updated:     updated,
			Description: description,
			Notes:       notes,
			Age:         age,
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
