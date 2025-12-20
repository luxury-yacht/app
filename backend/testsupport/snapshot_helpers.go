package testsupport

import (
	"testing"

	admissionv1 "k8s.io/api/admissionregistration/v1"
	appsv1 "k8s.io/api/apps/v1"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	networkingv1 "k8s.io/api/networking/v1"
	policyv1 "k8s.io/api/policy/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	storagev1 "k8s.io/api/storage/v1"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	"k8s.io/client-go/tools/cache"

	apiextlisters "k8s.io/apiextensions-apiserver/pkg/client/listers/apiextensions/v1"
	admissionlisters "k8s.io/client-go/listers/admissionregistration/v1"
	appslisters "k8s.io/client-go/listers/apps/v1"
	autoscalinglisters "k8s.io/client-go/listers/autoscaling/v1"
	batchlisters "k8s.io/client-go/listers/batch/v1"
	corelisters "k8s.io/client-go/listers/core/v1"
	discoverylisters "k8s.io/client-go/listers/discovery/v1"
	networklisters "k8s.io/client-go/listers/networking/v1"
	policylisters "k8s.io/client-go/listers/policy/v1"
	rbaclisters "k8s.io/client-go/listers/rbac/v1"
	storagelisters "k8s.io/client-go/listers/storage/v1"
)

// NewPodLister constructs a pod lister backed by an in-memory indexer populated
// with the supplied pod objects.
func NewPodLister(t testing.TB, pods ...*corev1.Pod) corelisters.PodLister {
	t.Helper()

	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc})
	for _, pod := range pods {
		if pod == nil {
			continue
		}
		if err := indexer.Add(pod); err != nil {
			t.Fatalf("failed to add pod %s/%s to indexer: %v", pod.Namespace, pod.Name, err)
		}
	}
	return corelisters.NewPodLister(indexer)
}

// NewReplicaSetLister constructs a ReplicaSet lister backed by an in-memory
// indexer populated with the supplied ReplicaSet objects.
func NewReplicaSetLister(t testing.TB, replicaSets ...*appsv1.ReplicaSet) appslisters.ReplicaSetLister {
	t.Helper()

	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc})
	for _, rs := range replicaSets {
		if rs == nil {
			continue
		}
		if err := indexer.Add(rs); err != nil {
			t.Fatalf("failed to add replicaset %s/%s to indexer: %v", rs.Namespace, rs.Name, err)
		}
	}
	return appslisters.NewReplicaSetLister(indexer)
}

// NewNamespaceLister constructs a namespace lister backed by an indexer containing the supplied namespaces.
func NewNamespaceLister(t testing.TB, namespaces ...*corev1.Namespace) corelisters.NamespaceLister {
	t.Helper()

	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{})
	for _, ns := range namespaces {
		if ns == nil {
			continue
		}
		if err := indexer.Add(ns); err != nil {
			t.Fatalf("failed to add namespace %s to indexer: %v", ns.Name, err)
		}
	}
	return corelisters.NewNamespaceLister(indexer)
}

// NewNodeLister constructs a node lister backed by an indexer containing the supplied nodes.
func NewNodeLister(t testing.TB, nodes ...*corev1.Node) corelisters.NodeLister {
	t.Helper()

	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{})
	for _, node := range nodes {
		if node == nil {
			continue
		}
		if err := indexer.Add(node); err != nil {
			t.Fatalf("failed to add node %s to indexer: %v", node.Name, err)
		}
	}
	return corelisters.NewNodeLister(indexer)
}

// NewEventLister constructs an event lister backed by an indexer containing the supplied events.
func NewEventLister(t testing.TB, events ...*corev1.Event) corelisters.EventLister {
	t.Helper()

	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc})
	for _, event := range events {
		if event == nil {
			continue
		}
		if err := indexer.Add(event); err != nil {
			t.Fatalf("failed to add event %s/%s to indexer: %v", event.Namespace, event.Name, err)
		}
	}
	return corelisters.NewEventLister(indexer)
}

// NewConfigMapLister constructs a ConfigMap lister backed by an indexer containing the supplied config maps.
func NewConfigMapLister(t testing.TB, configMaps ...*corev1.ConfigMap) corelisters.ConfigMapLister {
	t.Helper()

	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc})
	for _, cm := range configMaps {
		if cm == nil {
			continue
		}
		if err := indexer.Add(cm); err != nil {
			t.Fatalf("failed to add configmap %s/%s to indexer: %v", cm.Namespace, cm.Name, err)
		}
	}
	return corelisters.NewConfigMapLister(indexer)
}

// NewSecretLister constructs a Secret lister backed by an indexer containing the supplied secrets.
func NewSecretLister(t testing.TB, secrets ...*corev1.Secret) corelisters.SecretLister {
	t.Helper()

	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc})
	for _, secret := range secrets {
		if secret == nil {
			continue
		}
		if err := indexer.Add(secret); err != nil {
			t.Fatalf("failed to add secret %s/%s to indexer: %v", secret.Namespace, secret.Name, err)
		}
	}
	return corelisters.NewSecretLister(indexer)
}

// NewServiceLister constructs a Service lister backed by an indexer containing the supplied services.
func NewServiceLister(t testing.TB, services ...*corev1.Service) corelisters.ServiceLister {
	t.Helper()

	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc})
	for _, svc := range services {
		if svc == nil {
			continue
		}
		if err := indexer.Add(svc); err != nil {
			t.Fatalf("failed to add service %s/%s to indexer: %v", svc.Namespace, svc.Name, err)
		}
	}
	return corelisters.NewServiceLister(indexer)
}

// NewEndpointSliceLister constructs an EndpointSlice lister backed by an indexer containing the supplied slices.
func NewEndpointSliceLister(t testing.TB, slices ...*discoveryv1.EndpointSlice) discoverylisters.EndpointSliceLister {
	t.Helper()

	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc})
	for _, slice := range slices {
		if slice == nil {
			continue
		}
		if err := indexer.Add(slice); err != nil {
			t.Fatalf("failed to add endpointslice %s/%s to indexer: %v", slice.Namespace, slice.Name, err)
		}
	}
	return discoverylisters.NewEndpointSliceLister(indexer)
}

// NewIngressLister constructs an Ingress lister backed by an indexer containing the supplied ingresses.
func NewIngressLister(t testing.TB, ingresses ...*networkingv1.Ingress) networklisters.IngressLister {
	t.Helper()

	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc})
	for _, ing := range ingresses {
		if ing == nil {
			continue
		}
		if err := indexer.Add(ing); err != nil {
			t.Fatalf("failed to add ingress %s/%s to indexer: %v", ing.Namespace, ing.Name, err)
		}
	}
	return networklisters.NewIngressLister(indexer)
}

// NewNetworkPolicyLister constructs a NetworkPolicy lister backed by an indexer containing the supplied policies.
func NewNetworkPolicyLister(t testing.TB, policies ...*networkingv1.NetworkPolicy) networklisters.NetworkPolicyLister {
	t.Helper()

	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc})
	for _, policy := range policies {
		if policy == nil {
			continue
		}
		if err := indexer.Add(policy); err != nil {
			t.Fatalf("failed to add network policy %s/%s to indexer: %v", policy.Namespace, policy.Name, err)
		}
	}
	return networklisters.NewNetworkPolicyLister(indexer)
}

// NewPersistentVolumeClaimLister constructs a PVC lister backed by an indexer containing the supplied PVCs.
func NewPersistentVolumeClaimLister(t testing.TB, pvcs ...*corev1.PersistentVolumeClaim) corelisters.PersistentVolumeClaimLister {
	t.Helper()

	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc})
	for _, pvc := range pvcs {
		if pvc == nil {
			continue
		}
		if err := indexer.Add(pvc); err != nil {
			t.Fatalf("failed to add pvc %s/%s to indexer: %v", pvc.Namespace, pvc.Name, err)
		}
	}
	return corelisters.NewPersistentVolumeClaimLister(indexer)
}

// NewResourceQuotaLister constructs a ResourceQuota lister backed by an indexer.
func NewResourceQuotaLister(t testing.TB, quotas ...*corev1.ResourceQuota) corelisters.ResourceQuotaLister {
	t.Helper()

	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc})
	for _, quota := range quotas {
		if quota == nil {
			continue
		}
		if err := indexer.Add(quota); err != nil {
			t.Fatalf("failed to add resource quota %s/%s to indexer: %v", quota.Namespace, quota.Name, err)
		}
	}
	return corelisters.NewResourceQuotaLister(indexer)
}

// NewLimitRangeLister constructs a LimitRange lister backed by an indexer.
func NewLimitRangeLister(t testing.TB, limits ...*corev1.LimitRange) corelisters.LimitRangeLister {
	t.Helper()

	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc})
	for _, limit := range limits {
		if limit == nil {
			continue
		}
		if err := indexer.Add(limit); err != nil {
			t.Fatalf("failed to add limit range %s/%s to indexer: %v", limit.Namespace, limit.Name, err)
		}
	}
	return corelisters.NewLimitRangeLister(indexer)
}

// NewPodDisruptionBudgetLister constructs a PDB lister backed by an indexer.
func NewPodDisruptionBudgetLister(
	t testing.TB,
	budgets ...*policyv1.PodDisruptionBudget,
) policylisters.PodDisruptionBudgetLister {
	t.Helper()

	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc})
	for _, budget := range budgets {
		if budget == nil {
			continue
		}
		if err := indexer.Add(budget); err != nil {
			t.Fatalf("failed to add pod disruption budget %s/%s to indexer: %v", budget.Namespace, budget.Name, err)
		}
	}
	return policylisters.NewPodDisruptionBudgetLister(indexer)
}

// NewHorizontalPodAutoscalerLister constructs an HPA lister backed by an indexer.
func NewHorizontalPodAutoscalerLister(t testing.TB, hpas ...*autoscalingv1.HorizontalPodAutoscaler) autoscalinglisters.HorizontalPodAutoscalerLister {
	t.Helper()

	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc})
	for _, hpa := range hpas {
		if hpa == nil {
			continue
		}
		if err := indexer.Add(hpa); err != nil {
			t.Fatalf("failed to add HPA %s/%s to indexer: %v", hpa.Namespace, hpa.Name, err)
		}
	}
	return autoscalinglisters.NewHorizontalPodAutoscalerLister(indexer)
}

// NewDeploymentLister constructs a Deployment lister backed by an indexer.
func NewDeploymentLister(t testing.TB, deployments ...*appsv1.Deployment) appslisters.DeploymentLister {
	t.Helper()

	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc})
	for _, deployment := range deployments {
		if deployment == nil {
			continue
		}
		if err := indexer.Add(deployment); err != nil {
			t.Fatalf("failed to add deployment %s/%s to indexer: %v", deployment.Namespace, deployment.Name, err)
		}
	}
	return appslisters.NewDeploymentLister(indexer)
}

// NewStatefulSetLister constructs a StatefulSet lister backed by an indexer.
func NewStatefulSetLister(t testing.TB, sets ...*appsv1.StatefulSet) appslisters.StatefulSetLister {
	t.Helper()

	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc})
	for _, set := range sets {
		if set == nil {
			continue
		}
		if err := indexer.Add(set); err != nil {
			t.Fatalf("failed to add statefulset %s/%s to indexer: %v", set.Namespace, set.Name, err)
		}
	}
	return appslisters.NewStatefulSetLister(indexer)
}

// NewDaemonSetLister constructs a DaemonSet lister backed by an indexer.
func NewDaemonSetLister(t testing.TB, sets ...*appsv1.DaemonSet) appslisters.DaemonSetLister {
	t.Helper()

	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc})
	for _, set := range sets {
		if set == nil {
			continue
		}
		if err := indexer.Add(set); err != nil {
			t.Fatalf("failed to add daemonset %s/%s to indexer: %v", set.Namespace, set.Name, err)
		}
	}
	return appslisters.NewDaemonSetLister(indexer)
}

// NewJobLister constructs a Job lister backed by an indexer.
func NewJobLister(t testing.TB, jobs ...*batchv1.Job) batchlisters.JobLister {
	t.Helper()

	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc})
	for _, job := range jobs {
		if job == nil {
			continue
		}
		if err := indexer.Add(job); err != nil {
			t.Fatalf("failed to add job %s/%s to indexer: %v", job.Namespace, job.Name, err)
		}
	}
	return batchlisters.NewJobLister(indexer)
}

// NewCronJobLister constructs a CronJob lister backed by an indexer.
func NewCronJobLister(t testing.TB, cronJobs ...*batchv1.CronJob) batchlisters.CronJobLister {
	t.Helper()

	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc})
	for _, cron := range cronJobs {
		if cron == nil {
			continue
		}
		if err := indexer.Add(cron); err != nil {
			t.Fatalf("failed to add cronjob %s/%s to indexer: %v", cron.Namespace, cron.Name, err)
		}
	}
	return batchlisters.NewCronJobLister(indexer)
}

// NewRoleLister constructs a Role lister backed by an indexer.
func NewRoleLister(t testing.TB, roles ...*rbacv1.Role) rbaclisters.RoleLister {
	t.Helper()

	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc})
	for _, role := range roles {
		if role == nil {
			continue
		}
		if err := indexer.Add(role); err != nil {
			t.Fatalf("failed to add role %s/%s to indexer: %v", role.Namespace, role.Name, err)
		}
	}
	return rbaclisters.NewRoleLister(indexer)
}

// NewRoleBindingLister constructs a RoleBinding lister backed by an indexer.
func NewRoleBindingLister(t testing.TB, bindings ...*rbacv1.RoleBinding) rbaclisters.RoleBindingLister {
	t.Helper()

	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc})
	for _, binding := range bindings {
		if binding == nil {
			continue
		}
		if err := indexer.Add(binding); err != nil {
			t.Fatalf("failed to add role binding %s/%s to indexer: %v", binding.Namespace, binding.Name, err)
		}
	}
	return rbaclisters.NewRoleBindingLister(indexer)
}

// NewServiceAccountLister constructs a ServiceAccount lister backed by an indexer.
func NewServiceAccountLister(t testing.TB, serviceAccounts ...*corev1.ServiceAccount) corelisters.ServiceAccountLister {
	t.Helper()

	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc})
	for _, sa := range serviceAccounts {
		if sa == nil {
			continue
		}
		if err := indexer.Add(sa); err != nil {
			t.Fatalf("failed to add service account %s/%s to indexer: %v", sa.Namespace, sa.Name, err)
		}
	}
	return corelisters.NewServiceAccountLister(indexer)
}

// NewStorageClassLister constructs a StorageClass lister backed by an indexer containing the supplied classes.
func NewStorageClassLister(t testing.TB, classes ...*storagev1.StorageClass) storagelisters.StorageClassLister {
	t.Helper()

	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{})
	for _, class := range classes {
		if class == nil {
			continue
		}
		if err := indexer.Add(class); err != nil {
			t.Fatalf("failed to add storage class %s to indexer: %v", class.Name, err)
		}
	}
	return storagelisters.NewStorageClassLister(indexer)
}

// NewIngressClassLister constructs an IngressClass lister backed by an indexer containing the supplied classes.
func NewIngressClassLister(t testing.TB, classes ...*networkingv1.IngressClass) networklisters.IngressClassLister {
	t.Helper()

	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{})
	for _, class := range classes {
		if class == nil {
			continue
		}
		if err := indexer.Add(class); err != nil {
			t.Fatalf("failed to add ingress class %s to indexer: %v", class.Name, err)
		}
	}
	return networklisters.NewIngressClassLister(indexer)
}

// NewValidatingWebhookLister constructs a ValidatingWebhookConfiguration lister backed by an indexer.
func NewValidatingWebhookLister(t testing.TB, configs ...*admissionv1.ValidatingWebhookConfiguration) admissionlisters.ValidatingWebhookConfigurationLister {
	t.Helper()

	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{})
	for _, cfg := range configs {
		if cfg == nil {
			continue
		}
		if err := indexer.Add(cfg); err != nil {
			t.Fatalf("failed to add validating webhook %s to indexer: %v", cfg.Name, err)
		}
	}
	return admissionlisters.NewValidatingWebhookConfigurationLister(indexer)
}

// NewMutatingWebhookLister constructs a MutatingWebhookConfiguration lister backed by an indexer.
func NewMutatingWebhookLister(t testing.TB, configs ...*admissionv1.MutatingWebhookConfiguration) admissionlisters.MutatingWebhookConfigurationLister {
	t.Helper()

	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{})
	for _, cfg := range configs {
		if cfg == nil {
			continue
		}
		if err := indexer.Add(cfg); err != nil {
			t.Fatalf("failed to add mutating webhook %s to indexer: %v", cfg.Name, err)
		}
	}
	return admissionlisters.NewMutatingWebhookConfigurationLister(indexer)
}

// NewPersistentVolumeLister constructs a PersistentVolume lister backed by an indexer containing the supplied PVs.
func NewPersistentVolumeLister(t testing.TB, volumes ...*corev1.PersistentVolume) corelisters.PersistentVolumeLister {
	t.Helper()

	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{})
	for _, pv := range volumes {
		if pv == nil {
			continue
		}
		if err := indexer.Add(pv); err != nil {
			t.Fatalf("failed to add persistent volume %s to indexer: %v", pv.Name, err)
		}
	}
	return corelisters.NewPersistentVolumeLister(indexer)
}

// NewCRDLister constructs a CustomResourceDefinition lister backed by an indexer containing the supplied CRDs.
func NewCRDLister(t testing.TB, crds ...*apiextensionsv1.CustomResourceDefinition) apiextlisters.CustomResourceDefinitionLister {
	t.Helper()

	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{})
	for _, crd := range crds {
		if crd == nil {
			continue
		}
		if err := indexer.Add(crd); err != nil {
			t.Fatalf("failed to add CRD %s to indexer: %v", crd.Name, err)
		}
	}
	return apiextlisters.NewCustomResourceDefinitionLister(indexer)
}

// NewClusterRoleLister constructs a cluster role lister backed by an indexer containing the supplied roles.
func NewClusterRoleLister(t testing.TB, roles ...*rbacv1.ClusterRole) rbaclisters.ClusterRoleLister {
	t.Helper()

	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{})
	for _, role := range roles {
		if role == nil {
			continue
		}
		if err := indexer.Add(role); err != nil {
			t.Fatalf("failed to add cluster role %s to indexer: %v", role.Name, err)
		}
	}
	return rbaclisters.NewClusterRoleLister(indexer)
}

// NewClusterRoleBindingLister constructs a cluster role binding lister backed by an indexer containing the supplied bindings.
func NewClusterRoleBindingLister(t testing.TB, bindings ...*rbacv1.ClusterRoleBinding) rbaclisters.ClusterRoleBindingLister {
	t.Helper()

	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{})
	for _, binding := range bindings {
		if binding == nil {
			continue
		}
		if err := indexer.Add(binding); err != nil {
			t.Fatalf("failed to add cluster role binding %s to indexer: %v", binding.Name, err)
		}
	}
	return rbaclisters.NewClusterRoleBindingLister(indexer)
}
