package backend

import (
	"strings"

	corev1 "k8s.io/api/core/v1"
	apiextensionsinformers "k8s.io/apiextensions-apiserver/pkg/client/informers/externalversions"
	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/refresh/system"
)

const (
	helmReleaseSecretType = "helm.sh/release.v1"
	helmReleaseNamePrefix = "sh.helm.release.v1."
	helmReleaseOwnerLabel = "owner"
	helmReleaseOwnerValue = "helm"
)

// registerResponseCacheInvalidation wires informer-driven cache eviction for cached detail/YAML/helm responses.
func (a *App) registerResponseCacheInvalidation(subsystem *system.Subsystem, selectionKey string) {
	if a == nil || a.responseCache == nil || subsystem == nil || subsystem.InformerFactory == nil {
		return
	}
	shared := subsystem.InformerFactory.SharedInformerFactory()
	if shared == nil {
		return
	}

	a.registerCoreInvalidation(shared, selectionKey)
	a.registerAppsInvalidation(shared, selectionKey)
	a.registerBatchInvalidation(shared, selectionKey)
	a.registerRBACInvalidation(shared, selectionKey)
	a.registerStorageInvalidation(shared, selectionKey)
	a.registerNetworkingInvalidation(shared, selectionKey)
	a.registerAutoscalingInvalidation(shared, selectionKey)
	a.registerPolicyInvalidation(shared, selectionKey)
	a.registerAdmissionInvalidation(shared, selectionKey)
	a.registerAPIExtensionsInvalidation(subsystem.InformerFactory.APIExtensionsInformerFactory(), selectionKey)
}

func (a *App) registerCoreInvalidation(shared informers.SharedInformerFactory, selectionKey string) {
	a.addResponseCacheInvalidationHandler(shared.Core().V1().Pods().Informer(), selectionKey, "Pod")
	a.addResponseCacheInvalidationHandler(shared.Core().V1().ConfigMaps().Informer(), selectionKey, "ConfigMap")
	a.addResponseCacheInvalidationHandler(shared.Core().V1().Secrets().Informer(), selectionKey, "Secret")
	a.addResponseCacheInvalidationHandler(shared.Core().V1().Services().Informer(), selectionKey, "Service")
	a.addResponseCacheInvalidationHandler(shared.Core().V1().Namespaces().Informer(), selectionKey, "Namespace")
	a.addResponseCacheInvalidationHandler(shared.Core().V1().Nodes().Informer(), selectionKey, "Node")
	a.addResponseCacheInvalidationHandler(shared.Core().V1().PersistentVolumes().Informer(), selectionKey, "PersistentVolume")
	a.addResponseCacheInvalidationHandler(shared.Core().V1().PersistentVolumeClaims().Informer(), selectionKey, "PersistentVolumeClaim")
	a.addResponseCacheInvalidationHandler(shared.Core().V1().ResourceQuotas().Informer(), selectionKey, "ResourceQuota")
	a.addResponseCacheInvalidationHandler(shared.Core().V1().LimitRanges().Informer(), selectionKey, "LimitRange")
	a.addResponseCacheInvalidationHandler(shared.Core().V1().ServiceAccounts().Informer(), selectionKey, "ServiceAccount")
}

func (a *App) registerAppsInvalidation(shared informers.SharedInformerFactory, selectionKey string) {
	a.addResponseCacheInvalidationHandler(shared.Apps().V1().ReplicaSets().Informer(), selectionKey, "ReplicaSet")
	a.addResponseCacheInvalidationHandler(shared.Apps().V1().Deployments().Informer(), selectionKey, "Deployment")
	a.addResponseCacheInvalidationHandler(shared.Apps().V1().StatefulSets().Informer(), selectionKey, "StatefulSet")
	a.addResponseCacheInvalidationHandler(shared.Apps().V1().DaemonSets().Informer(), selectionKey, "DaemonSet")
}

func (a *App) registerBatchInvalidation(shared informers.SharedInformerFactory, selectionKey string) {
	a.addResponseCacheInvalidationHandler(shared.Batch().V1().Jobs().Informer(), selectionKey, "Job")
	a.addResponseCacheInvalidationHandler(shared.Batch().V1().CronJobs().Informer(), selectionKey, "CronJob")
}

func (a *App) registerRBACInvalidation(shared informers.SharedInformerFactory, selectionKey string) {
	a.addResponseCacheInvalidationHandler(shared.Rbac().V1().Roles().Informer(), selectionKey, "Role")
	a.addResponseCacheInvalidationHandler(shared.Rbac().V1().RoleBindings().Informer(), selectionKey, "RoleBinding")
	a.addResponseCacheInvalidationHandler(shared.Rbac().V1().ClusterRoles().Informer(), selectionKey, "ClusterRole")
	a.addResponseCacheInvalidationHandler(shared.Rbac().V1().ClusterRoleBindings().Informer(), selectionKey, "ClusterRoleBinding")
}

func (a *App) registerStorageInvalidation(shared informers.SharedInformerFactory, selectionKey string) {
	a.addResponseCacheInvalidationHandler(shared.Storage().V1().StorageClasses().Informer(), selectionKey, "StorageClass")
}

func (a *App) registerNetworkingInvalidation(shared informers.SharedInformerFactory, selectionKey string) {
	a.addResponseCacheInvalidationHandler(shared.Networking().V1().Ingresses().Informer(), selectionKey, "Ingress")
	a.addResponseCacheInvalidationHandler(shared.Networking().V1().NetworkPolicies().Informer(), selectionKey, "NetworkPolicy")
	a.addResponseCacheInvalidationHandler(shared.Networking().V1().IngressClasses().Informer(), selectionKey, "IngressClass")
	a.addResponseCacheInvalidationHandler(shared.Discovery().V1().EndpointSlices().Informer(), selectionKey, "EndpointSlice")
}

func (a *App) registerAutoscalingInvalidation(shared informers.SharedInformerFactory, selectionKey string) {
	a.addResponseCacheInvalidationHandler(shared.Autoscaling().V1().HorizontalPodAutoscalers().Informer(), selectionKey, "HorizontalPodAutoscaler")
}

func (a *App) registerPolicyInvalidation(shared informers.SharedInformerFactory, selectionKey string) {
	a.addResponseCacheInvalidationHandler(shared.Policy().V1().PodDisruptionBudgets().Informer(), selectionKey, "PodDisruptionBudget")
}

func (a *App) registerAdmissionInvalidation(shared informers.SharedInformerFactory, selectionKey string) {
	a.addResponseCacheInvalidationHandler(shared.Admissionregistration().V1().MutatingWebhookConfigurations().Informer(), selectionKey, "MutatingWebhookConfiguration")
	a.addResponseCacheInvalidationHandler(shared.Admissionregistration().V1().ValidatingWebhookConfigurations().Informer(), selectionKey, "ValidatingWebhookConfiguration")
}

func (a *App) registerAPIExtensionsInvalidation(shared apiextensionsinformers.SharedInformerFactory, selectionKey string) {
	if shared == nil {
		return
	}
	a.addResponseCacheInvalidationHandler(shared.Apiextensions().V1().CustomResourceDefinitions().Informer(), selectionKey, "CustomResourceDefinition")
}

// addResponseCacheInvalidationHandler evicts cached responses when an informer update arrives.
func (a *App) addResponseCacheInvalidationHandler(informer cache.SharedIndexInformer, selectionKey, kind string) {
	if a == nil || a.responseCache == nil || informer == nil {
		return
	}
	handler := cache.ResourceEventHandlerFuncs{
		AddFunc: func(obj interface{}) {
			a.invalidateResponseCacheForObject(selectionKey, kind, obj)
		},
		UpdateFunc: func(_, newObj interface{}) {
			a.invalidateResponseCacheForObject(selectionKey, kind, newObj)
		},
		DeleteFunc: func(obj interface{}) {
			a.invalidateResponseCacheForObject(selectionKey, kind, obj)
		},
	}
	informer.AddEventHandler(handler)
}

// invalidateResponseCacheForObject clears cached detail/YAML/helm data for the given resource.
func (a *App) invalidateResponseCacheForObject(selectionKey, kind string, obj interface{}) {
	if a == nil || a.responseCache == nil {
		return
	}
	obj = unwrapCacheTombstone(obj)
	metaObj, err := meta.Accessor(obj)
	if err != nil || metaObj == nil {
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
