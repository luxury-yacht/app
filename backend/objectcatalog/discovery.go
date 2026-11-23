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
func (s *Service) discoverResources(ctx context.Context) ([]Descriptor, error) {
	s.ensureDiscovery()
	customAtStart, pendingRemoval := s.apiResources.customForDiscovery()
	s.refreshDiscoveryCache(pendingRemoval)
	result, err := discoverFromClient(ctx, s.discoveryClient)
	if err != nil {
		s.markDiscoveryStale()
		// A cancelled run (the cluster is disconnecting) says nothing about the
		// cluster's API; any other failure leaves the inventory out of date.
		if ctx.Err() == nil {
			s.apiResources.failed(err)
		}
		return nil, err
	}
	if len(result.failedGroupVersions) != 0 {
		s.markDiscoveryStale()
	}
	s.apiResources.replace(result.apiResources, result.failedGroupVersions, customAtStart)
	return result.descriptors, nil
}

func (s *Service) refreshDiscoveryCache(pendingRemoval bool) {
	if s.discoveryInvalidate == nil {
		return
	}
	now := s.now()
	expires := s.discoveryExpiresAt
	if s.discoveryStale.Swap(false) || pendingRemoval || (!expires.IsZero() && !now.Before(expires)) {
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

	// A partial failure (some groups unreachable) still returns the reachable
	// groups' lists alongside the error; only a discovery with no lists fails.
	groups, resourceLists, err := discoveryClient.ServerGroupsAndResources()
	if err != nil && len(resourceLists) == 0 {
		return discoveryResult{}, err
	}

	select {
	case <-ctx.Done():
		return discoveryResult{}, ctx.Err()
	default:
	}

	apiResources := buildAPIResources(groups, resourceLists)
	return discoveryResult{
		apiResources:        apiResources,
		descriptors:         catalogDescriptors(apiResources),
		failedGroupVersions: failedGroupVersions(err),
	}, nil
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
		scope := ScopeCluster
		if apiResource.Namespaced {
			scope = ScopeNamespace
		}
		result = append(result, Descriptor{
			Group:      apiResource.Group,
			Version:    apiResource.Version,
			Resource:   apiResource.Resource,
			Kind:       apiResource.Kind,
			Scope:      scope,
			Namespaced: apiResource.Namespaced,
		})
	}
	return result
}
