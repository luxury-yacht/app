/*
 * backend/objectcatalog/informer_registry.go
 *
 * Shared informer lister registry for catalog collection.
 */

package objectcatalog

import (
	appsv1 "k8s.io/api/apps/v1"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	networkingv1 "k8s.io/api/networking/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	storagev1 "k8s.io/api/storage/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime/schema"
	informers "k8s.io/client-go/informers"
)

// informerListFunc returns objects for a namespace (or cluster-wide when empty/all).
type informerListFunc func(namespace string) ([]metav1.Object, error)

// sharedInformerListers maps group resources to shared-informer-backed listers.
var sharedInformerListers = map[schema.GroupResource]func(factory informers.SharedInformerFactory) informerListFunc{
	{Group: "", Resource: "pods"}: func(factory informers.SharedInformerFactory) informerListFunc {
		lister := factory.Core().V1().Pods().Lister()
		return newNamespacedLister(
			func() ([]*corev1.Pod, error) { return lister.List(labels.Everything()) },
			func(ns string) ([]*corev1.Pod, error) { return lister.Pods(ns).List(labels.Everything()) },
		)
	},
	{Group: "apps", Resource: "deployments"}: func(factory informers.SharedInformerFactory) informerListFunc {
		lister := factory.Apps().V1().Deployments().Lister()
		return newNamespacedLister(
			func() ([]*appsv1.Deployment, error) { return lister.List(labels.Everything()) },
			func(ns string) ([]*appsv1.Deployment, error) { return lister.Deployments(ns).List(labels.Everything()) },
		)
	},
	{Group: "apps", Resource: "statefulsets"}: func(factory informers.SharedInformerFactory) informerListFunc {
		lister := factory.Apps().V1().StatefulSets().Lister()
		return newNamespacedLister(
			func() ([]*appsv1.StatefulSet, error) { return lister.List(labels.Everything()) },
			func(ns string) ([]*appsv1.StatefulSet, error) {
				return lister.StatefulSets(ns).List(labels.Everything())
			},
		)
	},
	{Group: "apps", Resource: "daemonsets"}: func(factory informers.SharedInformerFactory) informerListFunc {
		lister := factory.Apps().V1().DaemonSets().Lister()
		return newNamespacedLister(
			func() ([]*appsv1.DaemonSet, error) { return lister.List(labels.Everything()) },
			func(ns string) ([]*appsv1.DaemonSet, error) { return lister.DaemonSets(ns).List(labels.Everything()) },
		)
	},
	{Group: "apps", Resource: "replicasets"}: func(factory informers.SharedInformerFactory) informerListFunc {
		lister := factory.Apps().V1().ReplicaSets().Lister()
		return newNamespacedLister(
			func() ([]*appsv1.ReplicaSet, error) { return lister.List(labels.Everything()) },
			func(ns string) ([]*appsv1.ReplicaSet, error) { return lister.ReplicaSets(ns).List(labels.Everything()) },
		)
	},
	{Group: "batch", Resource: "jobs"}: func(factory informers.SharedInformerFactory) informerListFunc {
		lister := factory.Batch().V1().Jobs().Lister()
		return newNamespacedLister(
			func() ([]*batchv1.Job, error) { return lister.List(labels.Everything()) },
			func(ns string) ([]*batchv1.Job, error) { return lister.Jobs(ns).List(labels.Everything()) },
		)
	},
	{Group: "batch", Resource: "cronjobs"}: func(factory informers.SharedInformerFactory) informerListFunc {
		lister := factory.Batch().V1().CronJobs().Lister()
		return newNamespacedLister(
			func() ([]*batchv1.CronJob, error) { return lister.List(labels.Everything()) },
			func(ns string) ([]*batchv1.CronJob, error) { return lister.CronJobs(ns).List(labels.Everything()) },
		)
	},
	{Group: "", Resource: "services"}: func(factory informers.SharedInformerFactory) informerListFunc {
		lister := factory.Core().V1().Services().Lister()
		return newNamespacedLister(
			func() ([]*corev1.Service, error) { return lister.List(labels.Everything()) },
			func(ns string) ([]*corev1.Service, error) { return lister.Services(ns).List(labels.Everything()) },
		)
	},
	{Group: "discovery.k8s.io", Resource: "endpointslices"}: func(factory informers.SharedInformerFactory) informerListFunc {
		lister := factory.Discovery().V1().EndpointSlices().Lister()
		return newNamespacedLister(
			func() ([]*discoveryv1.EndpointSlice, error) { return lister.List(labels.Everything()) },
			func(ns string) ([]*discoveryv1.EndpointSlice, error) {
				return lister.EndpointSlices(ns).List(labels.Everything())
			},
		)
	},
	{Group: "", Resource: "configmaps"}: func(factory informers.SharedInformerFactory) informerListFunc {
		lister := factory.Core().V1().ConfigMaps().Lister()
		return newNamespacedLister(
			func() ([]*corev1.ConfigMap, error) { return lister.List(labels.Everything()) },
			func(ns string) ([]*corev1.ConfigMap, error) { return lister.ConfigMaps(ns).List(labels.Everything()) },
		)
	},
	{Group: "", Resource: "secrets"}: func(factory informers.SharedInformerFactory) informerListFunc {
		lister := factory.Core().V1().Secrets().Lister()
		return newNamespacedLister(
			func() ([]*corev1.Secret, error) { return lister.List(labels.Everything()) },
			func(ns string) ([]*corev1.Secret, error) { return lister.Secrets(ns).List(labels.Everything()) },
		)
	},
	{Group: "", Resource: "persistentvolumeclaims"}: func(factory informers.SharedInformerFactory) informerListFunc {
		lister := factory.Core().V1().PersistentVolumeClaims().Lister()
		return newNamespacedLister(
			func() ([]*corev1.PersistentVolumeClaim, error) { return lister.List(labels.Everything()) },
			func(ns string) ([]*corev1.PersistentVolumeClaim, error) {
				return lister.PersistentVolumeClaims(ns).List(labels.Everything())
			},
		)
	},
	{Group: "", Resource: "resourcequotas"}: func(factory informers.SharedInformerFactory) informerListFunc {
		lister := factory.Core().V1().ResourceQuotas().Lister()
		return newNamespacedLister(
			func() ([]*corev1.ResourceQuota, error) { return lister.List(labels.Everything()) },
			func(ns string) ([]*corev1.ResourceQuota, error) {
				return lister.ResourceQuotas(ns).List(labels.Everything())
			},
		)
	},
	{Group: "", Resource: "limitranges"}: func(factory informers.SharedInformerFactory) informerListFunc {
		lister := factory.Core().V1().LimitRanges().Lister()
		return newNamespacedLister(
			func() ([]*corev1.LimitRange, error) { return lister.List(labels.Everything()) },
			func(ns string) ([]*corev1.LimitRange, error) { return lister.LimitRanges(ns).List(labels.Everything()) },
		)
	},
	{Group: "networking.k8s.io", Resource: "ingresses"}: func(factory informers.SharedInformerFactory) informerListFunc {
		lister := factory.Networking().V1().Ingresses().Lister()
		return newNamespacedLister(
			func() ([]*networkingv1.Ingress, error) { return lister.List(labels.Everything()) },
			func(ns string) ([]*networkingv1.Ingress, error) {
				return lister.Ingresses(ns).List(labels.Everything())
			},
		)
	},
	{Group: "networking.k8s.io", Resource: "networkpolicies"}: func(factory informers.SharedInformerFactory) informerListFunc {
		lister := factory.Networking().V1().NetworkPolicies().Lister()
		return newNamespacedLister(
			func() ([]*networkingv1.NetworkPolicy, error) { return lister.List(labels.Everything()) },
			func(ns string) ([]*networkingv1.NetworkPolicy, error) {
				return lister.NetworkPolicies(ns).List(labels.Everything())
			},
		)
	},
	{Group: "autoscaling", Resource: "horizontalpodautoscalers"}: func(factory informers.SharedInformerFactory) informerListFunc {
		lister := factory.Autoscaling().V1().HorizontalPodAutoscalers().Lister()
		return newNamespacedLister(
			func() ([]*autoscalingv1.HorizontalPodAutoscaler, error) { return lister.List(labels.Everything()) },
			func(ns string) ([]*autoscalingv1.HorizontalPodAutoscaler, error) {
				return lister.HorizontalPodAutoscalers(ns).List(labels.Everything())
			},
		)
	},
	{Group: "rbac.authorization.k8s.io", Resource: "clusterroles"}: func(factory informers.SharedInformerFactory) informerListFunc {
		lister := factory.Rbac().V1().ClusterRoles().Lister()
		return newClusterLister(func() ([]*rbacv1.ClusterRole, error) { return lister.List(labels.Everything()) })
	},
	{Group: "rbac.authorization.k8s.io", Resource: "clusterrolebindings"}: func(factory informers.SharedInformerFactory) informerListFunc {
		lister := factory.Rbac().V1().ClusterRoleBindings().Lister()
		return newClusterLister(func() ([]*rbacv1.ClusterRoleBinding, error) { return lister.List(labels.Everything()) })
	},
	{Group: "rbac.authorization.k8s.io", Resource: "roles"}: func(factory informers.SharedInformerFactory) informerListFunc {
		lister := factory.Rbac().V1().Roles().Lister()
		return newNamespacedLister(
			func() ([]*rbacv1.Role, error) { return lister.List(labels.Everything()) },
			func(ns string) ([]*rbacv1.Role, error) { return lister.Roles(ns).List(labels.Everything()) },
		)
	},
	{Group: "rbac.authorization.k8s.io", Resource: "rolebindings"}: func(factory informers.SharedInformerFactory) informerListFunc {
		lister := factory.Rbac().V1().RoleBindings().Lister()
		return newNamespacedLister(
			func() ([]*rbacv1.RoleBinding, error) { return lister.List(labels.Everything()) },
			func(ns string) ([]*rbacv1.RoleBinding, error) {
				return lister.RoleBindings(ns).List(labels.Everything())
			},
		)
	},
	{Group: "", Resource: "namespaces"}: func(factory informers.SharedInformerFactory) informerListFunc {
		lister := factory.Core().V1().Namespaces().Lister()
		return newClusterLister(func() ([]*corev1.Namespace, error) { return lister.List(labels.Everything()) })
	},
	{Group: "", Resource: "nodes"}: func(factory informers.SharedInformerFactory) informerListFunc {
		lister := factory.Core().V1().Nodes().Lister()
		return newClusterLister(func() ([]*corev1.Node, error) { return lister.List(labels.Everything()) })
	},
	{Group: "", Resource: "persistentvolumes"}: func(factory informers.SharedInformerFactory) informerListFunc {
		lister := factory.Core().V1().PersistentVolumes().Lister()
		return newClusterLister(func() ([]*corev1.PersistentVolume, error) { return lister.List(labels.Everything()) })
	},
	{Group: "storage.k8s.io", Resource: "storageclasses"}: func(factory informers.SharedInformerFactory) informerListFunc {
		lister := factory.Storage().V1().StorageClasses().Lister()
		return newClusterLister(func() ([]*storagev1.StorageClass, error) { return lister.List(labels.Everything()) })
	},
}

// newNamespacedLister adapts typed listers to the generic informer list signature.
func newNamespacedLister[T metav1.Object](listAll func() ([]T, error), listNamespace func(ns string) ([]T, error)) informerListFunc {
	return func(namespace string) ([]metav1.Object, error) {
		if namespace == "" || namespace == metav1.NamespaceAll {
			items, err := listAll()
			if err != nil {
				return nil, err
			}
			return toMetaObjects(items), nil
		}
		items, err := listNamespace(namespace)
		if err != nil {
			return nil, err
		}
		return toMetaObjects(items), nil
	}
}

// newClusterLister adapts cluster-scoped listers to the generic informer list signature.
func newClusterLister[T metav1.Object](listAll func() ([]T, error)) informerListFunc {
	return func(_ string) ([]metav1.Object, error) {
		items, err := listAll()
		if err != nil {
			return nil, err
		}
		return toMetaObjects(items), nil
	}
}
