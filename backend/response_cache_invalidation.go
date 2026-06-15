package backend

import (
	"context"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	apiextensionsinformers "k8s.io/apiextensions-apiserver/pkg/client/informers/externalversions"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"
	gatewayinformers "sigs.k8s.io/gateway-api/pkg/client/informers/externalversions"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh/permissions"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/luxury-yacht/app/backend/resourcemodel"
)

const (
	helmReleaseSecretType = "helm.sh/release.v1"
	helmReleaseOwnerLabel = "owner"
	helmReleaseOwnerValue = "helm"
)

var responseCacheInvalidationSkipKinds = map[string]struct{}{
	// Skip high-churn kinds where short cache TTL already bounds staleness.
	"pod": {},
}

type responseCacheInvalidationEvent int

const (
	responseCacheInvalidationAdd responseCacheInvalidationEvent = iota
	responseCacheInvalidationUpdate
	responseCacheInvalidationDelete
)

// responseCacheInvalidationGuard provides sync/clock hooks for warm-up filtering.
type responseCacheInvalidationGuard struct {
	hasSynced func() bool
	now       func() time.Time
}

// registerResponseCacheInvalidation wires informer-driven cache eviction for cached detail/YAML/helm responses.
func (a *App) registerResponseCacheInvalidation(subsystem *system.Subsystem, selectionKey string) {
	if a == nil || a.responseCache == nil || subsystem == nil || subsystem.InformerFactory == nil {
		return
	}
	shared := subsystem.InformerFactory.SharedInformerFactory()
	if shared == nil {
		return
	}

	guard := responseCacheInvalidationGuard{
		hasSynced: func() bool {
			return subsystem.InformerFactory.HasSynced(context.Background())
		},
		now: time.Now,
	}

	// Use the informer factory as a permission checker to avoid triggering lazy informer
	// creation for cluster-scoped resources the user cannot list/watch.
	var perms permissions.ListWatchChecker = subsystem.InformerFactory

	a.registerSharedCacheInvalidation(shared, selectionKey, guard, perms)
	a.registerGatewayAPIInvalidation(subsystem.InformerFactory.GatewayInformerFactory(), selectionKey, guard, perms)
	a.registerAPIExtensionsInvalidation(subsystem.InformerFactory.APIExtensionsInformerFactory(), selectionKey, guard, perms)
	if subsystem.ResourceStream != nil {
		// Use custom resource stream updates to evict cached YAML for dynamic resources.
		subsystem.ResourceStream.SetCustomResourceCacheInvalidator(func(kind, namespace, name string) {
			if kind == "" || name == "" {
				return
			}
			a.invalidateResponseCacheForResource(selectionKey, kind, namespace, name)
		})
	}
}

// cacheInvalidationDescriptor declares one built-in kind whose informer drives
// response-cache eviction via the core shared informer factory.
type cacheInvalidationDescriptor struct {
	group    string
	resource string
	kind     string
	informer func(informers.SharedInformerFactory) cache.SharedIndexInformer
}

// gatewayCacheInvalidationDescriptor is the Gateway API equivalent (different factory type).
type gatewayCacheInvalidationDescriptor struct {
	group    string
	resource string
	kind     string
	informer func(gatewayinformers.SharedInformerFactory) cache.SharedIndexInformer
}

var sharedCacheInvalidationDescriptors = []cacheInvalidationDescriptor{
	{"", "pods", "Pod", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Core().V1().Pods().Informer()
	}},
	{"", "configmaps", "ConfigMap", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Core().V1().ConfigMaps().Informer()
	}},
	{"", "secrets", "Secret", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Core().V1().Secrets().Informer()
	}},
	{"", "services", "Service", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Core().V1().Services().Informer()
	}},
	{"", "persistentvolumeclaims", "PersistentVolumeClaim", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Core().V1().PersistentVolumeClaims().Informer()
	}},
	{"", "resourcequotas", "ResourceQuota", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Core().V1().ResourceQuotas().Informer()
	}},
	{"", "limitranges", "LimitRange", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Core().V1().LimitRanges().Informer()
	}},
	{"", "serviceaccounts", "ServiceAccount", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Core().V1().ServiceAccounts().Informer()
	}},
	{"", "namespaces", "Namespace", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Core().V1().Namespaces().Informer()
	}},
	{"", "nodes", "Node", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Core().V1().Nodes().Informer()
	}},
	{"", "persistentvolumes", "PersistentVolume", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Core().V1().PersistentVolumes().Informer()
	}},
	{"apps", "replicasets", "ReplicaSet", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Apps().V1().ReplicaSets().Informer()
	}},
	{"apps", "deployments", "Deployment", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Apps().V1().Deployments().Informer()
	}},
	{"apps", "statefulsets", "StatefulSet", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Apps().V1().StatefulSets().Informer()
	}},
	{"apps", "daemonsets", "DaemonSet", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Apps().V1().DaemonSets().Informer()
	}},
	{"batch", "jobs", "Job", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Batch().V1().Jobs().Informer()
	}},
	{"batch", "cronjobs", "CronJob", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Batch().V1().CronJobs().Informer()
	}},
	{"rbac.authorization.k8s.io", "roles", "Role", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Rbac().V1().Roles().Informer()
	}},
	{"rbac.authorization.k8s.io", "rolebindings", "RoleBinding", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Rbac().V1().RoleBindings().Informer()
	}},
	{"rbac.authorization.k8s.io", "clusterroles", "ClusterRole", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Rbac().V1().ClusterRoles().Informer()
	}},
	{"rbac.authorization.k8s.io", "clusterrolebindings", "ClusterRoleBinding", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Rbac().V1().ClusterRoleBindings().Informer()
	}},
	{"storage.k8s.io", "storageclasses", "StorageClass", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Storage().V1().StorageClasses().Informer()
	}},
	{"networking.k8s.io", "ingresses", "Ingress", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Networking().V1().Ingresses().Informer()
	}},
	{"networking.k8s.io", "networkpolicies", "NetworkPolicy", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Networking().V1().NetworkPolicies().Informer()
	}},
	{"discovery.k8s.io", "endpointslices", "EndpointSlice", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Discovery().V1().EndpointSlices().Informer()
	}},
	{"networking.k8s.io", "ingressclasses", "IngressClass", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Networking().V1().IngressClasses().Informer()
	}},
	{"autoscaling", "horizontalpodautoscalers", "HorizontalPodAutoscaler", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Autoscaling().V1().HorizontalPodAutoscalers().Informer()
	}},
	{"policy", "poddisruptionbudgets", "PodDisruptionBudget", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Policy().V1().PodDisruptionBudgets().Informer()
	}},
	{"admissionregistration.k8s.io", "mutatingwebhookconfigurations", "MutatingWebhookConfiguration", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Admissionregistration().V1().MutatingWebhookConfigurations().Informer()
	}},
	{"admissionregistration.k8s.io", "validatingwebhookconfigurations", "ValidatingWebhookConfiguration", func(s informers.SharedInformerFactory) cache.SharedIndexInformer {
		return s.Admissionregistration().V1().ValidatingWebhookConfigurations().Informer()
	}},
}

var gatewayCacheInvalidationDescriptors = []gatewayCacheInvalidationDescriptor{
	{"gateway.networking.k8s.io", "gatewayclasses", "GatewayClass", func(f gatewayinformers.SharedInformerFactory) cache.SharedIndexInformer {
		return f.Gateway().V1().GatewayClasses().Informer()
	}},
	{"gateway.networking.k8s.io", "gateways", "Gateway", func(f gatewayinformers.SharedInformerFactory) cache.SharedIndexInformer {
		return f.Gateway().V1().Gateways().Informer()
	}},
	{"gateway.networking.k8s.io", "httproutes", "HTTPRoute", func(f gatewayinformers.SharedInformerFactory) cache.SharedIndexInformer {
		return f.Gateway().V1().HTTPRoutes().Informer()
	}},
	{"gateway.networking.k8s.io", "grpcroutes", "GRPCRoute", func(f gatewayinformers.SharedInformerFactory) cache.SharedIndexInformer {
		return f.Gateway().V1().GRPCRoutes().Informer()
	}},
	{"gateway.networking.k8s.io", "tlsroutes", "TLSRoute", func(f gatewayinformers.SharedInformerFactory) cache.SharedIndexInformer {
		return f.Gateway().V1().TLSRoutes().Informer()
	}},
	{"gateway.networking.k8s.io", "listenersets", "ListenerSet", func(f gatewayinformers.SharedInformerFactory) cache.SharedIndexInformer {
		return f.Gateway().V1().ListenerSets().Informer()
	}},
	{"gateway.networking.k8s.io", "referencegrants", "ReferenceGrant", func(f gatewayinformers.SharedInformerFactory) cache.SharedIndexInformer {
		return f.Gateway().V1().ReferenceGrants().Informer()
	}},
	{"gateway.networking.k8s.io", "backendtlspolicies", "BackendTLSPolicy", func(f gatewayinformers.SharedInformerFactory) cache.SharedIndexInformer {
		return f.Gateway().V1().BackendTLSPolicies().Informer()
	}},
}

// registerSharedCacheInvalidation installs cache-eviction handlers for every
// built-in kind served by the shared informer factory. Cluster-scoped informers
// are gated on list/watch permission to avoid lazy informer creation.
func (a *App) registerSharedCacheInvalidation(shared informers.SharedInformerFactory, selectionKey string, guard responseCacheInvalidationGuard, perms permissions.ListWatchChecker) {
	for _, d := range sharedCacheInvalidationDescriptors {
		if perms == nil || perms.CanListWatch(d.group, d.resource) {
			a.addResponseCacheInvalidationHandler(d.informer(shared), selectionKey, d.kind, guard)
		}
	}
}

func (a *App) registerGatewayAPIInvalidation(factory gatewayinformers.SharedInformerFactory, selectionKey string, guard responseCacheInvalidationGuard, perms permissions.ListWatchChecker) {
	if factory == nil {
		return
	}
	for _, d := range gatewayCacheInvalidationDescriptors {
		if perms == nil || perms.CanListWatch(d.group, d.resource) {
			a.addResponseCacheInvalidationHandler(d.informer(factory), selectionKey, d.kind, guard)
		}
	}
}

func (a *App) registerAPIExtensionsInvalidation(shared apiextensionsinformers.SharedInformerFactory, selectionKey string, guard responseCacheInvalidationGuard, perms permissions.ListWatchChecker) {
	if shared == nil {
		return
	}
	// CustomResourceDefinitions are cluster-scoped — gate on permissions.
	if perms != nil && !perms.CanListWatch("apiextensions.k8s.io", "customresourcedefinitions") {
		return
	}
	informer := shared.Apiextensions().V1().CustomResourceDefinitions().Informer()
	a.addResponseCacheInvalidationHandler(informer, selectionKey, "CustomResourceDefinition", guard)
}

// addResponseCacheInvalidationHandler evicts cached responses when an informer update arrives.
func (a *App) addResponseCacheInvalidationHandler(
	informer cache.SharedIndexInformer,
	selectionKey, kind string,
	guard responseCacheInvalidationGuard,
) {
	if a == nil || a.responseCache == nil || informer == nil {
		return
	}
	handler := cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			a.invalidateResponseCacheForObjectEvent(selectionKey, kind, obj, responseCacheInvalidationAdd, guard)
		},
		UpdateFunc: func(_, newObj interface{}) {
			a.invalidateResponseCacheForObjectEvent(selectionKey, kind, newObj, responseCacheInvalidationUpdate, guard)
		},
		DeleteFunc: func(obj interface{}) {
			a.invalidateResponseCacheForObjectEvent(selectionKey, kind, obj, responseCacheInvalidationDelete, guard)
		},
	}
	informer.AddEventHandler(handler)
}

// invalidateResponseCacheForObject clears cached detail/YAML/helm data for the given resource.
func (a *App) invalidateResponseCacheForObject(selectionKey, kind string, obj interface{}) {
	a.invalidateResponseCacheForObjectEvent(
		selectionKey,
		kind,
		obj,
		responseCacheInvalidationUpdate,
		responseCacheInvalidationGuard{},
	)
}

// invalidateResponseCacheForObjectEvent clears cached detail/YAML/helm data for the given event.
func (a *App) invalidateResponseCacheForObjectEvent(
	selectionKey, kind string,
	obj interface{},
	eventType responseCacheInvalidationEvent,
	guard responseCacheInvalidationGuard,
) {
	if a == nil || a.responseCache == nil {
		return
	}
	if shouldSkipResponseCacheInvalidationKind(kind) {
		return
	}
	obj = unwrapCacheTombstone(obj)
	metaObj, err := meta.Accessor(obj)
	if err != nil || metaObj == nil {
		return
	}
	if shouldSkipWarmupInvalidation(guard, eventType, metaObj) {
		return
	}
	name := strings.TrimSpace(metaObj.GetName())
	if name == "" {
		return
	}
	namespace := strings.TrimSpace(metaObj.GetNamespace())
	a.invalidateResponseCache(selectionKey, kind, namespace, name)
	a.invalidateHelmCacheIfNeeded(selectionKey, obj)
}

// invalidateResponseCacheForResource clears cached detail/YAML entries for a resource key.
func (a *App) invalidateResponseCacheForResource(selectionKey, kind, namespace, name string) {
	if shouldSkipResponseCacheInvalidationKind(kind) {
		return
	}
	a.invalidateResponseCache(selectionKey, kind, namespace, name)
}

// invalidateResponseCacheForGVK drops the exact GVK detail entry and the
// legacy kind-only detail key used by typed detail fetchers.
func (a *App) invalidateResponseCacheForGVK(selectionKey string, gvk schema.GroupVersionKind, namespace, name string) {
	if strings.TrimSpace(gvk.Kind) == "" || strings.TrimSpace(name) == "" {
		return
	}
	a.responseCacheDelete(selectionKey, objectDetailCacheKeyForGVK(gvk, namespace, name))
	a.responseCacheDelete(selectionKey, objectDetailCacheKey(gvk.Kind, namespace, name))
}

// invalidateResponseCache drops the cached detail entry for the resource.
// (The legacy YAML response-cache entry was retired with App.GetObjectYAML —
// the GVK-aware fetch path doesn't write to the response cache.)
func (a *App) invalidateResponseCache(selectionKey, kind, namespace, name string) {
	a.responseCacheDelete(selectionKey, objectDetailCacheKey(kind, namespace, name))
	if gvk, ok := objectDetailFetcherGVKs[strings.ToLower(strings.TrimSpace(kind))]; ok {
		a.responseCacheDelete(selectionKey, objectDetailCacheKeyForGVK(gvk, namespace, name))
	}
}

// invalidateHelmCacheIfNeeded evicts Helm release cache entries when a release secret/configmap changes.
func (a *App) invalidateHelmCacheIfNeeded(selectionKey string, obj interface{}) {
	switch typed := obj.(type) {
	case *corev1.Secret:
		if !isHelmReleaseObject(typed.Name, typed.Labels, string(typed.Type)) {
			return
		}
		a.invalidateHelmCache(selectionKey, typed.Namespace, resourcemodel.HelmReleaseName(typed.Name))
	case *corev1.ConfigMap:
		if !isHelmReleaseObject(typed.Name, typed.Labels, "") {
			return
		}
		a.invalidateHelmCache(selectionKey, typed.Namespace, resourcemodel.HelmReleaseName(typed.Name))
	}
}

// invalidateHelmCache clears cached Helm release details, manifests, and values.
func (a *App) invalidateHelmCache(selectionKey, namespace, name string) {
	if name == "" {
		return
	}
	a.responseCacheDelete(selectionKey, objectDetailCacheKey("HelmRelease", namespace, name))
	a.responseCacheDelete(selectionKey, objectDetailCacheKey("HelmManifest", namespace, name))
	a.responseCacheDelete(selectionKey, objectDetailCacheKey("HelmValues", namespace, name))
}

// unwrapCacheTombstone normalizes deleted informer events to the underlying object.
func unwrapCacheTombstone(obj interface{}) interface{} {
	switch typed := obj.(type) {
	case cache.DeletedFinalStateUnknown:
		return typed.Obj
	case *cache.DeletedFinalStateUnknown:
		return typed.Obj
	default:
		return obj
	}
}

// shouldSkipResponseCacheInvalidationKind returns true for kinds excluded from invalidation.
func shouldSkipResponseCacheInvalidationKind(kind string) bool {
	normalized := strings.ToLower(strings.TrimSpace(kind))
	if normalized == "" {
		return true
	}
	_, ok := responseCacheInvalidationSkipKinds[normalized]
	return ok
}

// shouldSkipWarmupInvalidation skips add events for older objects during informer warm-up.
func shouldSkipWarmupInvalidation(
	guard responseCacheInvalidationGuard,
	eventType responseCacheInvalidationEvent,
	metaObj metav1.Object,
) bool {
	if eventType != responseCacheInvalidationAdd {
		return false
	}
	if guard.hasSynced == nil {
		return false
	}
	if guard.hasSynced() {
		return false
	}
	if metaObj == nil {
		return false
	}
	createdAt := metaObj.GetCreationTimestamp()
	if createdAt.IsZero() {
		return false
	}
	now := time.Now()
	if guard.now != nil {
		now = guard.now()
	}
	age := now.Sub(createdAt.Time)
	if age < 0 {
		return false
	}
	return age >= config.ResponseCacheInvalidationWarmupAge
}

func isHelmReleaseObject(name string, labels map[string]string, secretType string) bool {
	if secretType == helmReleaseSecretType {
		return true
	}
	if labels != nil {
		if strings.EqualFold(labels[helmReleaseOwnerLabel], helmReleaseOwnerValue) {
			return true
		}
		if strings.EqualFold(labels[strings.ToUpper(helmReleaseOwnerLabel)], helmReleaseOwnerValue) {
			return true
		}
	}
	return strings.HasPrefix(name, resourcemodel.HelmReleaseNamePrefix)
}
