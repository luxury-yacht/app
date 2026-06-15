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

// buildIndexer populates an in-memory indexer with the supplied objects, shared
// by every New<Kind>Lister test helper.
func buildIndexer[T any](t testing.TB, indexers cache.Indexers, objs []*T) cache.Indexer {
	t.Helper()
	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, indexers)
	for _, obj := range objs {
		if obj == nil {
			continue
		}
		if err := indexer.Add(obj); err != nil {
			t.Fatalf("failed to add object to indexer: %v", err)
		}
	}
	return indexer
}

func newNamespacedIndexer[T any](t testing.TB, objs []*T) cache.Indexer {
	return buildIndexer(t, cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc}, objs)
}

func newClusterIndexer[T any](t testing.TB, objs []*T) cache.Indexer {
	return buildIndexer(t, cache.Indexers{}, objs)
}

// NewPodLister constructs a pod lister backed by an in-memory indexer populated
// with the supplied pod objects.
func NewPodLister(t testing.TB, pods ...*corev1.Pod) corelisters.PodLister {
	return corelisters.NewPodLister(newNamespacedIndexer(t, pods))
}

// NewReplicaSetLister constructs a ReplicaSet lister backed by an in-memory
// indexer populated with the supplied ReplicaSet objects.
func NewReplicaSetLister(t testing.TB, replicaSets ...*appsv1.ReplicaSet) appslisters.ReplicaSetLister {
	return appslisters.NewReplicaSetLister(newNamespacedIndexer(t, replicaSets))
}

// NewNamespaceLister constructs a namespace lister backed by an indexer containing the supplied namespaces.
func NewNamespaceLister(t testing.TB, namespaces ...*corev1.Namespace) corelisters.NamespaceLister {
	return corelisters.NewNamespaceLister(newClusterIndexer(t, namespaces))
}

// NewNodeLister constructs a node lister backed by an indexer containing the supplied nodes.
func NewNodeLister(t testing.TB, nodes ...*corev1.Node) corelisters.NodeLister {
	return corelisters.NewNodeLister(newClusterIndexer(t, nodes))
}

// NewEventLister constructs an event lister backed by an indexer containing the supplied events.
func NewEventLister(t testing.TB, events ...*corev1.Event) corelisters.EventLister {
	return corelisters.NewEventLister(newNamespacedIndexer(t, events))
}

// NewConfigMapLister constructs a ConfigMap lister backed by an indexer containing the supplied config maps.
func NewConfigMapLister(t testing.TB, configMaps ...*corev1.ConfigMap) corelisters.ConfigMapLister {
	return corelisters.NewConfigMapLister(newNamespacedIndexer(t, configMaps))
}

// NewSecretLister constructs a Secret lister backed by an indexer containing the supplied secrets.
func NewSecretLister(t testing.TB, secrets ...*corev1.Secret) corelisters.SecretLister {
	return corelisters.NewSecretLister(newNamespacedIndexer(t, secrets))
}

// NewServiceLister constructs a Service lister backed by an indexer containing the supplied services.
func NewServiceLister(t testing.TB, services ...*corev1.Service) corelisters.ServiceLister {
	return corelisters.NewServiceLister(newNamespacedIndexer(t, services))
}

// NewEndpointSliceLister constructs an EndpointSlice lister backed by an indexer containing the supplied slices.
func NewEndpointSliceLister(t testing.TB, slices ...*discoveryv1.EndpointSlice) discoverylisters.EndpointSliceLister {
	return discoverylisters.NewEndpointSliceLister(newNamespacedIndexer(t, slices))
}

// NewIngressLister constructs an Ingress lister backed by an indexer containing the supplied ingresses.
func NewIngressLister(t testing.TB, ingresses ...*networkingv1.Ingress) networklisters.IngressLister {
	return networklisters.NewIngressLister(newNamespacedIndexer(t, ingresses))
}

// NewNetworkPolicyLister constructs a NetworkPolicy lister backed by an indexer containing the supplied policies.
func NewNetworkPolicyLister(t testing.TB, policies ...*networkingv1.NetworkPolicy) networklisters.NetworkPolicyLister {
	return networklisters.NewNetworkPolicyLister(newNamespacedIndexer(t, policies))
}

// NewPersistentVolumeClaimLister constructs a PVC lister backed by an indexer containing the supplied PVCs.
func NewPersistentVolumeClaimLister(t testing.TB, pvcs ...*corev1.PersistentVolumeClaim) corelisters.PersistentVolumeClaimLister {
	return corelisters.NewPersistentVolumeClaimLister(newNamespacedIndexer(t, pvcs))
}

// NewResourceQuotaLister constructs a ResourceQuota lister backed by an indexer.
func NewResourceQuotaLister(t testing.TB, quotas ...*corev1.ResourceQuota) corelisters.ResourceQuotaLister {
	return corelisters.NewResourceQuotaLister(newNamespacedIndexer(t, quotas))
}

// NewLimitRangeLister constructs a LimitRange lister backed by an indexer.
func NewLimitRangeLister(t testing.TB, limits ...*corev1.LimitRange) corelisters.LimitRangeLister {
	return corelisters.NewLimitRangeLister(newNamespacedIndexer(t, limits))
}

// NewPodDisruptionBudgetLister constructs a PDB lister backed by an indexer.
func NewPodDisruptionBudgetLister(
	t testing.TB,
	budgets ...*policyv1.PodDisruptionBudget,
) policylisters.PodDisruptionBudgetLister {
	return policylisters.NewPodDisruptionBudgetLister(newNamespacedIndexer(t, budgets))
}

// NewHorizontalPodAutoscalerLister constructs an HPA lister backed by an indexer.
func NewHorizontalPodAutoscalerLister(t testing.TB, hpas ...*autoscalingv1.HorizontalPodAutoscaler) autoscalinglisters.HorizontalPodAutoscalerLister {
	return autoscalinglisters.NewHorizontalPodAutoscalerLister(newNamespacedIndexer(t, hpas))
}

// NewDeploymentLister constructs a Deployment lister backed by an indexer.
func NewDeploymentLister(t testing.TB, deployments ...*appsv1.Deployment) appslisters.DeploymentLister {
	return appslisters.NewDeploymentLister(newNamespacedIndexer(t, deployments))
}

// NewStatefulSetLister constructs a StatefulSet lister backed by an indexer.
func NewStatefulSetLister(t testing.TB, sets ...*appsv1.StatefulSet) appslisters.StatefulSetLister {
	return appslisters.NewStatefulSetLister(newNamespacedIndexer(t, sets))
}

// NewDaemonSetLister constructs a DaemonSet lister backed by an indexer.
func NewDaemonSetLister(t testing.TB, sets ...*appsv1.DaemonSet) appslisters.DaemonSetLister {
	return appslisters.NewDaemonSetLister(newNamespacedIndexer(t, sets))
}

// NewJobLister constructs a Job lister backed by an indexer.
func NewJobLister(t testing.TB, jobs ...*batchv1.Job) batchlisters.JobLister {
	return batchlisters.NewJobLister(newNamespacedIndexer(t, jobs))
}

// NewCronJobLister constructs a CronJob lister backed by an indexer.
func NewCronJobLister(t testing.TB, cronJobs ...*batchv1.CronJob) batchlisters.CronJobLister {
	return batchlisters.NewCronJobLister(newNamespacedIndexer(t, cronJobs))
}

// NewRoleLister constructs a Role lister backed by an indexer.
func NewRoleLister(t testing.TB, roles ...*rbacv1.Role) rbaclisters.RoleLister {
	return rbaclisters.NewRoleLister(newNamespacedIndexer(t, roles))
}

// NewRoleBindingLister constructs a RoleBinding lister backed by an indexer.
func NewRoleBindingLister(t testing.TB, bindings ...*rbacv1.RoleBinding) rbaclisters.RoleBindingLister {
	return rbaclisters.NewRoleBindingLister(newNamespacedIndexer(t, bindings))
}

// NewServiceAccountLister constructs a ServiceAccount lister backed by an indexer.
func NewServiceAccountLister(t testing.TB, serviceAccounts ...*corev1.ServiceAccount) corelisters.ServiceAccountLister {
	return corelisters.NewServiceAccountLister(newNamespacedIndexer(t, serviceAccounts))
}

// NewStorageClassLister constructs a StorageClass lister backed by an indexer containing the supplied classes.
func NewStorageClassLister(t testing.TB, classes ...*storagev1.StorageClass) storagelisters.StorageClassLister {
	return storagelisters.NewStorageClassLister(newClusterIndexer(t, classes))
}

// NewIngressClassLister constructs an IngressClass lister backed by an indexer containing the supplied classes.
func NewIngressClassLister(t testing.TB, classes ...*networkingv1.IngressClass) networklisters.IngressClassLister {
	return networklisters.NewIngressClassLister(newClusterIndexer(t, classes))
}

// NewValidatingWebhookLister constructs a ValidatingWebhookConfiguration lister backed by an indexer.
func NewValidatingWebhookLister(t testing.TB, configs ...*admissionv1.ValidatingWebhookConfiguration) admissionlisters.ValidatingWebhookConfigurationLister {
	return admissionlisters.NewValidatingWebhookConfigurationLister(newClusterIndexer(t, configs))
}

// NewMutatingWebhookLister constructs a MutatingWebhookConfiguration lister backed by an indexer.
func NewMutatingWebhookLister(t testing.TB, configs ...*admissionv1.MutatingWebhookConfiguration) admissionlisters.MutatingWebhookConfigurationLister {
	return admissionlisters.NewMutatingWebhookConfigurationLister(newClusterIndexer(t, configs))
}

// NewPersistentVolumeLister constructs a PersistentVolume lister backed by an indexer containing the supplied PVs.
func NewPersistentVolumeLister(t testing.TB, volumes ...*corev1.PersistentVolume) corelisters.PersistentVolumeLister {
	return corelisters.NewPersistentVolumeLister(newClusterIndexer(t, volumes))
}

// NewCRDLister constructs a CustomResourceDefinition lister backed by an indexer containing the supplied CRDs.
func NewCRDLister(t testing.TB, crds ...*apiextensionsv1.CustomResourceDefinition) apiextlisters.CustomResourceDefinitionLister {
	return apiextlisters.NewCustomResourceDefinitionLister(newClusterIndexer(t, crds))
}

// NewClusterRoleLister constructs a cluster role lister backed by an indexer containing the supplied roles.
func NewClusterRoleLister(t testing.TB, roles ...*rbacv1.ClusterRole) rbaclisters.ClusterRoleLister {
	return rbaclisters.NewClusterRoleLister(newClusterIndexer(t, roles))
}

// NewClusterRoleBindingLister constructs a cluster role binding lister backed by an indexer containing the supplied bindings.
func NewClusterRoleBindingLister(t testing.TB, bindings ...*rbacv1.ClusterRoleBinding) rbaclisters.ClusterRoleBindingLister {
	return rbaclisters.NewClusterRoleBindingLister(newClusterIndexer(t, bindings))
}
