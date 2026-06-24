package objectcatalog

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/resources/common"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/util/sets"
	"k8s.io/client-go/discovery"
	disk "k8s.io/client-go/discovery/cached/disk"
	"k8s.io/client-go/rest"
)

// discoverResources re-discovers the cluster's resource kinds through the catalog's
// per-cluster discovery client, which is disk-cached + ETag-revalidating in production. The
// cache is invalidated first iff a CRD change marked discovery stale since the last
// discover, so periodic re-discovers stay served from the cache while a newly-created or
// deleted CRD forces a fresh fetch.
func (s *Service) discoverResources(ctx context.Context) ([]resourceDescriptor, error) {
	s.ensureDiscovery()
	if s.discoveryInvalidate != nil && s.discoveryStale.Swap(false) {
		s.discoveryInvalidate()
	}
	return discoverFromClient(ctx, s.discoveryClient)
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
func discoverResourceDescriptors(ctx context.Context, deps common.Dependencies, logger Logger) ([]resourceDescriptor, error) {
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
	return discoverFromClient(ctx, discoveryClient)
}

// discoverFromClient runs aggregated discovery via discoveryClient and extracts the catalog
// descriptors, falling back from ServerPreferredResources to ServerGroupsAndResources when a
// fake/older client returns nothing from the former.
func discoverFromClient(ctx context.Context, discoveryClient discovery.DiscoveryInterface) ([]resourceDescriptor, error) {
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	default:
	}
	if discoveryClient == nil {
		return nil, errors.New("discovery client not available")
	}

	resourceLists, err := discoveryClient.ServerPreferredResources()
	if err != nil && len(resourceLists) == 0 {
		return nil, err
	}
	if len(resourceLists) == 0 {
		if _, lists, altErr := discoveryClient.ServerGroupsAndResources(); altErr == nil && len(lists) > 0 {
			resourceLists = lists
		}
	}

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	default:
	}

	return extractResourceDescriptors(resourceLists), nil
}

func (s *Service) extractDescriptors(resourceLists []*metav1.APIResourceList) []resourceDescriptor {
	return extractResourceDescriptors(resourceLists)
}

func extractResourceDescriptors(resourceLists []*metav1.APIResourceList) []resourceDescriptor {
	exported := ExtractDescriptors(resourceLists)
	result := make([]resourceDescriptor, 0, len(exported))
	for _, desc := range exported {
		r := resourceDescriptor{
			GVR: schema.GroupVersionResource{
				Group:    desc.Group,
				Version:  desc.Version,
				Resource: desc.Resource,
			},
			Namespaced: desc.Namespaced,
			Kind:       desc.Kind,
			Group:      desc.Group,
			Version:    desc.Version,
			Resource:   desc.Resource,
			Scope:      desc.Scope,
		}
		result = append(result, r)
	}
	return result
}

// ExtractDescriptors converts API resource discovery results into catalog descriptors.
func ExtractDescriptors(resourceLists []*metav1.APIResourceList) []Descriptor {
	excludedKinds := sets.NewString(
		"Event",
		"ComponentStatus", // Deprecated since Kubernetes v1.19; avoid hitting the legacy endpoint.
	)
	// Metrics API resources don't have UIDs (they're computed on-the-fly, not stored in etcd).
	// Exclude the entire metrics.k8s.io group to avoid pagination issues in the browse view.
	excludedGroups := sets.NewString(
		"metrics.k8s.io",
	)
	result := make([]Descriptor, 0)

	for _, list := range resourceLists {
		groupVersion, parseErr := schema.ParseGroupVersion(list.GroupVersion)
		if parseErr != nil {
			continue
		}

		// Skip excluded API groups entirely.
		if excludedGroups.Has(groupVersion.Group) {
			continue
		}

		for _, apiResource := range list.APIResources {
			if strings.Contains(apiResource.Name, "/") {
				continue
			}
			if apiResource.Kind == "" || excludedKinds.Has(apiResource.Kind) {
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
				Group:      groupVersion.Group,
				Version:    groupVersion.Version,
				Resource:   apiResource.Name,
				Kind:       apiResource.Kind,
				Scope:      scope,
				Namespaced: apiResource.Namespaced,
			})
		}
	}

	return result
}
