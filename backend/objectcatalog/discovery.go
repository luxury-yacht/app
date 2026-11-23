package objectcatalog

import (
	"context"
	"errors"
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/resources/common"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/util/sets"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/discovery/cached/memory"
	"k8s.io/client-go/rest"
)

// discoverResources runs under syncMu and reuses discovery only until the
// cache expires, a CRD changes, or a failed read needs another attempt.
func (s *Service) discoverResources(ctx context.Context) (discoveryResult, error) {
	s.ensureDiscovery()
	customAtStart, revision, pending := s.apiResources.customForDiscovery()
	s.refreshDiscoveryCache(pending)
	result, err := discoverFromClient(ctx, s.discoveryClient)
	if err != nil {
		s.markDiscoveryStale()
		// A cancelled run (the cluster is disconnecting) says nothing about the
		// cluster's API; any other failure leaves the inventory out of date.
		if ctx.Err() == nil {
			// Keep the rows but withdraw their coverage before notifying readers
			// that discovery failed.
			s.mu.Lock()
			s.catalogIndex.completeResources = nil
			s.catalogIndex.completeNamespaces = nil
			s.mu.Unlock()
			s.apiResources.failed(err)
		}
		return discoveryResult{}, err
	}
	if result.partialFailure != nil {
		s.markDiscoveryStale()
	}
	s.apiResources.replace(result.apiResources, result.failedGroupVersions, customAtStart, revision)
	return result, nil
}

func (s *Service) refreshDiscoveryCache(pending bool) {
	if s.discoveryInvalidate == nil {
		return
	}
	now := s.now()
	expires := s.discoveryExpiresAt
	if s.discoveryStale.Swap(false) || pending || (!expires.IsZero() && !now.Before(expires)) {
		s.discoveryInvalidate()
	} else if !expires.IsZero() {
		return
	}
	s.discoveryExpiresAt = now.Add(config.ObjectCatalogDiscoveryCacheTTL)
}

// ensureDiscovery builds the per-cluster discovery client once,
// unless one was already set — pre-injected by a test or built by a prior call. Safe to call
// on every discover.
func (s *Service) ensureDiscovery() {
	s.discoveryOnce.Do(func() {
		if s.discoveryClient != nil {
			return
		}
		s.discoveryClient, s.discoveryInvalidate = s.buildDiscoveryClient()
	})
}

// buildDiscoveryClient uses the memory client because it preserves the
// aggregated discovery response's stale group versions.
func (s *Service) buildDiscoveryClient() (discovery.DiscoveryInterface, func()) {
	cfg := s.deps.Common.RestConfig
	if cfg == nil {
		if s.deps.Common.KubernetesClient != nil {
			return s.deps.Common.KubernetesClient.Discovery(), nil
		}
		return nil, nil
	}
	cfgCopy := rest.CopyConfig(cfg)
	cfgCopy.Timeout = config.ObjectCatalogDiscoveryRequestTimeout
	if dc, derr := discovery.NewDiscoveryClientForConfig(cfgCopy); derr == nil {
		cached := memory.NewMemCacheClient(dc)
		return cached, cached.Invalidate
	}
	if s.deps.Common.KubernetesClient != nil {
		return s.deps.Common.KubernetesClient.Discovery(), nil
	}
	return nil, nil
}

// discoverResourceDescriptors discovers via a plain (uncached) client built from deps — the
// path the identity resolver uses, kept for callers that have no Service to hold a cached
// client.
func discoverResourceDescriptors(ctx context.Context, deps common.Dependencies, logger Logger) ([]Descriptor, error) {
	if deps.KubernetesClient == nil {
		return nil, errors.New("discovery client not available")
	}
	discoveryClient := deps.KubernetesClient.Discovery()
	if cfg := deps.RestConfig; cfg != nil {
		cfgCopy := rest.CopyConfig(cfg)
		cfgCopy.Timeout = config.ObjectCatalogDiscoveryRequestTimeout
		if dc, err := discovery.NewDiscoveryClientForConfig(cfgCopy); err == nil {
			discoveryClient = dc
		} else {
			applog.Debug(logger, fmt.Sprintf("catalog discovery client fallback: %v", err), componentName)
		}
	}
	result, err := discoverFromClient(ctx, discoveryClient)
	if err != nil {
		return nil, err
	}
	return result.descriptors, nil
}

// discoveryResult is one discovery pass: the full API surface, and the subset
// of it whose objects the catalog collects.
type discoveryResult struct {
	apiResources []APIResource
	descriptors  []Descriptor
	// failedGroupVersions are the group versions the server could not answer
	// for; apiResources and descriptors cover only the ones it could.
	failedGroupVersions []schema.GroupVersion
	partialFailure      error
}

// discoverFromClient runs one aggregated discovery via discoveryClient and
// derives both the cluster's API resources and the catalog descriptors from it.
func discoverFromClient(ctx context.Context, discoveryClient discovery.DiscoveryInterface) (discoveryResult, error) {
	select {
	case <-ctx.Done():
		return discoveryResult{}, ctx.Err()
	default:
	}
	if discoveryClient == nil {
		return discoveryResult{}, errors.New("discovery client not available")
	}

	// A partial failure identifies the unreachable groups and returns lists for
	// reachable ones. An unscoped error cannot establish which lists to trust.
	groups, resourceLists, err := discoveryClient.ServerGroupsAndResources()
	if _, partial := discovery.GroupDiscoveryFailedErrorGroups(err); err != nil && (!partial || len(resourceLists) == 0) {
		return discoveryResult{}, err
	}

	select {
	case <-ctx.Done():
		return discoveryResult{}, ctx.Err()
	default:
	}

	apiResources := buildAPIResources(groups, resourceLists)
	listsByVersion := resourceListsByVersion(resourceLists)
	err = filterDiscoveryFailures(err, func(gv schema.GroupVersion) bool {
		// The legacy memory cache attaches an error to a successful empty
		// list. Actual failed requests return no list for that version.
		list := listsByVersion[gv]
		return list != nil && len(list.APIResources) == 0
	})
	return discoveryResult{
		apiResources:        apiResources,
		descriptors:         catalogDescriptors(apiResources),
		failedGroupVersions: failedGroupVersions(err),
		partialFailure:      err,
	}, nil
}

func filterDiscoveryFailures(err error, exclude func(schema.GroupVersion) bool) error {
	groups, ok := discovery.GroupDiscoveryFailedErrorGroups(err)
	if !ok {
		return err
	}
	remaining := make(map[schema.GroupVersion]error, len(groups))
	for gv, cause := range groups {
		if !exclude(gv) {
			remaining[gv] = cause
		}
	}
	if len(remaining) == 0 {
		return nil
	}
	return &discovery.ErrGroupDiscoveryFailed{Groups: remaining}
}

// failedGroupVersions names the group versions a partial discovery error says
// it could not read.
func failedGroupVersions(err error) []schema.GroupVersion {
	groups, _ := discovery.GroupDiscoveryFailedErrorGroups(err)
	failed := make([]schema.GroupVersion, 0, len(groups))
	for groupVersion := range groups {
		failed = append(failed, groupVersion)
	}
	return failed
}

// Kinds the catalog never collects objects for.
var (
	catalogExcludedKinds = sets.New[string](
		"Event",
		"ComponentStatus", // Deprecated since Kubernetes v1.19; avoid hitting the legacy endpoint.
	)
	// Metrics API resources don't have UIDs (they're computed on-the-fly, not stored in etcd).
	// Exclude the entire metrics.k8s.io group to avoid pagination issues in the browse view.
	catalogExcludedGroups = sets.New[string](
		"metrics.k8s.io",
	)
)

// catalogDescriptors selects the API resources whose objects the catalog
// collects: listable kinds, at their preferred version, outside the excluded
// kinds and groups.
func catalogDescriptors(apiResources []APIResource) []Descriptor {
	result := make([]Descriptor, 0, len(apiResources))
	for _, apiResource := range apiResources {
		if catalogExcludedGroups.Has(apiResource.Group) || catalogExcludedKinds.Has(apiResource.Kind) {
			continue
		}
		if !containsVerb(apiResource.Verbs, "list") {
			continue
		}
		result = append(result, Descriptor{
			Group:      apiResource.Group,
			Version:    apiResource.Version,
			Resource:   apiResource.Resource,
			Kind:       apiResource.Kind,
			Scope:      resourceScope(apiResource),
			Namespaced: apiResource.Namespaced,
		})
	}
	return result
}
