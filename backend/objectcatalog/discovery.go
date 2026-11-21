package objectcatalog

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/resources/common"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/util/sets"
	"k8s.io/client-go/discovery"
	disk "k8s.io/client-go/discovery/cached/disk"
	"k8s.io/client-go/rest"
)

// discoverResources re-discovers the cluster's resource kinds through the catalog's
// per-cluster discovery client, which is disk-cached + ETag-revalidating in production. The
// cache is invalidated when a CRD change marks discovery stale or a published
// custom row awaits fresh discovery after its definition disappears.
func (s *Service) discoverResources(ctx context.Context) ([]Descriptor, error) {
	s.ensureDiscovery()
	customAtStart, pendingRemoval := s.apiResources.customForDiscovery()
	if s.discoveryInvalidate != nil && (s.discoveryStale.Swap(false) || pendingRemoval) {
		s.discoveryInvalidate()
	}
	result, err := discoverFromClient(ctx, s.discoveryClient)
	if err != nil {
		// A cancelled run (the cluster is disconnecting) says nothing about the
		// cluster's API; any other failure leaves the inventory out of date.
		if ctx.Err() == nil {
			s.apiResources.failed(err)
		}
		return nil, err
	}
	s.apiResources.replace(result.apiResources, result.failedGroupVersions, customAtStart)
	return result.descriptors, nil
}

// ensureDiscovery builds the per-cluster discovery client once (disk-cached when possible),
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

// buildDiscoveryClient returns a disk-cached, ETag-revalidating, aggregated-discovery client
// (with its Invalidate hook) when a REST config and a writable cache dir are available, and
// falls back to a plain discovery client (no caching, nil invalidate) otherwise — so an
// unavailable or read-only cache never loses discovery.
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
	if groupsDir, httpDir, err := s.discoveryCacheDirs(); err == nil {
		if cached, cerr := disk.NewCachedDiscoveryClientForConfig(cfgCopy, groupsDir, httpDir, config.ObjectCatalogDiscoveryCacheTTL); cerr == nil {
			return cached, cached.Invalidate
		} else {
			applog.Debug(s.deps.Logger, fmt.Sprintf("catalog cached discovery unavailable, using plain client: %v", cerr), componentName)
		}
	}
	if dc, derr := discovery.NewDiscoveryClientForConfig(cfgCopy); derr == nil {
		return dc, nil
	}
	if s.deps.Common.KubernetesClient != nil {
		return s.deps.Common.KubernetesClient.Discovery(), nil
	}
	return nil, nil
}

// discoveryCacheDirs returns the per-cluster on-disk discovery-cache directories (the group/
// resource documents and the HTTP-response/ETag cache), under the user cache dir and keyed by
// a hash of the clusterID so an arbitrary identifier is filesystem-safe.
func (s *Service) discoveryCacheDirs() (groupsDir, httpDir string, err error) {
	cacheDir, err := os.UserCacheDir()
	if err != nil {
		return "", "", err
	}
	base := filepath.Join(cacheDir, "luxury-yacht", "discovery", hashClusterIDForDiscovery(s.clusterID))
	return filepath.Join(base, "groups"), filepath.Join(base, "http"), nil
}

func hashClusterIDForDiscovery(id string) string {
	sum := sha256.Sum256([]byte(id))
	return hex.EncodeToString(sum[:8])
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
