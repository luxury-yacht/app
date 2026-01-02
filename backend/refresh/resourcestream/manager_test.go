package resourcestream

import (
	"testing"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	appslisters "k8s.io/client-go/listers/apps/v1"
	corelisters "k8s.io/client-go/listers/core/v1"
	"k8s.io/client-go/tools/cache"

	"github.com/stretchr/testify/require"

	"github.com/luxury-yacht/app/backend/refresh/snapshot"
)

func TestManagerPodUpdateBroadcasts(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      noopLogger{},
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := manager.Subscribe(domainPods, "namespace:default")
	require.NoError(t, err)

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "pod-1",
			Namespace:       "default",
			UID:             "pod-uid",
			ResourceVersion: "12",
		},
		Spec: corev1.PodSpec{
			NodeName: "node-a",
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
		},
	}

	manager.handlePod(pod, MessageTypeAdded)

	select {
	case update := <-sub.Updates:
		require.Equal(t, MessageTypeAdded, update.Type)
		require.Equal(t, domainPods, update.Domain)
		require.Equal(t, "namespace:default", update.Scope)
		require.Equal(t, "pod-1", update.Name)
		require.Equal(t, "default", update.Namespace)
		require.NotNil(t, update.Row)
	default:
		t.Fatal("expected update to be delivered")
	}
}

func TestManagerConfigUpdateBroadcasts(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      noopLogger{},
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := manager.Subscribe(domainNamespaceConfig, "namespace:default")
	require.NoError(t, err)

	cm := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "cfg-1",
			Namespace:       "default",
			UID:             "cfg-uid",
			ResourceVersion: "9",
		},
		Data: map[string]string{
			"key": "value",
		},
	}

	manager.handleConfigMap(cm, MessageTypeAdded)

	select {
	case update := <-sub.Updates:
		require.Equal(t, MessageTypeAdded, update.Type)
		require.Equal(t, domainNamespaceConfig, update.Domain)
		require.Equal(t, "namespace:default", update.Scope)
		require.Equal(t, "cfg-1", update.Name)
		require.Equal(t, "default", update.Namespace)
		require.NotNil(t, update.Row)
	default:
		t.Fatal("expected config update to be delivered")
	}
}

func TestManagerRBACUpdateBroadcasts(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      noopLogger{},
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := manager.Subscribe(domainNamespaceRBAC, "namespace:default")
	require.NoError(t, err)

	role := &rbacv1.Role{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "role-1",
			Namespace:       "default",
			UID:             "role-uid",
			ResourceVersion: "4",
		},
	}

	manager.handleRole(role, MessageTypeAdded)

	select {
	case update := <-sub.Updates:
		require.Equal(t, MessageTypeAdded, update.Type)
		require.Equal(t, domainNamespaceRBAC, update.Domain)
		require.Equal(t, "namespace:default", update.Scope)
		require.Equal(t, "role-1", update.Name)
		require.Equal(t, "default", update.Namespace)
		require.NotNil(t, update.Row)
	default:
		t.Fatal("expected rbac update to be delivered")
	}
}

func TestManagerQuotasUpdateBroadcasts(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      noopLogger{},
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := manager.Subscribe(domainNamespaceQuotas, "namespace:default")
	require.NoError(t, err)

	quota := &corev1.ResourceQuota{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "quota-1",
			Namespace:       "default",
			UID:             "quota-uid",
			ResourceVersion: "7",
		},
	}

	manager.handleResourceQuota(quota, MessageTypeAdded)

	select {
	case update := <-sub.Updates:
		require.Equal(t, MessageTypeAdded, update.Type)
		require.Equal(t, domainNamespaceQuotas, update.Domain)
		require.Equal(t, "namespace:default", update.Scope)
		require.Equal(t, "quota-1", update.Name)
		require.Equal(t, "default", update.Namespace)
		require.NotNil(t, update.Row)
	default:
		t.Fatal("expected quotas update to be delivered")
	}
}

func TestManagerDropsSubscriberOnBackpressure(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      noopLogger{},
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := manager.Subscribe(domainPods, "namespace:default")
	require.NoError(t, err)

	update := Update{
		Type:        MessageTypeAdded,
		Domain:      domainPods,
		ClusterID:   "c1",
		ClusterName: "cluster",
		Name:        "pod-1",
		Namespace:   "default",
		Kind:        "Pod",
	}

	for i := 0; i < subscriberBufferSize+1; i++ {
		manager.broadcast(domainPods, []string{"namespace:default"}, update)
	}

	require.Eventually(t, func() bool {
		select {
		case reason := <-sub.Drops:
			return reason == DropReasonBackpressure
		default:
			return false
		}
	}, time.Second, 10*time.Millisecond)
}

func TestManagerWorkloadUpdateFromPod(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "pod-1",
			Namespace:       "default",
			UID:             "pod-uid",
			ResourceVersion: "5",
			OwnerReferences: []metav1.OwnerReference{{
				Kind:       "ReplicaSet",
				Name:       "web-12345",
				Controller: ptrBool(true),
			}},
		},
		Status: corev1.PodStatus{Phase: corev1.PodRunning},
	}

	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "web",
			Namespace:       "default",
			UID:             "deploy-uid",
			ResourceVersion: "9",
		},
	}

	manager := &Manager{
		clusterMeta:      snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:           noopLogger{},
		podLister:        podListerWith(pod),
		deploymentLister: deploymentListerWith(deployment),
		subscribers:      make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := manager.Subscribe(domainWorkloads, "namespace:default")
	require.NoError(t, err)

	manager.handlePod(pod, MessageTypeModified)

	select {
	case update := <-sub.Updates:
		require.Equal(t, MessageTypeModified, update.Type)
		require.Equal(t, domainWorkloads, update.Domain)
		require.Equal(t, "namespace:default", update.Scope)
		require.Equal(t, "web", update.Name)
		require.Equal(t, "Deployment", update.Kind)
		require.NotNil(t, update.Row)
	default:
		t.Fatal("expected workload update to be delivered")
	}
}

func TestManagerNodeUpdateFromPod(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      noopLogger{},
		nodeLister: nodeListerWith(&corev1.Node{
			ObjectMeta: metav1.ObjectMeta{
				Name:            "node-a",
				UID:             "node-uid",
				ResourceVersion: "7",
			},
		}),
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := manager.Subscribe(domainNodes, "")
	require.NoError(t, err)

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "pod-1",
			Namespace:       "default",
			UID:             "pod-uid",
			ResourceVersion: "5",
		},
		Spec: corev1.PodSpec{
			NodeName: "node-a",
		},
		Status: corev1.PodStatus{Phase: corev1.PodRunning},
	}
	manager.podLister = podListerWith(pod)

	// Ensure pod changes refresh node summaries via the pod-based handler.
	manager.handlePod(pod, MessageTypeModified)

	select {
	case update := <-sub.Updates:
		require.Equal(t, MessageTypeModified, update.Type)
		require.Equal(t, domainNodes, update.Domain)
		require.Equal(t, "node-a", update.Name)
		require.Equal(t, "Node", update.Kind)
		require.NotNil(t, update.Row)
	default:
		t.Fatal("expected node update to be delivered")
	}
}

func podListerWith(pods ...*corev1.Pod) corelisters.PodLister {
	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{
		cache.NamespaceIndex: cache.MetaNamespaceIndexFunc,
		podNodeIndexName: func(obj interface{}) ([]string, error) {
			item, ok := obj.(*corev1.Pod)
			if !ok || item == nil || item.Spec.NodeName == "" {
				return nil, nil
			}
			return []string{item.Spec.NodeName}, nil
		},
	})
	for _, pod := range pods {
		_ = indexer.Add(pod)
	}
	return corelisters.NewPodLister(indexer)
}

func nodeListerWith(nodes ...*corev1.Node) corelisters.NodeLister {
	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{})
	for _, node := range nodes {
		_ = indexer.Add(node)
	}
	return corelisters.NewNodeLister(indexer)
}

func deploymentListerWith(items ...*appsv1.Deployment) appslisters.DeploymentLister {
	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{
		cache.NamespaceIndex: cache.MetaNamespaceIndexFunc,
	})
	for _, item := range items {
		_ = indexer.Add(item)
	}
	return appslisters.NewDeploymentLister(indexer)
}

func ptrBool(value bool) *bool {
	return &value
}
