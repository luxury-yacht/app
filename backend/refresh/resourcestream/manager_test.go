package resourcestream

import (
	"testing"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	storagev1 "k8s.io/api/storage/v1"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	appslisters "k8s.io/client-go/listers/apps/v1"
	corelisters "k8s.io/client-go/listers/core/v1"
	"k8s.io/client-go/tools/cache"

	"github.com/stretchr/testify/require"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/testsupport"
)

func refPtr(ref resourcemodel.ResourceRef) *resourcemodel.ResourceRef { return &ref }

func requireUpdateObjectMetadata(t *testing.T, update Update, resourceVersion, uid, name, namespace, kind string) {
	t.Helper()
	require.Equal(t, "c1", update.ClusterID)
	require.Equal(t, "cluster", update.ClusterName)
	require.Equal(t, resourceVersion, update.ResourceVersion)
	require.NotNil(t, update.Ref)
	require.Equal(t, update.ClusterID, update.Ref.ClusterID)
	require.Equal(t, uid, update.Ref.UID)
	require.Equal(t, name, update.Ref.Name)
	require.Equal(t, namespace, update.Ref.Namespace)
	require.Equal(t, kind, update.Ref.Kind)
}

func requireNextUpdate(t *testing.T, sub *Subscription) Update {
	t.Helper()
	select {
	case update := <-sub.Updates:
		return update
	case <-time.After(time.Second):
		t.Fatal("expected update to be delivered")
		return Update{}
	}
}

func subscribeForTest(t *testing.T, manager *Manager, domain, scope string) (*Subscription, error) {
	t.Helper()
	selector, err := ParseStreamSelector(manager.clusterMeta.ClusterID, domain, scope)
	if err != nil {
		return nil, err
	}
	return manager.SubscribeSelector(selector)
}

func resumeForTest(t *testing.T, manager *Manager, domain, scope string, since uint64) ([]Update, bool) {
	t.Helper()
	selector, err := ParseStreamSelector(manager.clusterMeta.ClusterID, domain, scope)
	if err != nil {
		return nil, false
	}
	return manager.ResumeSelector(selector, since)
}

func TestManagerPodUpdateBroadcasts(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      noopLogger{},
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := subscribeForTest(t, manager, domainPods, "namespace:default")
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
		require.Equal(t, "pod-1", update.Ref.Name)
		require.Equal(t, "default", update.Ref.Namespace)
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

	sub, err := subscribeForTest(t, manager, domainNamespaceConfig, "namespace:default")
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
		requireUpdateObjectMetadata(t, update, "9", "cfg-uid", "cfg-1", "default", "ConfigMap")
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

	sub, err := subscribeForTest(t, manager, domainNamespaceRBAC, "namespace:default")
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
		requireUpdateObjectMetadata(t, update, "4", "role-uid", "role-1", "default", "Role")
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
	sub, err := subscribeForTest(t, manager, domainPods, "namespace:default")
	require.NoError(t, err)
	defer sub.Cancel()

	first := Update{
		Type:            MessageTypeAdded,
		Domain:          domainPods,
		ClusterID:       "c1",
		ClusterName:     "cluster",
		ResourceVersion: "1",
		Ref:             refPtr(resourcemodel.NewResourceRef("c1", "", "v1", "Pod", "pods", "default", "pod-1", "pod-1")),
	}
	second := first
	second.ResourceVersion = "2"
	second.Ref = refPtr(resourcemodel.NewResourceRef("c1", "", "v1", "Pod", "pods", "default", "pod-2", "pod-2"))

	manager.broadcast(domainPods, []string{"namespace:default"}, first)
	manager.broadcast(domainPods, []string{"namespace:default"}, second)

	updates, ok := resumeForTest(t, manager, domainPods, "namespace:default", 1)
	require.True(t, ok)
	require.Len(t, updates, 1)
	require.Equal(t, "2", updates[0].Sequence)
	require.Equal(t, "pod-2", updates[0].Ref.Name)
}

func TestManagerEvictsResumeBufferWhenLastSubscriberCancels(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      noopLogger{},
		subscribers: make(map[string]map[string]map[uint64]*subscription),
		buffers:     make(map[string]*updateBuffer),
		sequences:   make(map[string]uint64),
	}

	sub, err := subscribeForTest(t, manager, domainPods, "namespace:default")
	require.NoError(t, err)

	update := Update{
		Type:            MessageTypeAdded,
		Domain:          domainPods,
		ClusterID:       "c1",
		ClusterName:     "cluster",
		ResourceVersion: "1",
		Ref:             refPtr(resourcemodel.NewResourceRef("c1", "", "v1", "Pod", "pods", "default", "pod-1", "pod-1")),
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

	sub, err := subscribeForTest(t, manager, domainClusterRBAC, "")
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
		requireUpdateObjectMetadata(t, update, "10", "cr-uid", "cluster-role-1", "", "ClusterRole")
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

	sub, err := subscribeForTest(t, manager, domainNamespaceQuotas, "namespace:default")
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
		requireUpdateObjectMetadata(t, update, "7", "quota-uid", "quota-1", "default", "ResourceQuota")
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

	sub, err := subscribeForTest(t, manager, domainNamespaceNetwork, "namespace:default")
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
		requireUpdateObjectMetadata(t, update, "3", "svc-uid", "svc-1", "default", "Service")
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

	sub, err := subscribeForTest(t, manager, domainClusterConfig, "")
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
		requireUpdateObjectMetadata(t, update, "2", "sc-uid", "fast", "", "StorageClass")
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

	sub, err := subscribeForTest(t, manager, domainNamespaceStorage, "namespace:default")
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
		requireUpdateObjectMetadata(t, update, "2", "pvc-uid", "pvc-1", "default", "PersistentVolumeClaim")
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

	sub, err := subscribeForTest(t, manager, domainClusterStorage, "")
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
		requireUpdateObjectMetadata(t, update, "5", "pv-uid", "pv-1", "", "PersistentVolume")
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

	sub, err := subscribeForTest(t, manager, domainNamespaceCustom, "namespace:default")
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
		require.Equal(t, "widget-1", update.Ref.Name)
		require.Equal(t, "default", update.Ref.Namespace)
		require.Equal(t, "Widget", update.Ref.Kind)
		require.Equal(t, "example.com", update.Ref.Group)
		require.Equal(t, "v1", update.Ref.Version)
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

	_, err := subscribeForTest(t, manager, domainNamespaceCustom, "namespace:default")
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

func TestManagerSkipsCustomInformerForFirstClassGatewayCRD(t *testing.T) {
	existingStopCh := make(chan struct{})
	manager := &Manager{
		clusterMeta:     snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:          noopLogger{},
		dynamicClient:   dynamicfake.NewSimpleDynamicClient(runtime.NewScheme()),
		customInformers: make(map[string]*customResourceInformer),
		subscribers:     make(map[string]map[string]map[uint64]*subscription),
	}
	manager.customInformers["gateways.gateway.networking.k8s.io"] = &customResourceInformer{
		stopCh: existingStopCh,
	}

	crd := &apiextensionsv1.CustomResourceDefinition{
		ObjectMeta: metav1.ObjectMeta{Name: "gateways.gateway.networking.k8s.io"},
		Spec: apiextensionsv1.CustomResourceDefinitionSpec{
			Group: "gateway.networking.k8s.io",
			Scope: apiextensionsv1.NamespaceScoped,
			Names: apiextensionsv1.CustomResourceDefinitionNames{
				Plural: "gateways",
				Kind:   "Gateway",
			},
			Versions: []apiextensionsv1.CustomResourceDefinitionVersion{{
				Name:    "v1",
				Served:  true,
				Storage: true,
			}},
		},
	}

	manager.handleCustomResourceDefinition(crd, MessageTypeModified)

	require.Empty(t, manager.customInformers)
	select {
	case <-existingStopCh:
	default:
		t.Fatal("expected stale custom informer to be stopped")
	}
}

func TestManagerCRDSignatureChangeCompletesCustomDomain(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      noopLogger{},
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}
	sub, err := subscribeForTest(t, manager, domainNamespaceCustom, "namespace:default")
	require.NoError(t, err)

	oldCRD := customResourceDefinition("widgets.example.com", "example.com", "widgets", "Widget", apiextensionsv1.NamespaceScoped, "10")
	newCRD := oldCRD.DeepCopy()
	newCRD.ResourceVersion = "11"
	newCRD.Spec.Names.Kind = "RenamedWidget"

	manager.handleCustomResourceDefinitionEvent(oldCRD, newCRD, MessageTypeModified)

	update := requireNextUpdate(t, sub)
	require.Equal(t, MessageTypeComplete, update.Type)
	require.Equal(t, domainNamespaceCustom, update.Domain)
	require.Equal(t, "namespace:default", update.Scope)
	require.Equal(t, "11", update.ResourceVersion)
	require.Nil(t, update.Row)
	require.NotNil(t, update.Ref)
	require.Equal(t, "c1", update.Ref.ClusterID)
	require.Equal(t, "apiextensions.k8s.io", update.Ref.Group)
	require.Equal(t, "v1", update.Ref.Version)
	require.Equal(t, "CustomResourceDefinition", update.Ref.Kind)
	require.Equal(t, "widgets.example.com", update.Ref.Name)
}

func TestManagerClusterCustomCRDSignatureChangeCompletesCustomDomain(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      noopLogger{},
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}
	sub, err := subscribeForTest(t, manager, domainClusterCustom, "")
	require.NoError(t, err)

	oldCRD := customResourceDefinition("clusterwidgets.example.com", "example.com", "clusterwidgets", "ClusterWidget", apiextensionsv1.ClusterScoped, "10")
	newCRD := oldCRD.DeepCopy()
	newCRD.ResourceVersion = "11"
	newCRD.Spec.Names.Plural = "renamedclusterwidgets"

	manager.handleCustomResourceDefinitionEvent(oldCRD, newCRD, MessageTypeModified)

	update := requireNextUpdate(t, sub)
	require.Equal(t, MessageTypeComplete, update.Type)
	require.Equal(t, domainClusterCustom, update.Domain)
	require.Equal(t, "", update.Scope)
	require.Equal(t, "11", update.ResourceVersion)
	require.Nil(t, update.Row)
	require.NotNil(t, update.Ref)
	require.Equal(t, "c1", update.Ref.ClusterID)
	require.Equal(t, "apiextensions.k8s.io", update.Ref.Group)
	require.Equal(t, "v1", update.Ref.Version)
	require.Equal(t, "CustomResourceDefinition", update.Ref.Kind)
	require.Equal(t, "clusterwidgets.example.com", update.Ref.Name)
}

func TestManagerClusterCustomUpdateBroadcasts(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      noopLogger{},
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := subscribeForTest(t, manager, domainClusterCustom, "")
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
		require.Equal(t, "widget-cluster", update.Ref.Name)
		require.Equal(t, "Widget", update.Ref.Kind)
		require.Equal(t, "example.com", update.Ref.Group)
		require.Equal(t, "v1", update.Ref.Version)
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

	sub, err := subscribeForTest(t, manager, domainClusterCRDs, "")
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
		require.Equal(t, "widgets.example.com", update.Ref.Name)
		require.Equal(t, "CustomResourceDefinition", update.Ref.Kind)
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

	sub, err := subscribeForTest(t, manager, domainNamespaceHelm, "namespace:default")
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
		require.Nil(t, update.Row)
		require.Equal(t, "demo", update.Ref.Name)
		require.Equal(t, "default", update.Ref.Namespace)
		require.Equal(t, "helm.sh", update.Ref.Group)
		require.Equal(t, "v3", update.Ref.Version)
		require.Equal(t, "HelmRelease", update.Ref.Kind)
	default:
		t.Fatal("expected helm update to be delivered")
	}
}

func TestManagerSecretUpdateRefreshesOldHelmReleaseWhenRelationChanges(t *testing.T) {
	oldSecret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "sh.helm.release.v1.demo.v1",
			Namespace:       "default",
			UID:             "helm-uid",
			ResourceVersion: "5",
			Labels:          map[string]string{"owner": "helm"},
		},
		Type: corev1.SecretType(helmReleaseSecretType),
	}
	newSecret := oldSecret.DeepCopy()
	newSecret.ResourceVersion = "6"
	newSecret.Labels = nil
	newSecret.Type = corev1.SecretTypeOpaque
	newSecret.Name = "ordinary-secret"
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      noopLogger{},
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}
	sub, err := subscribeForTest(t, manager, domainNamespaceHelm, "namespace:default")
	require.NoError(t, err)

	manager.handleSecretEvent(oldSecret, newSecret, MessageTypeModified)

	update := requireNextUpdate(t, sub)
	require.Equal(t, MessageTypeComplete, update.Type)
	require.Equal(t, domainNamespaceHelm, update.Domain)
	require.Nil(t, update.Row)
	require.Equal(t, "demo", update.Ref.Name)
	require.Equal(t, "default", update.Ref.Namespace)
	require.Equal(t, "helm.sh", update.Ref.Group)
	require.Equal(t, "v3", update.Ref.Version)
	require.Equal(t, "HelmRelease", update.Ref.Kind)
}

func TestManagerConfigMapUpdateRefreshesOldHelmReleaseWhenRelationChanges(t *testing.T) {
	oldConfigMap := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "sh.helm.release.v1.demo.v1",
			Namespace:       "default",
			UID:             "helm-cm-uid",
			ResourceVersion: "5",
			Labels:          map[string]string{"owner": "helm"},
		},
	}
	newConfigMap := oldConfigMap.DeepCopy()
	newConfigMap.ResourceVersion = "6"
	newConfigMap.Labels = nil
	newConfigMap.Name = "ordinary-config"
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      noopLogger{},
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}
	sub, err := subscribeForTest(t, manager, domainNamespaceHelm, "namespace:default")
	require.NoError(t, err)

	manager.handleConfigMapEvent(oldConfigMap, newConfigMap, MessageTypeModified)

	update := requireNextUpdate(t, sub)
	require.Equal(t, MessageTypeComplete, update.Type)
	require.Equal(t, domainNamespaceHelm, update.Domain)
	require.Nil(t, update.Row)
	require.Equal(t, "demo", update.Ref.Name)
	require.Equal(t, "default", update.Ref.Namespace)
	require.Equal(t, "helm.sh", update.Ref.Group)
	require.Equal(t, "v3", update.Ref.Version)
	require.Equal(t, "HelmRelease", update.Ref.Kind)
}

func TestManagerAutoscalingUpdateBroadcasts(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      noopLogger{},
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := subscribeForTest(t, manager, domainNamespaceAutoscaling, "namespace:default")
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
		requireUpdateObjectMetadata(t, update, "3", "hpa-uid", "hpa-1", "default", "HorizontalPodAutoscaler")
		require.NotNil(t, update.Row)
	default:
		t.Fatal("expected autoscaling update to be delivered")
	}
}

func TestManagerWorkloadStreamRowsIncludeHPAContext(t *testing.T) {
	replicas := int32(2)
	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "web",
			Namespace:       "default",
			UID:             "deploy-uid",
			ResourceVersion: "9",
		},
		Spec: appsv1.DeploymentSpec{Replicas: &replicas},
	}
	hpa := &autoscalingv1.HorizontalPodAutoscaler{
		ObjectMeta: metav1.ObjectMeta{Name: "web-hpa", Namespace: "default", UID: "hpa-uid", ResourceVersion: "11"},
		Spec: autoscalingv1.HorizontalPodAutoscalerSpec{
			MaxReplicas: 5,
			ScaleTargetRef: autoscalingv1.CrossVersionObjectReference{
				APIVersion: "apps/v1",
				Kind:       "Deployment",
				Name:       "web",
			},
		},
	}
	manager := &Manager{
		clusterMeta:      snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:           noopLogger{},
		podLister:        testsupport.NewPodLister(t),
		deploymentLister: testsupport.NewDeploymentLister(t, deployment),
		hpaLister:        testsupport.NewHorizontalPodAutoscalerLister(t, hpa),
		subscribers:      make(map[string]map[string]map[uint64]*subscription),
	}
	sub, err := subscribeForTest(t, manager, domainWorkloads, "namespace:default")
	require.NoError(t, err)

	manager.handleWorkload(deployment, MessageTypeModified)

	update := requireNextUpdate(t, sub)
	require.Equal(t, domainWorkloads, update.Domain)
	row, ok := update.Row.(snapshot.WorkloadSummary)
	require.True(t, ok)
	require.NotNil(t, row.HPAManaged)
	require.True(t, *row.HPAManaged)
}

func TestManagerHPADeleteRefreshesTargetWorkloadRow(t *testing.T) {
	replicas := int32(2)
	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default", UID: "deploy-uid", ResourceVersion: "9"},
		Spec:       appsv1.DeploymentSpec{Replicas: &replicas},
	}
	hpa := &autoscalingv1.HorizontalPodAutoscaler{
		ObjectMeta: metav1.ObjectMeta{Name: "web-hpa", Namespace: "default", UID: "hpa-uid", ResourceVersion: "11"},
		Spec: autoscalingv1.HorizontalPodAutoscalerSpec{
			MaxReplicas: 5,
			ScaleTargetRef: autoscalingv1.CrossVersionObjectReference{
				APIVersion: "apps/v1",
				Kind:       "Deployment",
				Name:       "web",
			},
		},
	}
	manager := &Manager{
		clusterMeta:      snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:           noopLogger{},
		podLister:        testsupport.NewPodLister(t),
		deploymentLister: testsupport.NewDeploymentLister(t, deployment),
		hpaLister:        testsupport.NewHorizontalPodAutoscalerLister(t),
		subscribers:      make(map[string]map[string]map[uint64]*subscription),
	}
	sub, err := subscribeForTest(t, manager, domainWorkloads, "namespace:default")
	require.NoError(t, err)

	manager.handleHPA(hpa, MessageTypeDeleted)

	update := requireNextUpdate(t, sub)
	require.Equal(t, domainWorkloads, update.Domain)
	require.Equal(t, "web", update.Ref.Name)
	row, ok := update.Row.(snapshot.WorkloadSummary)
	require.True(t, ok)
	require.NotNil(t, row.HPAManaged)
	require.False(t, *row.HPAManaged)
}

func TestManagerHPAUpdateRefreshesOldAndNewTargets(t *testing.T) {
	replicas := int32(1)
	oldDeployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: "web-old", Namespace: "default", UID: "old-uid", ResourceVersion: "7"},
		Spec:       appsv1.DeploymentSpec{Replicas: &replicas},
	}
	newDeployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: "web-new", Namespace: "default", UID: "new-uid", ResourceVersion: "8"},
		Spec:       appsv1.DeploymentSpec{Replicas: &replicas},
	}
	oldHPA := &autoscalingv1.HorizontalPodAutoscaler{
		ObjectMeta: metav1.ObjectMeta{Name: "web-hpa", Namespace: "default", UID: "hpa-uid", ResourceVersion: "10"},
		Spec: autoscalingv1.HorizontalPodAutoscalerSpec{
			MaxReplicas:    5,
			ScaleTargetRef: autoscalingv1.CrossVersionObjectReference{APIVersion: "apps/v1", Kind: "Deployment", Name: "web-old"},
		},
	}
	newHPA := oldHPA.DeepCopy()
	newHPA.ResourceVersion = "11"
	newHPA.Spec.ScaleTargetRef.Name = "web-new"
	manager := &Manager{
		clusterMeta:      snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:           noopLogger{},
		podLister:        testsupport.NewPodLister(t),
		deploymentLister: testsupport.NewDeploymentLister(t, oldDeployment, newDeployment),
		hpaLister:        testsupport.NewHorizontalPodAutoscalerLister(t, newHPA),
		subscribers:      make(map[string]map[string]map[uint64]*subscription),
	}
	sub, err := subscribeForTest(t, manager, domainWorkloads, "namespace:default")
	require.NoError(t, err)

	manager.handleHPAEvent(oldHPA, newHPA, MessageTypeModified)

	rows := map[string]snapshot.WorkloadSummary{}
	for i := 0; i < 2; i++ {
		update := requireNextUpdate(t, sub)
		row, ok := update.Row.(snapshot.WorkloadSummary)
		require.True(t, ok)
		rows[row.Name] = row
	}
	require.NotNil(t, rows["web-new"].HPAManaged)
	require.True(t, *rows["web-new"].HPAManaged)
	require.NotNil(t, rows["web-old"].HPAManaged)
	require.False(t, *rows["web-old"].HPAManaged)
}

func TestManagerPodMoveRefreshesOldAndNewNodeRows(t *testing.T) {
	oldPod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "pod-1", Namespace: "default", UID: "pod-uid", ResourceVersion: "1"},
		Spec:       corev1.PodSpec{NodeName: "node-a"},
		Status:     corev1.PodStatus{Phase: corev1.PodRunning},
	}
	newPod := oldPod.DeepCopy()
	newPod.ResourceVersion = "2"
	newPod.Spec.NodeName = "node-b"
	nodeA := &corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "node-a", UID: "node-a-uid", ResourceVersion: "5"}}
	nodeB := &corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "node-b", UID: "node-b-uid", ResourceVersion: "6"}}
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      noopLogger{},
		podLister:   testsupport.NewPodLister(t, newPod),
		nodeLister:  testsupport.NewNodeLister(t, nodeA, nodeB),
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}
	sub, err := subscribeForTest(t, manager, domainNodes, "")
	require.NoError(t, err)

	manager.handlePodEvent(oldPod, newPod, MessageTypeModified)

	seen := map[string]bool{}
	for i := 0; i < 2; i++ {
		update := requireNextUpdate(t, sub)
		seen[update.Ref.Name] = true
	}
	require.True(t, seen["node-a"])
	require.True(t, seen["node-b"])
}

func TestManagerPodMoveDeletesOldNodePodScope(t *testing.T) {
	oldPod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "pod-1", Namespace: "default", UID: "pod-uid", ResourceVersion: "1"},
		Spec:       corev1.PodSpec{NodeName: "node-a"},
		Status:     corev1.PodStatus{Phase: corev1.PodRunning},
	}
	newPod := oldPod.DeepCopy()
	newPod.ResourceVersion = "2"
	newPod.Spec.NodeName = "node-b"
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      noopLogger{},
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}
	oldNodeSub, err := subscribeForTest(t, manager, domainPods, "node:node-a")
	require.NoError(t, err)
	newNodeSub, err := subscribeForTest(t, manager, domainPods, "node:node-b")
	require.NoError(t, err)

	manager.handlePodEvent(oldPod, newPod, MessageTypeModified)

	oldNodeUpdate := requireNextUpdate(t, oldNodeSub)
	require.Equal(t, MessageTypeDeleted, oldNodeUpdate.Type)
	require.Equal(t, "pod-1", oldNodeUpdate.Ref.Name)

	newNodeUpdate := requireNextUpdate(t, newNodeSub)
	require.Equal(t, MessageTypeModified, newNodeUpdate.Type)
	require.Equal(t, "pod-1", newNodeUpdate.Ref.Name)
	require.NotNil(t, newNodeUpdate.Row)
}

func TestManagerEndpointSliceRetargetRefreshesOldAndNewServices(t *testing.T) {
	oldSlice := &discoveryv1.EndpointSlice{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "slice-1",
			Namespace:       "default",
			UID:             "slice-uid",
			ResourceVersion: "1",
			Labels:          map[string]string{discoveryv1.LabelServiceName: "old-svc"},
		},
	}
	newSlice := oldSlice.DeepCopy()
	newSlice.ResourceVersion = "2"
	newSlice.Labels = map[string]string{discoveryv1.LabelServiceName: "new-svc"}
	oldService := &corev1.Service{ObjectMeta: metav1.ObjectMeta{Name: "old-svc", Namespace: "default", UID: "old-svc-uid"}}
	newService := &corev1.Service{ObjectMeta: metav1.ObjectMeta{Name: "new-svc", Namespace: "default", UID: "new-svc-uid"}}
	manager := &Manager{
		clusterMeta:   snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:        noopLogger{},
		serviceLister: testsupport.NewServiceLister(t, oldService, newService),
		sliceLister:   testsupport.NewEndpointSliceLister(t, newSlice),
		subscribers:   make(map[string]map[string]map[uint64]*subscription),
	}
	sub, err := subscribeForTest(t, manager, domainNamespaceNetwork, "namespace:default")
	require.NoError(t, err)

	manager.handleEndpointSliceEvent(oldSlice, newSlice, MessageTypeModified)

	seenServices := map[string]bool{}
	for i := 0; i < 3; i++ {
		update := requireNextUpdate(t, sub)
		if update.Ref.Kind == "Service" {
			seenServices[update.Ref.Name] = true
		}
	}
	require.True(t, seenServices["old-svc"])
	require.True(t, seenServices["new-svc"])
}

func TestManagerReplicaSetUpdateRefreshesOldAndNewPodOwnerScopes(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "pod-1",
			Namespace:       "default",
			UID:             "pod-uid",
			ResourceVersion: "7",
			OwnerReferences: []metav1.OwnerReference{{
				Kind:       "ReplicaSet",
				Name:       "web-12345",
				Controller: ptrBool(true),
			}},
		},
		Status: corev1.PodStatus{Phase: corev1.PodRunning},
	}
	oldRS := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "web-12345",
			Namespace: "default",
			OwnerReferences: []metav1.OwnerReference{{
				Kind:       "Deployment",
				Name:       "web-old",
				Controller: ptrBool(true),
			}},
		},
	}
	newRS := oldRS.DeepCopy()
	newRS.OwnerReferences = []metav1.OwnerReference{{
		Kind:       "Deployment",
		Name:       "web-new",
		Controller: ptrBool(true),
	}}

	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      noopLogger{},
		podLister:   podListerWith(pod),
		rsLister:    replicaSetListerWith(newRS),
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}
	oldSub, err := subscribeForTest(t, manager, domainPods, "workload:default:apps:v1:Deployment:web-old")
	require.NoError(t, err)
	newSub, err := subscribeForTest(t, manager, domainPods, "workload:default:apps:v1:Deployment:web-new")
	require.NoError(t, err)
	namespaceSub, err := subscribeForTest(t, manager, domainPods, "namespace:default")
	require.NoError(t, err)

	manager.handleReplicaSetEvent(oldRS, newRS, MessageTypeModified)

	oldUpdate := requireNextUpdate(t, oldSub)
	require.Equal(t, MessageTypeDeleted, oldUpdate.Type)
	require.Equal(t, "pod-1", oldUpdate.Ref.Name)

	newUpdate := requireNextUpdate(t, newSub)
	require.Equal(t, MessageTypeModified, newUpdate.Type)
	newRow, ok := newUpdate.Row.(snapshot.PodSummary)
	require.True(t, ok)
	require.Equal(t, "Deployment", newRow.OwnerKind)
	require.Equal(t, "web-new", newRow.OwnerName)

	namespaceUpdate := requireNextUpdate(t, namespaceSub)
	require.Equal(t, MessageTypeModified, namespaceUpdate.Type)
	namespaceRow, ok := namespaceUpdate.Row.(snapshot.PodSummary)
	require.True(t, ok)
	require.Equal(t, "Deployment", namespaceRow.OwnerKind)
	require.Equal(t, "web-new", namespaceRow.OwnerName)
}

func TestManagerBackpressureTriggersReset(t *testing.T) {
	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      noopLogger{},
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := subscribeForTest(t, manager, domainPods, "namespace:default")
	require.NoError(t, err)

	update := Update{
		Type:        MessageTypeAdded,
		Domain:      domainPods,
		ClusterID:   "c1",
		ClusterName: "cluster",
		Ref:         refPtr(resourcemodel.NewResourceRef("c1", "", "v1", "Pod", "pods", "default", "pod-1", "")),
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

	sub, err := subscribeForTest(t, manager, domainWorkloads, "namespace:default")
	require.NoError(t, err)

	manager.handlePod(pod, MessageTypeModified)

	select {
	case update := <-sub.Updates:
		require.Equal(t, MessageTypeModified, update.Type)
		require.Equal(t, domainWorkloads, update.Domain)
		require.Equal(t, "namespace:default", update.Scope)
		require.Equal(t, "web", update.Ref.Name)
		require.Equal(t, "Deployment", update.Ref.Kind)
		require.NotNil(t, update.Row)
	default:
		t.Fatal("expected workload update to be delivered")
	}
}

func TestManagerWorkloadUpdateFromCompletedOwnedPod(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "pod-1",
			Namespace:       "default",
			UID:             "pod-uid",
			ResourceVersion: "6",
			OwnerReferences: []metav1.OwnerReference{{
				Kind:       "ReplicaSet",
				Name:       "web-12345",
				Controller: ptrBool(true),
			}},
		},
		Status: corev1.PodStatus{Phase: corev1.PodSucceeded},
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

	sub, err := subscribeForTest(t, manager, domainWorkloads, "namespace:default")
	require.NoError(t, err)

	manager.handlePod(pod, MessageTypeModified)

	select {
	case update := <-sub.Updates:
		require.Equal(t, MessageTypeModified, update.Type)
		require.Equal(t, domainWorkloads, update.Domain)
		require.Equal(t, "namespace:default", update.Scope)
		require.Equal(t, "web", update.Ref.Name)
		require.Equal(t, "Deployment", update.Ref.Kind)
		require.NotNil(t, update.Row)
	default:
		t.Fatal("expected completed owned pod to refresh workload row")
	}
}

func TestManagerDeletesStandaloneWorkloadRowWhenPodCompletes(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "pod-1",
			Namespace:       "default",
			UID:             "pod-uid",
			ResourceVersion: "7",
		},
		Status: corev1.PodStatus{Phase: corev1.PodFailed},
	}

	manager := &Manager{
		clusterMeta: snapshot.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		logger:      noopLogger{},
		subscribers: make(map[string]map[string]map[uint64]*subscription),
	}

	sub, err := subscribeForTest(t, manager, domainWorkloads, "namespace:default")
	require.NoError(t, err)

	manager.handlePod(pod, MessageTypeModified)

	select {
	case update := <-sub.Updates:
		require.Equal(t, MessageTypeDeleted, update.Type)
		require.Equal(t, domainWorkloads, update.Domain)
		require.Equal(t, "namespace:default", update.Scope)
		require.Equal(t, "pod-1", update.Ref.Name)
		require.Equal(t, "Pod", update.Ref.Kind)
		require.Nil(t, update.Row)
	default:
		t.Fatal("expected completed standalone pod to delete workload row")
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

	sub, err := subscribeForTest(t, manager, domainNodes, "")
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
		require.Equal(t, "node-a", update.Ref.Name)
		require.Equal(t, "Node", update.Ref.Kind)
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

func replicaSetListerWith(items ...*appsv1.ReplicaSet) appslisters.ReplicaSetLister {
	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{
		cache.NamespaceIndex: cache.MetaNamespaceIndexFunc,
	})
	for _, item := range items {
		_ = indexer.Add(item)
	}
	return appslisters.NewReplicaSetLister(indexer)
}

func customResourceDefinition(
	name string,
	group string,
	plural string,
	kind string,
	scope apiextensionsv1.ResourceScope,
	resourceVersion string,
) *apiextensionsv1.CustomResourceDefinition {
	return &apiextensionsv1.CustomResourceDefinition{
		ObjectMeta: metav1.ObjectMeta{Name: name, ResourceVersion: resourceVersion},
		Spec: apiextensionsv1.CustomResourceDefinitionSpec{
			Group: group,
			Scope: scope,
			Names: apiextensionsv1.CustomResourceDefinitionNames{
				Plural: plural,
				Kind:   kind,
			},
			Versions: []apiextensionsv1.CustomResourceDefinitionVersion{{
				Name:    "v1",
				Served:  true,
				Storage: true,
			}},
		},
	}
}

func ptrBool(value bool) *bool {
	return &value
}
