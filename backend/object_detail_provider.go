package backend

import (
	"context"
	"strings"

	"github.com/luxury-yacht/app/backend/internal/cachekeys"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/resources/admission"
	"github.com/luxury-yacht/app/backend/resources/apiextensions"
	"github.com/luxury-yacht/app/backend/resources/autoscaling"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/config"
	"github.com/luxury-yacht/app/backend/resources/constraints"
	"github.com/luxury-yacht/app/backend/resources/helm"
	"github.com/luxury-yacht/app/backend/resources/namespaces"
	"github.com/luxury-yacht/app/backend/resources/network"
	"github.com/luxury-yacht/app/backend/resources/nodes"
	"github.com/luxury-yacht/app/backend/resources/pods"
	"github.com/luxury-yacht/app/backend/resources/policy"
	"github.com/luxury-yacht/app/backend/resources/rbac"
	"github.com/luxury-yacht/app/backend/resources/storage"
	"github.com/luxury-yacht/app/backend/resources/workloads"
)

type objectDetailProvider struct {
	app *App
}

func (a *App) objectDetailProvider() snapshot.ObjectDetailProvider {
	return &objectDetailProvider{app: a}
}

type resolvedObjectDetailContext struct {
	deps         common.Dependencies
	selectionKey string
	scoped       bool
}

// objectDetailCacheKey matches FetchNamespacedResource cache keys for detail payloads.
func objectDetailCacheKey(kind, namespace, name string) string {
	return cachekeys.Build(strings.ToLower(strings.TrimSpace(kind))+"-detailed", namespace, name)
}

// resolveDetailContext ensures object detail fetches use the cluster scoped to the snapshot request.
func (p *objectDetailProvider) resolveDetailContext(ctx context.Context) resolvedObjectDetailContext {
	if p == nil || p.app == nil {
		return resolvedObjectDetailContext{deps: common.Dependencies{Context: ctx}}
	}

	meta := snapshot.ClusterMetaFromContext(ctx)
	if meta.ClusterID != "" {
		if deps, ok := p.app.resourceDependenciesForClusterID(meta.ClusterID); ok {
			return resolvedObjectDetailContext{
				deps:         deps.CloneWithContext(ctx),
				selectionKey: meta.ClusterID,
				scoped:       true,
			}
		}
	}

	return resolvedObjectDetailContext{
		deps:         p.app.resourceDependencies().CloneWithContext(ctx),
		selectionKey: p.app.currentSelectionKey(),
		scoped:       false,
	}
}

func (p *objectDetailProvider) FetchObjectYAML(ctx context.Context, kind, namespace, name string) (string, error) {
	resolved := p.resolveDetailContext(ctx)
	if p == nil || p.app == nil {
		return getObjectYAMLWithDependencies(resolved.deps, resolved.selectionKey, kind, namespace, name)
	}
	return p.app.getObjectYAMLWithCache(resolved.deps, resolved.selectionKey, kind, namespace, name)
}

func (p *objectDetailProvider) FetchHelmManifest(ctx context.Context, namespace, name string) (string, int, error) {
	resolved := p.resolveDetailContext(ctx)
	if !resolved.scoped {
		manifest, err := p.app.GetHelmManifest(namespace, name)
		if err != nil {
			return "", 0, err
		}
		details, err := p.app.GetHelmReleaseDetails(namespace, name)
		if err != nil || details == nil {
			return manifest, 0, nil
		}
		return manifest, details.Revision, nil
	}

	service := helm.NewService(helm.Dependencies{Common: resolved.deps})
	manifestCacheKey := objectDetailCacheKey("HelmManifest", namespace, name)
	if p != nil && p.app != nil {
		if cached, ok := p.app.responseCacheLookup(resolved.selectionKey, manifestCacheKey); ok {
			if manifest, ok := cached.(string); ok {
				// Avoid serving cached Helm data when permission checks deny access.
				if p.app.canServeCachedResponse(ctx, resolved.deps, resolved.selectionKey, "HelmManifest", namespace, name) {
					revision, err := p.helmReleaseRevisionWithCache(resolved, service, namespace, name)
					if err != nil {
						return manifest, 0, nil
					}
					return manifest, revision, nil
				}
			}
			p.app.responseCacheDelete(resolved.selectionKey, manifestCacheKey)
		}
	}
	manifest, err := service.ReleaseManifest(namespace, name)
	if err != nil {
		return "", 0, err
	}
	if p != nil && p.app != nil {
		p.app.responseCacheStore(resolved.selectionKey, manifestCacheKey, manifest)
	}
	revision, err := p.helmReleaseRevisionWithCache(resolved, service, namespace, name)
	if err != nil {
		return manifest, 0, nil
	}
	return manifest, revision, nil
}

func (p *objectDetailProvider) FetchHelmValues(ctx context.Context, namespace, name string) (map[string]interface{}, int, error) {
	resolved := p.resolveDetailContext(ctx)
	if !resolved.scoped {
		values, err := p.app.GetHelmValues(namespace, name)
		if err != nil {
			return nil, 0, err
		}
		details, err := p.app.GetHelmReleaseDetails(namespace, name)
		if err != nil || details == nil {
			return values, 0, nil
		}
		return values, details.Revision, nil
	}

	service := helm.NewService(helm.Dependencies{Common: resolved.deps})
	valuesCacheKey := objectDetailCacheKey("HelmValues", namespace, name)
	if p != nil && p.app != nil {
		if cached, ok := p.app.responseCacheLookup(resolved.selectionKey, valuesCacheKey); ok {
			if values, ok := cached.(map[string]interface{}); ok {
				// Avoid serving cached Helm data when permission checks deny access.
				if p.app.canServeCachedResponse(ctx, resolved.deps, resolved.selectionKey, "HelmValues", namespace, name) {
					revision, err := p.helmReleaseRevisionWithCache(resolved, service, namespace, name)
					if err != nil {
						return values, 0, nil
					}
					return values, revision, nil
				}
			}
			p.app.responseCacheDelete(resolved.selectionKey, valuesCacheKey)
		}
	}
	values, err := service.ReleaseValues(namespace, name)
	if err != nil {
		return nil, 0, err
	}
	if p != nil && p.app != nil {
		p.app.responseCacheStore(resolved.selectionKey, valuesCacheKey, values)
	}
	revision, err := p.helmReleaseRevisionWithCache(resolved, service, namespace, name)
	if err != nil {
		return values, 0, nil
	}
	return values, revision, nil
}

func (p *objectDetailProvider) FetchObjectDetails(ctx context.Context, kind, namespace, name string) (interface{}, string, error) {
	resolved := p.resolveDetailContext(ctx)
	if resolved.scoped {
		cacheKey := objectDetailCacheKey(kind, namespace, name)
		if p != nil && p.app != nil {
			if cached, ok := p.app.responseCacheLookup(resolved.selectionKey, cacheKey); ok {
				// Avoid serving cached details when permission checks deny access.
				if p.app.canServeCachedResponse(ctx, resolved.deps, resolved.selectionKey, kind, namespace, name) {
					return cached, "", nil
				}
				p.app.responseCacheDelete(resolved.selectionKey, cacheKey)
			}
		}
		detail, version, err := fetchObjectDetailsWithDependencies(resolved.deps, kind, namespace, name)
		if err == nil && p != nil && p.app != nil {
			p.app.responseCacheStore(resolved.selectionKey, cacheKey, detail)
		}
		return detail, version, err
	}

	// Delegates to existing App getters so the frontend continues to receive
	// the rich detail structures that were previously exposed via RPC.
	switch strings.ToLower(kind) {
	case "pod":
		detail, err := p.app.GetPod(namespace, name, true)
		return detail, "", err
	case "deployment":
		detail, err := p.app.GetDeployment(namespace, name)
		return detail, "", err
	case "replicaset":
		detail, err := p.app.GetReplicaSet(namespace, name)
		return detail, "", err
	case "daemonset":
		detail, err := p.app.GetDaemonSet(namespace, name)
		return detail, "", err
	case "statefulset":
		detail, err := p.app.GetStatefulSet(namespace, name)
		return detail, "", err
	case "job":
		detail, err := p.app.GetJob(namespace, name)
		return detail, "", err
	case "cronjob":
		detail, err := p.app.GetCronJob(namespace, name)
		return detail, "", err
	case "configmap":
		detail, err := p.app.GetConfigMap(namespace, name)
		return detail, "", err
	case "secret":
		detail, err := p.app.GetSecret(namespace, name)
		return detail, "", err
	case "helmrelease":
		detail, err := p.app.GetHelmReleaseDetails(namespace, name)
		return detail, "", err
	case "service":
		detail, err := p.app.GetService(namespace, name)
		return detail, "", err
	case "ingress":
		detail, err := p.app.GetIngress(namespace, name)
		return detail, "", err
	case "networkpolicy":
		detail, err := p.app.GetNetworkPolicy(namespace, name)
		return detail, "", err
	case "endpointslice":
		detail, err := p.app.GetEndpointSlice(namespace, name)
		return detail, "", err
	case "persistentvolumeclaim":
		detail, err := p.app.GetPersistentVolumeClaim(namespace, name)
		return detail, "", err
	case "persistentvolume":
		detail, err := p.app.GetPersistentVolume(name)
		return detail, "", err
	case "storageclass":
		detail, err := p.app.GetStorageClass(name)
		return detail, "", err
	case "serviceaccount":
		detail, err := p.app.GetServiceAccount(namespace, name)
		return detail, "", err
	case "role":
		detail, err := p.app.GetRole(namespace, name)
		return detail, "", err
	case "rolebinding":
		detail, err := p.app.GetRoleBinding(namespace, name)
		return detail, "", err
	case "clusterrole":
		detail, err := p.app.GetClusterRole(name)
		return detail, "", err
	case "clusterrolebinding":
		detail, err := p.app.GetClusterRoleBinding(name)
		return detail, "", err
	case "resourcequota":
		detail, err := p.app.GetResourceQuota(namespace, name)
		return detail, "", err
	case "limitrange":
		detail, err := p.app.GetLimitRange(namespace, name)
		return detail, "", err
	case "horizontalpodautoscaler":
		detail, err := p.app.GetHorizontalPodAutoscaler(namespace, name)
		return detail, "", err
	case "poddisruptionbudget":
		detail, err := p.app.GetPodDisruptionBudget(namespace, name)
		return detail, "", err
	case "namespace":
		detail, err := p.app.GetNamespace(name)
		return detail, "", err
	case "node":
		detail, err := p.app.GetNode(name)
		return detail, "", err
	case "ingressclass":
		detail, err := p.app.GetIngressClass(name)
		return detail, "", err
	case "customresourcedefinition":
		detail, err := p.app.GetCustomResourceDefinition(name)
		return detail, "", err
	case "mutatingwebhookconfiguration":
		detail, err := p.app.GetMutatingWebhookConfiguration(name)
		return detail, "", err
	case "validatingwebhookconfiguration":
		detail, err := p.app.GetValidatingWebhookConfiguration(name)
		return detail, "", err
	default:
		return nil, "", snapshot.ErrObjectDetailNotImplemented
	}
}

// helmReleaseRevisionWithCache reuses cached Helm release details when possible.
func (p *objectDetailProvider) helmReleaseRevisionWithCache(
	resolved resolvedObjectDetailContext,
	service *helm.Service,
	namespace, name string,
) (int, error) {
	detailsCacheKey := objectDetailCacheKey("HelmRelease", namespace, name)
	if p != nil && p.app != nil {
		if cached, ok := p.app.responseCacheLookup(resolved.selectionKey, detailsCacheKey); ok {
			if details, ok := cached.(*HelmReleaseDetails); ok && details != nil {
				// Avoid serving cached Helm data when permission checks deny access.
				if p.app.canServeCachedResponse(resolved.deps.Context, resolved.deps, resolved.selectionKey, "HelmRelease", namespace, name) {
					return details.Revision, nil
				}
			}
			p.app.responseCacheDelete(resolved.selectionKey, detailsCacheKey)
		}
	}

	details, err := service.ReleaseDetails(namespace, name)
	if err != nil || details == nil {
		return 0, err
	}
	if p != nil && p.app != nil {
		p.app.responseCacheStore(resolved.selectionKey, detailsCacheKey, details)
	}
	return details.Revision, nil
}

// fetchObjectDetailsWithDependencies resolves object detail payloads using scoped dependencies.
func fetchObjectDetailsWithDependencies(
	deps common.Dependencies,
	kind, namespace, name string,
) (interface{}, string, error) {
	switch strings.ToLower(kind) {
	case "pod":
		detail, err := pods.GetPod(pods.Dependencies{Common: deps}, namespace, name, true)
		return detail, "", err
	case "deployment":
		detail, err := workloads.NewDeploymentService(workloads.Dependencies{Common: deps}).Deployment(namespace, name)
		return detail, "", err
	case "replicaset":
		detail, err := workloads.NewReplicaSetService(workloads.Dependencies{Common: deps}).ReplicaSet(namespace, name)
		return detail, "", err
	case "daemonset":
		detail, err := workloads.NewDaemonSetService(workloads.Dependencies{Common: deps}).DaemonSet(namespace, name)
		return detail, "", err
	case "statefulset":
		detail, err := workloads.NewStatefulSetService(workloads.Dependencies{Common: deps}).StatefulSet(namespace, name)
		return detail, "", err
	case "job":
		detail, err := workloads.NewJobService(workloads.Dependencies{Common: deps}).Job(namespace, name)
		return detail, "", err
	case "cronjob":
		detail, err := workloads.NewCronJobService(workloads.Dependencies{Common: deps}).CronJob(namespace, name)
		return detail, "", err
	case "configmap":
		detail, err := config.NewService(config.Dependencies{Common: deps}).ConfigMap(namespace, name)
		return detail, "", err
	case "secret":
		detail, err := config.NewService(config.Dependencies{Common: deps}).Secret(namespace, name)
		return detail, "", err
	case "helmrelease":
		detail, err := helm.NewService(helm.Dependencies{Common: deps}).ReleaseDetails(namespace, name)
		return detail, "", err
	case "service":
		detail, err := network.NewService(network.Dependencies{Common: deps}).GetService(namespace, name)
		return detail, "", err
	case "ingress":
		detail, err := network.NewService(network.Dependencies{Common: deps}).Ingress(namespace, name)
		return detail, "", err
	case "networkpolicy":
		detail, err := network.NewService(network.Dependencies{Common: deps}).NetworkPolicy(namespace, name)
		return detail, "", err
	case "endpointslice":
		detail, err := network.NewService(network.Dependencies{Common: deps}).EndpointSlice(namespace, name)
		return detail, "", err
	case "persistentvolumeclaim":
		detail, err := storage.NewService(storage.Dependencies{Common: deps}).PersistentVolumeClaim(namespace, name)
		return detail, "", err
	case "persistentvolume":
		detail, err := storage.NewService(storage.Dependencies{Common: deps}).PersistentVolume(name)
		return detail, "", err
	case "storageclass":
		detail, err := storage.NewService(storage.Dependencies{Common: deps}).StorageClass(name)
		return detail, "", err
	case "serviceaccount":
		detail, err := rbac.NewService(rbac.Dependencies{Common: deps}).ServiceAccount(namespace, name)
		return detail, "", err
	case "role":
		detail, err := rbac.NewService(rbac.Dependencies{Common: deps}).Role(namespace, name)
		return detail, "", err
	case "rolebinding":
		detail, err := rbac.NewService(rbac.Dependencies{Common: deps}).RoleBinding(namespace, name)
		return detail, "", err
	case "clusterrole":
		detail, err := rbac.NewService(rbac.Dependencies{Common: deps}).ClusterRole(name)
		return detail, "", err
	case "clusterrolebinding":
		detail, err := rbac.NewService(rbac.Dependencies{Common: deps}).ClusterRoleBinding(name)
		return detail, "", err
	case "resourcequota":
		detail, err := constraints.NewService(constraints.Dependencies{Common: deps}).ResourceQuota(namespace, name)
		return detail, "", err
	case "limitrange":
		detail, err := constraints.NewService(constraints.Dependencies{Common: deps}).LimitRange(namespace, name)
		return detail, "", err
	case "horizontalpodautoscaler":
		detail, err := autoscaling.NewService(autoscaling.Dependencies{Common: deps}).HorizontalPodAutoscaler(namespace, name)
		return detail, "", err
	case "poddisruptionbudget":
		detail, err := policy.NewService(policy.Dependencies{Common: deps}).PodDisruptionBudget(namespace, name)
		return detail, "", err
	case "namespace":
		detail, err := namespaces.NewService(namespaces.Dependencies{Common: deps}).Namespace(name)
		return detail, "", err
	case "node":
		detail, err := nodes.NewService(nodes.Dependencies{Common: deps}).Node(name)
		return detail, "", err
	case "ingressclass":
		detail, err := network.NewService(network.Dependencies{Common: deps}).IngressClass(name)
		return detail, "", err
	case "customresourcedefinition":
		detail, err := apiextensions.NewService(apiextensions.Dependencies{Common: deps}).CustomResourceDefinition(name)
		return detail, "", err
	case "mutatingwebhookconfiguration":
		detail, err := admission.NewService(admission.Dependencies{Common: deps}).MutatingWebhookConfiguration(name)
		return detail, "", err
	case "validatingwebhookconfiguration":
		detail, err := admission.NewService(admission.Dependencies{Common: deps}).ValidatingWebhookConfiguration(name)
		return detail, "", err
	default:
		return nil, "", snapshot.ErrObjectDetailNotImplemented
	}
}
