/*
 * backend/object_detail_provider.go
 *
 * Object detail provider implementation.
 */

package backend

import (
	"context"
	"fmt"
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
	deps         common.Dependencies // Dependencies for resource operations
	selectionKey string              // Selection key for caching and scoping
	scoped       bool                // Indicates if the context is scoped to a specific cluster
}

// objectDetailFetcher maps a kind to dependency-based detail retrievals.
type objectDetailFetcher struct {
	withDeps func(deps common.Dependencies, namespace, name string) (interface{}, string, error)
}

var objectDetailFetchers = map[string]objectDetailFetcher{
	"pod": {
		withDeps: func(deps common.Dependencies, namespace, name string) (interface{}, string, error) {
			detail, err := pods.GetPod(deps, namespace, name, true)
			return detail, "", err
		},
	},
	"deployment": {
		withDeps: func(deps common.Dependencies, namespace, name string) (interface{}, string, error) {
			detail, err := workloads.NewDeploymentService(deps).Deployment(namespace, name)
			return detail, "", err
		},
	},
	"replicaset": {
		withDeps: func(deps common.Dependencies, namespace, name string) (interface{}, string, error) {
			detail, err := workloads.NewReplicaSetService(deps).ReplicaSet(namespace, name)
			return detail, "", err
		},
	},
	"daemonset": {
		withDeps: func(deps common.Dependencies, namespace, name string) (interface{}, string, error) {
			detail, err := workloads.NewDaemonSetService(deps).DaemonSet(namespace, name)
			return detail, "", err
		},
	},
	"statefulset": {
		withDeps: func(deps common.Dependencies, namespace, name string) (interface{}, string, error) {
			detail, err := workloads.NewStatefulSetService(deps).StatefulSet(namespace, name)
			return detail, "", err
		},
	},
	"job": {
		withDeps: func(deps common.Dependencies, namespace, name string) (interface{}, string, error) {
			detail, err := workloads.NewJobService(deps).Job(namespace, name)
			return detail, "", err
		},
	},
	"cronjob": {
		withDeps: func(deps common.Dependencies, namespace, name string) (interface{}, string, error) {
			detail, err := workloads.NewCronJobService(deps).CronJob(namespace, name)
			return detail, "", err
		},
	},
	"configmap": {
		withDeps: func(deps common.Dependencies, namespace, name string) (interface{}, string, error) {
			detail, err := config.NewService(deps).ConfigMap(namespace, name)
			return detail, "", err
		},
	},
	"secret": {
		withDeps: func(deps common.Dependencies, namespace, name string) (interface{}, string, error) {
			detail, err := config.NewService(deps).Secret(namespace, name)
			return detail, "", err
		},
	},
	"helmrelease": {
		withDeps: func(deps common.Dependencies, namespace, name string) (interface{}, string, error) {
			detail, err := helm.NewService(helm.Dependencies{Common: deps}).ReleaseDetails(namespace, name)
			return detail, "", err
		},
	},
	"service": {
		withDeps: func(deps common.Dependencies, namespace, name string) (interface{}, string, error) {
			detail, err := network.NewService(deps).GetService(namespace, name)
			return detail, "", err
		},
	},
	"ingress": {
		withDeps: func(deps common.Dependencies, namespace, name string) (interface{}, string, error) {
			detail, err := network.NewService(deps).Ingress(namespace, name)
			return detail, "", err
		},
	},
	"networkpolicy": {
		withDeps: func(deps common.Dependencies, namespace, name string) (interface{}, string, error) {
			detail, err := network.NewService(deps).NetworkPolicy(namespace, name)
			return detail, "", err
		},
	},
	"endpointslice": {
		withDeps: func(deps common.Dependencies, namespace, name string) (interface{}, string, error) {
			detail, err := network.NewService(deps).EndpointSlice(namespace, name)
			return detail, "", err
		},
	},
	"persistentvolumeclaim": {
		withDeps: func(deps common.Dependencies, namespace, name string) (interface{}, string, error) {
			detail, err := storage.NewService(deps).PersistentVolumeClaim(namespace, name)
			return detail, "", err
		},
	},
	"persistentvolume": {
		withDeps: func(deps common.Dependencies, _ string, name string) (interface{}, string, error) {
			detail, err := storage.NewService(deps).PersistentVolume(name)
			return detail, "", err
		},
	},
	"storageclass": {
		withDeps: func(deps common.Dependencies, _ string, name string) (interface{}, string, error) {
			detail, err := storage.NewService(deps).StorageClass(name)
			return detail, "", err
		},
	},
	"serviceaccount": {
		withDeps: func(deps common.Dependencies, namespace, name string) (interface{}, string, error) {
			detail, err := rbac.NewService(deps).ServiceAccount(namespace, name)
			return detail, "", err
		},
	},
	"role": {
		withDeps: func(deps common.Dependencies, namespace, name string) (interface{}, string, error) {
			detail, err := rbac.NewService(deps).Role(namespace, name)
			return detail, "", err
		},
	},
	"rolebinding": {
		withDeps: func(deps common.Dependencies, namespace, name string) (interface{}, string, error) {
			detail, err := rbac.NewService(deps).RoleBinding(namespace, name)
			return detail, "", err
		},
	},
	"clusterrole": {
		withDeps: func(deps common.Dependencies, _ string, name string) (interface{}, string, error) {
			detail, err := rbac.NewService(deps).ClusterRole(name)
			return detail, "", err
		},
	},
	"clusterrolebinding": {
		withDeps: func(deps common.Dependencies, _ string, name string) (interface{}, string, error) {
			detail, err := rbac.NewService(deps).ClusterRoleBinding(name)
			return detail, "", err
		},
	},
	"resourcequota": {
		withDeps: func(deps common.Dependencies, namespace, name string) (interface{}, string, error) {
			detail, err := constraints.NewService(deps).ResourceQuota(namespace, name)
			return detail, "", err
		},
	},
	"limitrange": {
		withDeps: func(deps common.Dependencies, namespace, name string) (interface{}, string, error) {
			detail, err := constraints.NewService(deps).LimitRange(namespace, name)
			return detail, "", err
		},
	},
	"horizontalpodautoscaler": {
		withDeps: func(deps common.Dependencies, namespace, name string) (interface{}, string, error) {
			detail, err := autoscaling.NewService(deps).HorizontalPodAutoscaler(namespace, name)
			return detail, "", err
		},
	},
	"poddisruptionbudget": {
		withDeps: func(deps common.Dependencies, namespace, name string) (interface{}, string, error) {
			detail, err := policy.NewService(deps).PodDisruptionBudget(namespace, name)
			return detail, "", err
		},
	},
	"namespace": {
		withDeps: func(deps common.Dependencies, _ string, name string) (interface{}, string, error) {
			detail, err := namespaces.NewService(deps).Namespace(name)
			return detail, "", err
		},
	},
	"node": {
		withDeps: func(deps common.Dependencies, _ string, name string) (interface{}, string, error) {
			detail, err := nodes.NewService(deps).Node(name)
			return detail, "", err
		},
	},
	"ingressclass": {
		withDeps: func(deps common.Dependencies, _ string, name string) (interface{}, string, error) {
			detail, err := network.NewService(deps).IngressClass(name)
			return detail, "", err
		},
	},
	"customresourcedefinition": {
		withDeps: func(deps common.Dependencies, _ string, name string) (interface{}, string, error) {
			detail, err := apiextensions.NewService(deps).CustomResourceDefinition(name)
			return detail, "", err
		},
	},
	"mutatingwebhookconfiguration": {
		withDeps: func(deps common.Dependencies, _ string, name string) (interface{}, string, error) {
			detail, err := admission.NewService(deps).MutatingWebhookConfiguration(name)
			return detail, "", err
		},
	},
	"validatingwebhookconfiguration": {
		withDeps: func(deps common.Dependencies, _ string, name string) (interface{}, string, error) {
			detail, err := admission.NewService(deps).ValidatingWebhookConfiguration(name)
			return detail, "", err
		},
	},
}

// lookupObjectDetailFetcher normalizes the kind and returns the configured fetcher.
func lookupObjectDetailFetcher(kind string) (objectDetailFetcher, bool) {
	normalized := strings.ToLower(strings.TrimSpace(kind))
	fetcher, ok := objectDetailFetchers[normalized]
	return fetcher, ok
}

// FetchObjectDetails retrieves the details of a Kubernetes object.
func (p *objectDetailProvider) FetchObjectDetails(ctx context.Context, kind, namespace, name string) (interface{}, string, error) {
	resolved := p.resolveDetailContext(ctx)
	fetcher, ok := lookupObjectDetailFetcher(kind)
	if !ok {
		return nil, "", snapshot.ErrObjectDetailNotImplemented
	}
	if !resolved.scoped {
		return nil, "", fmt.Errorf("cluster scope is required")
	}

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
	detail, version, err := fetcher.withDeps(resolved.deps, namespace, name)
	if err == nil && p != nil && p.app != nil {
		p.app.responseCacheStore(resolved.selectionKey, cacheKey, detail)
	}
	return detail, version, err
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
		deps:         common.Dependencies{Context: ctx},
		selectionKey: "",
		scoped:       false,
	}
}

// FetchObjectYAML retrieves the YAML representation of a Kubernetes object.
func (p *objectDetailProvider) FetchObjectYAML(ctx context.Context, kind, namespace, name string) (string, error) {
	resolved := p.resolveDetailContext(ctx)
	if !resolved.scoped {
		return "", fmt.Errorf("cluster scope is required")
	}
	if p == nil || p.app == nil {
		return getObjectYAMLWithDependencies(resolved.deps, resolved.selectionKey, kind, namespace, name)
	}
	return p.app.getObjectYAMLWithCache(resolved.deps, resolved.selectionKey, kind, namespace, name)
}

// FetchHelmManifest retrieves the manifest for a Helm release.
func (p *objectDetailProvider) FetchHelmManifest(ctx context.Context, namespace, name string) (string, int, error) {
	resolved := p.resolveDetailContext(ctx)
	if !resolved.scoped {
		return "", 0, fmt.Errorf("cluster scope is required")
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

// FetchHelmValues retrieves the values for a Helm release.
func (p *objectDetailProvider) FetchHelmValues(ctx context.Context, namespace, name string) (map[string]interface{}, int, error) {
	resolved := p.resolveDetailContext(ctx)
	if !resolved.scoped {
		return nil, 0, fmt.Errorf("cluster scope is required")
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
