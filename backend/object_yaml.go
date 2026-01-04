package backend

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/luxury-yacht/app/backend/internal/cachekeys"
	"github.com/luxury-yacht/app/backend/resources/common"
	discoveryv1 "k8s.io/api/discovery/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/rest"
	"sigs.k8s.io/yaml"
)

// Cache for discovered GVRs (Group Version Resource) to avoid repeated discovery calls
type gvrCacheEntry struct {
	gvr        schema.GroupVersionResource
	namespaced bool
	cachedAt   time.Time
}

var (
	gvrCache = make(map[string]gvrCacheEntry)
	// gvrCacheOrder tracks per-selection insertion order so eviction stays deterministic.
	gvrCacheOrder = make(map[string][]string)
	gvrCacheMutex sync.RWMutex
	gvrCacheLimit = 256
)

const (
	discoveryTimeout = 10 * time.Second
	gvrCacheTTL      = 10 * time.Minute
)

func gvrCacheKey(selection, resourceKind string) string {
	kind := strings.ToLower(strings.TrimSpace(resourceKind))
	if selection == "" {
		return kind
	}
	return selection + "|" + kind
}

func clearGVRCache() {
	gvrCacheMutex.Lock()
	defer gvrCacheMutex.Unlock()
	gvrCache = make(map[string]gvrCacheEntry)
	gvrCacheOrder = make(map[string][]string)
}

func isGVRCacheExpired(entry gvrCacheEntry) bool {
	if gvrCacheTTL <= 0 {
		return false
	}
	if entry.cachedAt.IsZero() {
		return true
	}
	return time.Since(entry.cachedAt) > gvrCacheTTL
}

func removeGVRCacheEntryLocked(key string) {
	delete(gvrCache, key)
	selection := selectionFromCacheKey(key)
	order := gvrCacheOrder[selection]
	for idx, existing := range order {
		if existing == key {
			order = append(order[:idx], order[idx+1:]...)
			break
		}
	}
	if len(order) == 0 {
		delete(gvrCacheOrder, selection)
		return
	}
	gvrCacheOrder[selection] = order
}

func loadGVRCached(key string) (gvrCacheEntry, bool) {
	gvrCacheMutex.RLock()
	entry, found := gvrCache[key]
	gvrCacheMutex.RUnlock()
	if !found {
		return gvrCacheEntry{}, false
	}
	if !isGVRCacheExpired(entry) {
		return entry, true
	}
	gvrCacheMutex.Lock()
	entry, found = gvrCache[key]
	if found && isGVRCacheExpired(entry) {
		removeGVRCacheEntryLocked(key)
	}
	gvrCacheMutex.Unlock()
	return gvrCacheEntry{}, false
}

func selectionFromCacheKey(key string) string {
	if key == "" {
		return ""
	}
	parts := strings.SplitN(key, "|", 2)
	if len(parts) == 2 {
		return parts[0]
	}
	return ""
}

func storeGVRCached(key string, entry gvrCacheEntry) {
	selection := selectionFromCacheKey(key)

	gvrCacheMutex.Lock()
	defer gvrCacheMutex.Unlock()

	order := gvrCacheOrder[selection]
	for idx, existing := range order {
		if existing == key {
			// move to end for deterministic eviction order
			order = append(order[:idx], order[idx+1:]...)
			break
		}
	}
	order = append(order, key)
	entry.cachedAt = time.Now()
	gvrCache[key] = entry
	gvrCacheOrder[selection] = order

	if gvrCacheLimit > 0 && len(order) > gvrCacheLimit {
		excess := len(order) - gvrCacheLimit
		for i := 0; i < excess; i++ {
			evictKey := order[i]
			removeGVRCacheEntryLocked(evictKey)
		}
		gvrCacheOrder[selection] = order[excess:]
	}
}

// GetObjectYAML fetches the YAML representation of a Kubernetes object.
func (a *App) GetObjectYAML(clusterID, resourceKind, namespace, name string) (string, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return "", err
	}
	return a.getObjectYAMLWithCache(deps, selectionKey, resourceKind, namespace, name)
}

func objectYAMLCacheKey(resourceKind, namespace, name string) string {
	return cachekeys.Build("object-yaml-"+strings.ToLower(strings.TrimSpace(resourceKind)), namespace, name)
}

// getObjectYAMLWithCache wraps object YAML retrieval with a short-lived response cache.
func (a *App) getObjectYAMLWithCache(
	deps common.Dependencies,
	selectionKey string,
	resourceKind, namespace, name string,
) (string, error) {
	if a != nil {
		cacheKey := objectYAMLCacheKey(resourceKind, namespace, name)
		if cached, ok := a.responseCacheLookup(selectionKey, cacheKey); ok {
			if yamlText, ok := cached.(string); ok {
				// Avoid serving cached YAML when permission checks deny access.
				if a.canServeCachedResponse(deps.Context, deps, selectionKey, resourceKind, namespace, name) {
					return yamlText, nil
				}
			}
			a.responseCacheDelete(selectionKey, cacheKey)
		}
	}

	yamlText, err := getObjectYAMLWithDependencies(deps, selectionKey, resourceKind, namespace, name)
	if err != nil {
		return "", err
	}

	if a != nil {
		a.responseCacheStore(selectionKey, objectYAMLCacheKey(resourceKind, namespace, name), yamlText)
	}
	return yamlText, nil
}

// getObjectYAMLWithDependencies fetches object YAML using the supplied cluster-scoped dependencies.
func getObjectYAMLWithDependencies(
	deps common.Dependencies,
	selectionKey string,
	resourceKind, namespace, name string,
) (string, error) {
	logger := deps.Logger
	if logger != nil {
		logger.Debug(
			fmt.Sprintf("GetObjectYAML called with: type='%s', namespace='%s', name='%s'", resourceKind, namespace, name),
			"ObjectYAML",
		)
	}

	if deps.KubernetesClient == nil {
		return "", fmt.Errorf("kubernetes client not initialized")
	}

	if strings.EqualFold(resourceKind, "endpointslice") || strings.EqualFold(resourceKind, "endpointslices") {
		sliceList, err := listEndpointSlicesForServiceWithDependencies(deps, namespace, name)
		if err != nil {
			return "", fmt.Errorf("failed to list endpoint slices: %w", err)
		}
		yamlBytes, err := yaml.Marshal(sliceList)
		if err != nil {
			return "", fmt.Errorf("failed to convert to YAML: %v", err)
		}
		return string(yamlBytes), nil
	}

	dynamicClient := deps.DynamicClient
	if dynamicClient == nil {
		return "", fmt.Errorf("dynamic client not initialized")
	}

	// Use discovery to get GVR for the resource type.
	gvr, isNamespaced, err := getGVRForDependencies(deps, selectionKey, resourceKind)
	if err != nil {
		return "", fmt.Errorf("failed to discover resource type %s: %v", resourceKind, err)
	}

	baseCtx := deps.Context
	if baseCtx == nil {
		baseCtx = context.Background()
	}

	var obj interface{}
	fetchCtx, fetchCancel := context.WithTimeout(baseCtx, discoveryTimeout)
	defer fetchCancel()

	// Handle both namespaced and cluster-scoped resources.
	if isNamespaced && namespace != "" {
		if logger != nil {
			logger.Debug(fmt.Sprintf("Fetching namespaced resource: %s/%s", namespace, name), "ObjectYAML")
		}
		obj, err = dynamicClient.Resource(gvr).Namespace(namespace).Get(fetchCtx, name, metav1.GetOptions{})
	} else {
		if logger != nil {
			logger.Debug(fmt.Sprintf("Fetching cluster-scoped resource: %s", name), "ObjectYAML")
		}
		obj, err = dynamicClient.Resource(gvr).Get(fetchCtx, name, metav1.GetOptions{})
	}

	if err != nil {
		return "", fmt.Errorf("failed to get %s %s: %v", resourceKind, name, err)
	}

	// Convert to YAML.
	yamlBytes, err := yaml.Marshal(obj)
	if err != nil {
		return "", fmt.Errorf("failed to convert to YAML: %v", err)
	}

	return string(yamlBytes), nil
}

func (a *App) listEndpointSlicesForService(namespace, name string) (*discoveryv1.EndpointSliceList, error) {
	if a.client == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}
	ctx := a.Ctx
	if ctx == nil {
		ctx = context.Background()
	}

	selector := labels.Set{discoveryv1.LabelServiceName: name}.AsSelector().String()
	list, err := a.client.DiscoveryV1().EndpointSlices(namespace).List(ctx, metav1.ListOptions{LabelSelector: selector})
	if err != nil {
		return nil, err
	}
	if list == nil {
		return &discoveryv1.EndpointSliceList{
			TypeMeta: metav1.TypeMeta{
				Kind:       "EndpointSliceList",
				APIVersion: discoveryv1.SchemeGroupVersion.String(),
			},
			Items: []discoveryv1.EndpointSlice{},
		}, nil
	}
	list.TypeMeta = metav1.TypeMeta{
		Kind:       "EndpointSliceList",
		APIVersion: discoveryv1.SchemeGroupVersion.String(),
	}
	return list, nil
}

// listEndpointSlicesForServiceWithDependencies loads endpoint slices with explicit dependencies.
func listEndpointSlicesForServiceWithDependencies(
	deps common.Dependencies,
	namespace, name string,
) (*discoveryv1.EndpointSliceList, error) {
	if deps.KubernetesClient == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	ctx := deps.Context
	if ctx == nil {
		ctx = context.Background()
	}

	selector := labels.Set{discoveryv1.LabelServiceName: name}.AsSelector().String()
	list, err := deps.KubernetesClient.DiscoveryV1().EndpointSlices(namespace).List(ctx, metav1.ListOptions{LabelSelector: selector})
	if err != nil {
		return nil, err
	}
	if list == nil {
		return &discoveryv1.EndpointSliceList{
			TypeMeta: metav1.TypeMeta{
				Kind:       "EndpointSliceList",
				APIVersion: discoveryv1.SchemeGroupVersion.String(),
			},
			Items: []discoveryv1.EndpointSlice{},
		}, nil
	}
	list.TypeMeta = metav1.TypeMeta{
		Kind:       "EndpointSliceList",
		APIVersion: discoveryv1.SchemeGroupVersion.String(),
	}
	return list, nil
}

// getGVR finds the GVR for any resource type using discovery
// Returns the GVR and whether the resource is namespaced
func (a *App) getGVR(resourceKind string) (schema.GroupVersionResource, bool, error) {
	return getGVRForDependencies(a.resourceDependencies(), a.currentSelectionKey(), resourceKind)
}

// getGVRForDependencies discovers the GVR for a kind using the provided dependencies and cache key.
func getGVRForDependencies(
	deps common.Dependencies,
	selectionKey, resourceKind string,
) (schema.GroupVersionResource, bool, error) {
	cacheKey := gvrCacheKey(selectionKey, resourceKind)
	legacyKey := strings.TrimSpace(resourceKind)

	// Check cache first (scoped key) with legacy fallbacks for compatibility.
	if cached, found := loadGVRCached(cacheKey); found {
		return cached.gvr, cached.namespaced, nil
	}
	if legacyKey != "" {
		if cached, found := loadGVRCached(legacyKey); found {
			return cached.gvr, cached.namespaced, nil
		}
		legacyLower := strings.ToLower(legacyKey)
		if cached, found := loadGVRCached(legacyLower); found {
			return cached.gvr, cached.namespaced, nil
		}
	}

	baseCtx := deps.Context
	if baseCtx == nil {
		baseCtx = context.Background()
	}
	ctx, cancel := context.WithTimeout(baseCtx, discoveryTimeout)
	defer cancel()

	// Use the discovery client to find all available resources.
	var discoveryClient discovery.DiscoveryInterface
	if deps.KubernetesClient != nil {
		discoveryClient = deps.KubernetesClient.Discovery()
	}
	if deps.RestConfig != nil {
		cfg := rest.CopyConfig(deps.RestConfig)
		cfg.Timeout = discoveryTimeout
		if dc, err := discovery.NewDiscoveryClientForConfig(cfg); err == nil {
			discoveryClient = dc
		}
	}
	if discoveryClient == nil {
		return schema.GroupVersionResource{}, false, fmt.Errorf("kubernetes client not initialized")
	}

	// Get all API resources with a bounded context to avoid hanging on slow clusters.
	apiResourceLists, err := discoveryClient.ServerPreferredResources()
	if err != nil {
		// Even if there's an error, we might have partial results.
	}

	logger := deps.Logger

	// Search through all API resources for a matching Kind.
	for _, apiResourceList := range apiResourceLists {
		// Parse the group version from the list.
		gv, err := schema.ParseGroupVersion(apiResourceList.GroupVersion)
		if err != nil {
			continue
		}

		for _, apiResource := range apiResourceList.APIResources {
			if strings.Contains(apiResource.Name, "/") {
				continue
			}

			if strings.EqualFold(apiResource.Kind, resourceKind) {
				if logger != nil {
					logger.Debug(
						fmt.Sprintf("Found match by Kind: %s -> %s, namespaced=%v", resourceKind, apiResource.Kind, apiResource.Namespaced),
						"ObjectYAML",
					)
				}
				gvr := schema.GroupVersionResource{
					Group:    gv.Group,
					Version:  gv.Version,
					Resource: apiResource.Name,
				}
				storeGVRCached(cacheKey, gvrCacheEntry{gvr: gvr, namespaced: apiResource.Namespaced})
				return gvr, apiResource.Namespaced, nil
			}

			if strings.EqualFold(apiResource.SingularName, resourceKind) {
				if logger != nil {
					logger.Debug(
						fmt.Sprintf("Found match by singular name: %s -> %s, namespaced=%v", resourceKind, apiResource.SingularName, apiResource.Namespaced),
						"ObjectYAML",
					)
				}
				gvr := schema.GroupVersionResource{
					Group:    gv.Group,
					Version:  gv.Version,
					Resource: apiResource.Name,
				}
				storeGVRCached(cacheKey, gvrCacheEntry{gvr: gvr, namespaced: apiResource.Namespaced})
				return gvr, apiResource.Namespaced, nil
			}

			if strings.EqualFold(apiResource.Name, resourceKind) {
				if logger != nil {
					logger.Debug(
						fmt.Sprintf("Found match by resource name: %s -> %s, namespaced=%v", resourceKind, apiResource.Name, apiResource.Namespaced),
						"ObjectYAML",
					)
				}
				gvr := schema.GroupVersionResource{
					Group:    gv.Group,
					Version:  gv.Version,
					Resource: apiResource.Name,
				}
				storeGVRCached(cacheKey, gvrCacheEntry{gvr: gvr, namespaced: apiResource.Namespaced})
				return gvr, apiResource.Namespaced, nil
			}
		}
	}

	if deps.APIExtensionsClient != nil {
		crds, err := deps.APIExtensionsClient.ApiextensionsV1().CustomResourceDefinitions().List(ctx, metav1.ListOptions{})
		if err == nil {
			for _, crd := range crds.Items {
				if strings.EqualFold(crd.Spec.Names.Kind, resourceKind) {
					isNamespaced := crd.Spec.Scope == "Namespaced"
					if logger != nil {
						logger.Debug(
							fmt.Sprintf("Found CRD match: %s -> %s, namespaced=%v", resourceKind, crd.Spec.Names.Kind, isNamespaced),
							"ObjectYAML",
						)
					}
					var version string
					for _, v := range crd.Spec.Versions {
						if v.Served && v.Storage {
							version = v.Name
							break
						}
					}
					if version == "" && len(crd.Spec.Versions) > 0 {
						version = crd.Spec.Versions[0].Name
					}

					gvr := schema.GroupVersionResource{
						Group:    crd.Spec.Group,
						Version:  version,
						Resource: crd.Spec.Names.Plural,
					}
					storeGVRCached(cacheKey, gvrCacheEntry{gvr: gvr, namespaced: isNamespaced})
					return gvr, isNamespaced, nil
				}
			}
		}
	}

	if logger != nil {
		logger.Error(fmt.Sprintf("Resource type %s not found in discovery or CRDs", resourceKind), "ObjectYAML")
	}
	return schema.GroupVersionResource{}, false, fmt.Errorf("resource type %s not found", resourceKind)
}
