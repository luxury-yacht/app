package backend

import (
	"context"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	apiextensionsinformers "k8s.io/apiextensions-apiserver/pkg/client/informers/externalversions"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh/system"
)

const (
	helmReleaseSecretType              = "helm.sh/release.v1"
	helmReleaseNamePrefix              = "sh.helm.release.v1."
	helmReleaseOwnerLabel              = "owner"
	helmReleaseOwnerValue              = "helm"
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

// responseCachePermissionChecker gates informer access based on RBAC permissions.
type responseCachePermissionChecker interface {
	CanListWatch(group, resource string) bool
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
	var perms responseCachePermissionChecker = subsystem.InformerFactory

	a.registerCoreInvalidation(shared, selectionKey, guard, perms)
	a.registerAppsInvalidation(shared, selectionKey, guard, perms)
	a.registerBatchInvalidation(shared, selectionKey, guard, perms)
	a.registerRBACInvalidation(shared, selectionKey, guard, perms)
	a.registerStorageInvalidation(shared, selectionKey, guard, perms)
	a.registerNetworkingInvalidation(shared, selectionKey, guard, perms)
	a.registerAutoscalingInvalidation(shared, selectionKey, guard, perms)
	a.registerPolicyInvalidation(shared, selectionKey, guard, perms)
	a.registerAdmissionInvalidation(shared, selectionKey, guard, perms)
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

func (a *App) registerCoreInvalidation(shared informers.SharedInformerFactory, selectionKey string, guard responseCacheInvalidationGuard, perms responseCachePermissionChecker) {
	// All informers watch at cluster scope, so every resource needs a permission check
	// to prevent lazy informer creation for resources the user cannot list/watch cluster-wide.
	if perms == nil || perms.CanListWatch("", "pods") {
		a.addResponseCacheInvalidationHandler(shared.Core().V1().Pods().Informer(), selectionKey, "Pod", guard)
	}
	if perms == nil || perms.CanListWatch("", "configmaps") {
		a.addResponseCacheInvalidationHandler(shared.Core().V1().ConfigMaps().Informer(), selectionKey, "ConfigMap", guard)
	}
	if perms == nil || perms.CanListWatch("", "secrets") {
		a.addResponseCacheInvalidationHandler(shared.Core().V1().Secrets().Informer(), selectionKey, "Secret", guard)
	}
	if perms == nil || perms.CanListWatch("", "services") {
		a.addResponseCacheInvalidationHandler(shared.Core().V1().Services().Informer(), selectionKey, "Service", guard)
	}
	if perms == nil || perms.CanListWatch("", "persistentvolumeclaims") {
		a.addResponseCacheInvalidationHandler(shared.Core().V1().PersistentVolumeClaims().Informer(), selectionKey, "PersistentVolumeClaim", guard)
	}
	if perms == nil || perms.CanListWatch("", "resourcequotas") {
		a.addResponseCacheInvalidationHandler(shared.Core().V1().ResourceQuotas().Informer(), selectionKey, "ResourceQuota", guard)
	}
	if perms == nil || perms.CanListWatch("", "limitranges") {
		a.addResponseCacheInvalidationHandler(shared.Core().V1().LimitRanges().Informer(), selectionKey, "LimitRange", guard)
	}
	if perms == nil || perms.CanListWatch("", "serviceaccounts") {
		a.addResponseCacheInvalidationHandler(shared.Core().V1().ServiceAccounts().Informer(), selectionKey, "ServiceAccount", guard)
	}
	if perms == nil || perms.CanListWatch("", "namespaces") {
		a.addResponseCacheInvalidationHandler(shared.Core().V1().Namespaces().Informer(), selectionKey, "Namespace", guard)
	}
	if perms == nil || perms.CanListWatch("", "nodes") {
		a.addResponseCacheInvalidationHandler(shared.Core().V1().Nodes().Informer(), selectionKey, "Node", guard)
	}
	if perms == nil || perms.CanListWatch("", "persistentvolumes") {
		a.addResponseCacheInvalidationHandler(shared.Core().V1().PersistentVolumes().Informer(), selectionKey, "PersistentVolume", guard)
	}
}

func (a *App) registerAppsInvalidation(shared informers.SharedInformerFactory, selectionKey string, guard responseCacheInvalidationGuard, perms responseCachePermissionChecker) {
	if perms == nil || perms.CanListWatch("apps", "replicasets") {
		a.addResponseCacheInvalidationHandler(shared.Apps().V1().ReplicaSets().Informer(), selectionKey, "ReplicaSet", guard)
	}
	if perms == nil || perms.CanListWatch("apps", "deployments") {
		a.addResponseCacheInvalidationHandler(shared.Apps().V1().Deployments().Informer(), selectionKey, "Deployment", guard)
	}
	if perms == nil || perms.CanListWatch("apps", "statefulsets") {
		a.addResponseCacheInvalidationHandler(shared.Apps().V1().StatefulSets().Informer(), selectionKey, "StatefulSet", guard)
	}
	if perms == nil || perms.CanListWatch("apps", "daemonsets") {
		a.addResponseCacheInvalidationHandler(shared.Apps().V1().DaemonSets().Informer(), selectionKey, "DaemonSet", guard)
	}
}

func (a *App) registerBatchInvalidation(shared informers.SharedInformerFactory, selectionKey string, guard responseCacheInvalidationGuard, perms responseCachePermissionChecker) {
	if perms == nil || perms.CanListWatch("batch", "jobs") {
		a.addResponseCacheInvalidationHandler(shared.Batch().V1().Jobs().Informer(), selectionKey, "Job", guard)
	}
	if perms == nil || perms.CanListWatch("batch", "cronjobs") {
		a.addResponseCacheInvalidationHandler(shared.Batch().V1().CronJobs().Informer(), selectionKey, "CronJob", guard)
	}
}

func (a *App) registerRBACInvalidation(shared informers.SharedInformerFactory, selectionKey string, guard responseCacheInvalidationGuard, perms responseCachePermissionChecker) {
	if perms == nil || perms.CanListWatch("rbac.authorization.k8s.io", "roles") {
		a.addResponseCacheInvalidationHandler(shared.Rbac().V1().Roles().Informer(), selectionKey, "Role", guard)
	}
	if perms == nil || perms.CanListWatch("rbac.authorization.k8s.io", "rolebindings") {
		a.addResponseCacheInvalidationHandler(shared.Rbac().V1().RoleBindings().Informer(), selectionKey, "RoleBinding", guard)
	}
	if perms == nil || perms.CanListWatch("rbac.authorization.k8s.io", "clusterroles") {
		a.addResponseCacheInvalidationHandler(shared.Rbac().V1().ClusterRoles().Informer(), selectionKey, "ClusterRole", guard)
	}
	if perms == nil || perms.CanListWatch("rbac.authorization.k8s.io", "clusterrolebindings") {
		a.addResponseCacheInvalidationHandler(shared.Rbac().V1().ClusterRoleBindings().Informer(), selectionKey, "ClusterRoleBinding", guard)
	}
}

func (a *App) registerStorageInvalidation(shared informers.SharedInformerFactory, selectionKey string, guard responseCacheInvalidationGuard, perms responseCachePermissionChecker) {
	// StorageClasses are cluster-scoped — gate on permissions.
	if perms == nil || perms.CanListWatch("storage.k8s.io", "storageclasses") {
		a.addResponseCacheInvalidationHandler(shared.Storage().V1().StorageClasses().Informer(), selectionKey, "StorageClass", guard)
	}
}

func (a *App) registerNetworkingInvalidation(shared informers.SharedInformerFactory, selectionKey string, guard responseCacheInvalidationGuard, perms responseCachePermissionChecker) {
	if perms == nil || perms.CanListWatch("networking.k8s.io", "ingresses") {
		a.addResponseCacheInvalidationHandler(shared.Networking().V1().Ingresses().Informer(), selectionKey, "Ingress", guard)
	}
	if perms == nil || perms.CanListWatch("networking.k8s.io", "networkpolicies") {
		a.addResponseCacheInvalidationHandler(shared.Networking().V1().NetworkPolicies().Informer(), selectionKey, "NetworkPolicy", guard)
	}
	if perms == nil || perms.CanListWatch("discovery.k8s.io", "endpointslices") {
		a.addResponseCacheInvalidationHandler(shared.Discovery().V1().EndpointSlices().Informer(), selectionKey, "EndpointSlice", guard)
	}
	if perms == nil || perms.CanListWatch("networking.k8s.io", "ingressclasses") {
		a.addResponseCacheInvalidationHandler(shared.Networking().V1().IngressClasses().Informer(), selectionKey, "IngressClass", guard)
	}
}

func (a *App) registerAutoscalingInvalidation(shared informers.SharedInformerFactory, selectionKey string, guard responseCacheInvalidationGuard, perms responseCachePermissionChecker) {
	if perms == nil || perms.CanListWatch("autoscaling", "horizontalpodautoscalers") {
		a.addResponseCacheInvalidationHandler(shared.Autoscaling().V1().HorizontalPodAutoscalers().Informer(), selectionKey, "HorizontalPodAutoscaler", guard)
	}
}

func (a *App) registerPolicyInvalidation(shared informers.SharedInformerFactory, selectionKey string, guard responseCacheInvalidationGuard, perms responseCachePermissionChecker) {
	if perms == nil || perms.CanListWatch("policy", "poddisruptionbudgets") {
		a.addResponseCacheInvalidationHandler(shared.Policy().V1().PodDisruptionBudgets().Informer(), selectionKey, "PodDisruptionBudget", guard)
	}
}

func (a *App) registerAdmissionInvalidation(shared informers.SharedInformerFactory, selectionKey string, guard responseCacheInvalidationGuard, perms responseCachePermissionChecker) {
	// MutatingWebhookConfigurations and ValidatingWebhookConfigurations are cluster-scoped — gate on permissions.
	if perms == nil || perms.CanListWatch("admissionregistration.k8s.io", "mutatingwebhookconfigurations") {
		a.addResponseCacheInvalidationHandler(shared.Admissionregistration().V1().MutatingWebhookConfigurations().Informer(), selectionKey, "MutatingWebhookConfiguration", guard)
	}
	if perms == nil || perms.CanListWatch("admissionregistration.k8s.io", "validatingwebhookconfigurations") {
		a.addResponseCacheInvalidationHandler(shared.Admissionregistration().V1().ValidatingWebhookConfigurations().Informer(), selectionKey, "ValidatingWebhookConfiguration", guard)
	}
}

func (a *App) registerAPIExtensionsInvalidation(shared apiextensionsinformers.SharedInformerFactory, selectionKey string, guard responseCacheInvalidationGuard, perms responseCachePermissionChecker) {
	if shared == nil {
		return
	}
	// CustomResourceDefinitions are cluster-scoped — gate on permissions.
	if perms != nil && !perms.CanListWatch("apiextensions.k8s.io", "customresourcedefinitions") {
		return
	}
	informer := shared.Apiextensions().V1().CustomResourceDefinitions().Informer()
	a.addResponseCacheInvalidationHandler(informer, selectionKey, "CustomResourceDefinition", guard)
	// Clear cached discovery data whenever CRDs change to avoid stale GVR lookups.
	informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			clearGVRCache()
		},
		UpdateFunc: func(_, newObj interface{}) {
			clearGVRCache()
		},
		DeleteFunc: func(obj interface{}) {
			clearGVRCache()
		},
	})
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

// invalidateResponseCache drops the cached detail and YAML entries for the resource.
func (a *App) invalidateResponseCache(selectionKey, kind, namespace, name string) {
	a.responseCacheDelete(selectionKey, objectDetailCacheKey(kind, namespace, name))
	a.responseCacheDelete(selectionKey, objectYAMLCacheKey(kind, namespace, name))
}

// invalidateHelmCacheIfNeeded evicts Helm release cache entries when a release secret/configmap changes.
func (a *App) invalidateHelmCacheIfNeeded(selectionKey string, obj interface{}) {
	switch typed := obj.(type) {
	case *corev1.Secret:
		if !isHelmReleaseObject(typed.Name, typed.Labels, string(typed.Type)) {
			return
		}
		a.invalidateHelmCache(selectionKey, typed.Namespace, helmReleaseName(typed.Name))
	case *corev1.ConfigMap:
		if !isHelmReleaseObject(typed.Name, typed.Labels, "") {
			return
		}
		a.invalidateHelmCache(selectionKey, typed.Namespace, helmReleaseName(typed.Name))
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
	return strings.HasPrefix(name, helmReleaseNamePrefix)
}

func helmReleaseName(name string) string {
	if !strings.HasPrefix(name, helmReleaseNamePrefix) {
		return name
	}
	trimmed := strings.TrimPrefix(name, helmReleaseNamePrefix)
	index := strings.LastIndex(trimmed, ".v")
	if index <= 0 {
		return trimmed
	}
	return trimmed[:index]
}
