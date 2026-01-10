package resourcestream

import (
	"testing"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	storagev1 "k8s.io/api/storage/v1"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	appslisters "k8s.io/client-go/listers/apps/v1"
	corelisters "k8s.io/client-go/listers/core/v1"
	"k8s.io/client-go/tools/cache"

	"github.com/stretchr/testify/require"

	"github.com/luxury-yacht/app/backend/internal/config"
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
		buffers:     make(map[string]*updateBuffer),
		sequences:   make(map[string]uint64),
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

func TestManagerResumeReturnsBufferedUpdates(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      noopLogger{},
		subscribers: make(map[string]map[string]map[uint64]*subscription),
		buffers:     make(map[string]*updateBuffer),
		sequences:   make(map[string]uint64),
	}
	// Create a subscriber so the resume buffer is active for this scope.
	sub, err := manager.Subscribe(domainPods, "namespace:default")
	require.NoError(t, err)
	defer sub.Cancel()

	first := Update{
		Type:            MessageTypeAdded,
		Domain:          domainPods,
		ClusterID:       "c1",
		ClusterName:     "cluster",
		ResourceVersion: "1",
		UID:             "pod-1",
		Name:            "pod-1",
		Namespace:       "default",
		Kind:            "Pod",
	}
	second := first
	second.ResourceVersion = "2"
	second.UID = "pod-2"
	second.Name = "pod-2"

	manager.broadcast(domainPods, []string{"namespace:default"}, first)
	manager.broadcast(domainPods, []string{"namespace:default"}, second)

	updates, ok := manager.Resume(domainPods, "namespace:default", 1)
	require.True(t, ok)
	require.Len(t, updates, 1)
	require.Equal(t, "2", updates[0].Sequence)
	require.Equal(t, "pod-2", updates[0].Name)
}

func TestManagerEvictsResumeBufferWhenLastSubscriberCancels(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      noopLogger{},
		subscribers: make(map[string]map[string]map[uint64]*subscription),
		buffers:     make(map[string]*updateBuffer),
		sequences:   make(map[string]uint64),
	}

	sub, err := manager.Subscribe(domainPods, "namespace:default")
	require.NoError(t, err)

	update := Update{
		Type:            MessageTypeAdded,
		Domain:          domainPods,
		ClusterID:       "c1",
		ClusterName:     "cluster",
		ResourceVersion: "1",
		UID:             "pod-1",
		Name:            "pod-1",
		Namespace:       "default",
		Kind:            "Pod",
	}
	manager.broadcast(domainPods, []string{"namespace:default"}, update)

	key := bufferKey(domainPods, "namespace:default")
	require.Contains(t, manager.buffers, key)
	require.Contains(t, manager.sequences, key)

	sub.Cancel()

	require.NotContains(t, manager.buffers, key)
	require.NotContains(t, manager.sequences, key)
}

func TestManagerClusterRBACUpdateBroadcasts(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      noopLogger{},
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := manager.Subscribe(domainClusterRBAC, "")
	require.NoError(t, err)

	role := &rbacv1.ClusterRole{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "cluster-role-1",
			UID:             "cr-uid",
			ResourceVersion: "10",
		},
	}

	manager.handleClusterRole(role, MessageTypeAdded)

	select {
	case update := <-sub.Updates:
		require.Equal(t, MessageTypeAdded, update.Type)
		require.Equal(t, domainClusterRBAC, update.Domain)
		require.Equal(t, "", update.Scope)
		require.Equal(t, "cluster-role-1", update.Name)
		require.Equal(t, "ClusterRole", update.Kind)
		require.NotNil(t, update.Row)
	default:
		t.Fatal("expected cluster rbac update to be delivered")
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

func TestManagerNetworkUpdateBroadcasts(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      noopLogger{},
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := manager.Subscribe(domainNamespaceNetwork, "namespace:default")
	require.NoError(t, err)

	service := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "svc-1",
			Namespace:       "default",
			UID:             "svc-uid",
			ResourceVersion: "3",
		},
		Spec: corev1.ServiceSpec{
			Type:      corev1.ServiceTypeClusterIP,
			ClusterIP: "10.0.0.1",
		},
	}

	manager.handleService(service, MessageTypeAdded)

	select {
	case update := <-sub.Updates:
		require.Equal(t, MessageTypeAdded, update.Type)
		require.Equal(t, domainNamespaceNetwork, update.Domain)
		require.Equal(t, "namespace:default", update.Scope)
		require.Equal(t, "svc-1", update.Name)
		require.Equal(t, "default", update.Namespace)
		require.NotNil(t, update.Row)
	default:
		t.Fatal("expected network update to be delivered")
	}
}

func TestManagerClusterConfigUpdateBroadcasts(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      noopLogger{},
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := manager.Subscribe(domainClusterConfig, "")
	require.NoError(t, err)

	storageClass := &storagev1.StorageClass{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "fast",
			UID:             "sc-uid",
			ResourceVersion: "2",
		},
		Provisioner: "kubernetes.io/no-provisioner",
	}

	manager.handleStorageClass(storageClass, MessageTypeAdded)

	select {
	case update := <-sub.Updates:
		require.Equal(t, MessageTypeAdded, update.Type)
		require.Equal(t, domainClusterConfig, update.Domain)
		require.Equal(t, "", update.Scope)
		require.Equal(t, "fast", update.Name)
		require.Equal(t, "StorageClass", update.Kind)
		require.NotNil(t, update.Row)
	default:
		t.Fatal("expected cluster config update to be delivered")
	}
}

func TestManagerStorageUpdateBroadcasts(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      noopLogger{},
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := manager.Subscribe(domainNamespaceStorage, "namespace:default")
	require.NoError(t, err)

	pvc := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "pvc-1",
			Namespace:       "default",
			UID:             "pvc-uid",
			ResourceVersion: "2",
		},
		Status: corev1.PersistentVolumeClaimStatus{
			Phase: corev1.ClaimBound,
		},
	}

	manager.handlePersistentVolumeClaim(pvc, MessageTypeAdded)

	select {
	case update := <-sub.Updates:
		require.Equal(t, MessageTypeAdded, update.Type)
		require.Equal(t, domainNamespaceStorage, update.Domain)
		require.Equal(t, "namespace:default", update.Scope)
		require.Equal(t, "pvc-1", update.Name)
		require.Equal(t, "default", update.Namespace)
		require.NotNil(t, update.Row)
	default:
		t.Fatal("expected storage update to be delivered")
	}
}

func TestManagerClusterStorageUpdateBroadcasts(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      noopLogger{},
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := manager.Subscribe(domainClusterStorage, "")
	require.NoError(t, err)

	pv := &corev1.PersistentVolume{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "pv-1",
			UID:             "pv-uid",
			ResourceVersion: "5",
		},
		Status: corev1.PersistentVolumeStatus{
			Phase: corev1.VolumeBound,
		},
	}

	manager.handlePersistentVolume(pv, MessageTypeAdded)

	select {
	case update := <-sub.Updates:
		require.Equal(t, MessageTypeAdded, update.Type)
		require.Equal(t, domainClusterStorage, update.Domain)
		require.Equal(t, "", update.Scope)
		require.Equal(t, "pv-1", update.Name)
		require.Equal(t, "PersistentVolume", update.Kind)
		require.NotNil(t, update.Row)
	default:
		t.Fatal("expected cluster storage update to be delivered")
	}
}

func TestManagerCustomUpdateBroadcasts(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      noopLogger{},
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := manager.Subscribe(domainNamespaceCustom, "namespace:default")
	require.NoError(t, err)

	resource := &unstructured.Unstructured{}
	resource.SetGroupVersionKind(schema.GroupVersionKind{
		Group:   "example.com",
		Version: "v1",
		Kind:    "Widget",
	})
	resource.SetName("widget-1")
	resource.SetNamespace("default")
	resource.SetUID("widget-uid")
	resource.SetResourceVersion("2")
	resource.SetCreationTimestamp(metav1.NewTime(time.Now().Add(-time.Minute)))

	info := &customResourceInformer{
		gvr:  schema.GroupVersionResource{Group: "example.com", Version: "v1", Resource: "widgets"},
		kind: "Widget",
	}

	manager.handleCustomResource(resource, MessageTypeAdded, info)

	select {
	case update := <-sub.Updates:
		require.Equal(t, MessageTypeAdded, update.Type)
		require.Equal(t, domainNamespaceCustom, update.Domain)
		require.Equal(t, "namespace:default", update.Scope)
		require.Equal(t, "widget-1", update.Name)
		require.Equal(t, "default", update.Namespace)
		require.Equal(t, "Widget", update.Kind)
		require.NotNil(t, update.Row)
	default:
		t.Fatal("expected custom update to be delivered")
	}
}

func TestManagerCustomUpdateInvalidatesCache(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      noopLogger{},
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	_, err := manager.Subscribe(domainNamespaceCustom, "namespace:default")
	require.NoError(t, err)

	var called bool
	var gotKind, gotNamespace, gotName string
	manager.SetCustomResourceCacheInvalidator(func(kind, namespace, name string) {
		called = true
		gotKind = kind
		gotNamespace = namespace
		gotName = name
	})

	resource := &unstructured.Unstructured{}
	resource.SetGroupVersionKind(schema.GroupVersionKind{
		Group:   "example.com",
		Version: "v1",
		Kind:    "Widget",
	})
	resource.SetName("widget-1")
	resource.SetNamespace("default")

	info := &customResourceInformer{
		gvr:  schema.GroupVersionResource{Group: "example.com", Version: "v1", Resource: "widgets"},
		kind: "Widget",
	}

	manager.handleCustomResource(resource, MessageTypeModified, info)

	require.True(t, called)
	require.Equal(t, "Widget", gotKind)
	require.Equal(t, "default", gotNamespace)
	require.Equal(t, "widget-1", gotName)
}

func TestManagerClusterCustomUpdateBroadcasts(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      noopLogger{},
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := manager.Subscribe(domainClusterCustom, "")
	require.NoError(t, err)

	resource := &unstructured.Unstructured{}
	resource.SetGroupVersionKind(schema.GroupVersionKind{
		Group:   "example.com",
		Version: "v1",
		Kind:    "Widget",
	})
	resource.SetName("widget-cluster")
	resource.SetUID("widget-cluster-uid")
	resource.SetResourceVersion("2")
	resource.SetCreationTimestamp(metav1.NewTime(time.Now().Add(-time.Minute)))

	info := &customResourceInformer{
		gvr:    schema.GroupVersionResource{Group: "example.com", Version: "v1", Resource: "widgets"},
		kind:   "Widget",
		domain: domainClusterCustom,
	}

	manager.handleCustomResource(resource, MessageTypeAdded, info)

	select {
	case update := <-sub.Updates:
		require.Equal(t, MessageTypeAdded, update.Type)
		require.Equal(t, domainClusterCustom, update.Domain)
		require.Equal(t, "", update.Scope)
		require.Equal(t, "widget-cluster", update.Name)
		require.Equal(t, "Widget", update.Kind)
		require.NotNil(t, update.Row)
	default:
		t.Fatal("expected cluster custom update to be delivered")
	}
}

func TestManagerClusterCRDUpdateBroadcasts(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      noopLogger{},
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := manager.Subscribe(domainClusterCRDs, "")
	require.NoError(t, err)

	crd := &apiextensionsv1.CustomResourceDefinition{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "widgets.example.com",
			UID:             "crd-uid",
			ResourceVersion: "8",
		},
		Spec: apiextensionsv1.CustomResourceDefinitionSpec{
			Group: "example.com",
			Names: apiextensionsv1.CustomResourceDefinitionNames{
				Plural: "widgets",
				Kind:   "Widget",
			},
			Scope: apiextensionsv1.NamespaceScoped,
			Versions: []apiextensionsv1.CustomResourceDefinitionVersion{{
				Name:    "v1",
				Served:  true,
				Storage: true,
			}},
		},
	}

	manager.handleClusterCRD(crd, MessageTypeAdded)

	select {
	case update := <-sub.Updates:
		require.Equal(t, MessageTypeAdded, update.Type)
		require.Equal(t, domainClusterCRDs, update.Domain)
		require.Equal(t, "", update.Scope)
		require.Equal(t, "widgets.example.com", update.Name)
		require.Equal(t, "CustomResourceDefinition", update.Kind)
		require.NotNil(t, update.Row)
	default:
		t.Fatal("expected cluster CRD update to be delivered")
	}
}

func TestManagerHelmUpdateBroadcasts(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      noopLogger{},
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := manager.Subscribe(domainNamespaceHelm, "namespace:default")
	require.NoError(t, err)

	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "sh.helm.release.v1.demo.v1",
			Namespace:       "default",
			UID:             "helm-uid",
			ResourceVersion: "5",
			Labels: map[string]string{
				"owner": "helm",
			},
		},
		Type: corev1.SecretType(helmReleaseSecretType),
	}

	manager.handleSecret(secret, MessageTypeModified)

	select {
	case update := <-sub.Updates:
		require.Equal(t, MessageTypeComplete, update.Type)
		require.Equal(t, domainNamespaceHelm, update.Domain)
		require.Equal(t, "namespace:default", update.Scope)
		require.Equal(t, "demo", update.Name)
		require.Equal(t, "default", update.Namespace)
		require.Equal(t, "HelmRelease", update.Kind)
	default:
		t.Fatal("expected helm update to be delivered")
	}
}

func TestManagerAutoscalingUpdateBroadcasts(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      noopLogger{},
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := manager.Subscribe(domainNamespaceAutoscaling, "namespace:default")
	require.NoError(t, err)

	hpa := &autoscalingv1.HorizontalPodAutoscaler{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "hpa-1",
			Namespace:       "default",
			UID:             "hpa-uid",
			ResourceVersion: "3",
		},
		Spec: autoscalingv1.HorizontalPodAutoscalerSpec{
			MaxReplicas: 3,
			ScaleTargetRef: autoscalingv1.CrossVersionObjectReference{
				Kind: "Deployment",
				Name: "app",
			},
		},
		Status: autoscalingv1.HorizontalPodAutoscalerStatus{
			CurrentReplicas: 2,
		},
	}

	manager.handleHPA(hpa, MessageTypeAdded)

	select {
	case update := <-sub.Updates:
		require.Equal(t, MessageTypeAdded, update.Type)
		require.Equal(t, domainNamespaceAutoscaling, update.Domain)
		require.Equal(t, "namespace:default", update.Scope)
		require.Equal(t, "hpa-1", update.Name)
		require.Equal(t, "default", update.Namespace)
		require.NotNil(t, update.Row)
	default:
		t.Fatal("expected autoscaling update to be delivered")
	}
}

func TestManagerBackpressureTriggersReset(t *testing.T) {
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

	for i := 0; i < config.ResourceStreamSubscriberBufferSize+1; i++ {
		manager.broadcast(domainPods, []string{"namespace:default"}, update)
	}

	require.Eventually(t, func() bool {
		for i := 0; i < config.ResourceStreamSubscriberBufferSize+1; i++ {
			select {
			case msg := <-sub.Updates:
				if msg.Type == MessageTypeReset {
					return true
				}
			default:
				return false
			}
		}
		return false
	}, time.Second, 10*time.Millisecond)

	select {
	case reason := <-sub.Drops:
		t.Fatalf("unexpected drop: %s", reason)
	default:
	}
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
