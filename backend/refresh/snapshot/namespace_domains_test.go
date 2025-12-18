package snapshot

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	networkingv1 "k8s.io/api/networking/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/refresh/metrics"
	"github.com/luxury-yacht/app/backend/testsupport"
)

func TestNamespaceConfigBuilder(t *testing.T) {
	now := time.Now()
	configMap := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "settings",
			Namespace:         "default",
			ResourceVersion:   "35",
			CreationTimestamp: metav1.NewTime(now.Add(-45 * time.Minute)),
		},
		Data: map[string]string{"foo": "bar"},
	}

	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "creds",
			Namespace:         "default",
			ResourceVersion:   "36",
			CreationTimestamp: metav1.NewTime(now.Add(-30 * time.Minute)),
		},
		Type: corev1.SecretTypeOpaque,
		Data: map[string][]byte{"user": []byte("alice")},
	}

	builder := &NamespaceConfigBuilder{
		configMaps: testsupport.NewConfigMapLister(t, configMap),
		secrets:    testsupport.NewSecretLister(t, secret),
	}

	snapshot, err := builder.Build(context.Background(), "namespace:default")
	require.NoError(t, err)
	require.Equal(t, namespaceConfigDomainName, snapshot.Domain)

	payload, ok := snapshot.Payload.(NamespaceConfigSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Resources, 2)
	for _, entry := range payload.Resources {
		require.NotEmpty(t, entry.Age)
	}
}

func TestNamespaceConfigBuilderAllNamespaces(t *testing.T) {
	now := time.Now()
	configMapDefault := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "settings",
			Namespace:         "default",
			ResourceVersion:   "35",
			CreationTimestamp: metav1.NewTime(now.Add(-45 * time.Minute)),
		},
		Data: map[string]string{"foo": "bar"},
	}

	configMapSystem := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "system-settings",
			Namespace:         "kube-system",
			ResourceVersion:   "40",
			CreationTimestamp: metav1.NewTime(now.Add(-20 * time.Minute)),
		},
		Data: map[string]string{"setting": "value"},
	}

	secretDefault := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "creds",
			Namespace:         "default",
			ResourceVersion:   "36",
			CreationTimestamp: metav1.NewTime(now.Add(-30 * time.Minute)),
		},
		Type: corev1.SecretTypeOpaque,
		Data: map[string][]byte{"user": []byte("alice")},
	}

	secretOther := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "other-creds",
			Namespace:         "staging",
			ResourceVersion:   "38",
			CreationTimestamp: metav1.NewTime(now.Add(-25 * time.Minute)),
		},
		Type: corev1.SecretTypeTLS,
		Data: map[string][]byte{"cert": []byte("123")},
	}

	builder := &NamespaceConfigBuilder{
		configMaps: testsupport.NewConfigMapLister(t, configMapDefault, configMapSystem),
		secrets:    testsupport.NewSecretLister(t, secretDefault, secretOther),
	}

	snapshot, err := builder.Build(context.Background(), "namespace:all")
	require.NoError(t, err)
	require.Equal(t, namespaceConfigDomainName, snapshot.Domain)
	require.Equal(t, "namespace:all", snapshot.Scope)

	payload, ok := snapshot.Payload.(NamespaceConfigSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Resources, 4)

	namespaces := make(map[string]struct{})
	for _, entry := range payload.Resources {
		require.NotEmpty(t, entry.Namespace)
		require.NotEmpty(t, entry.Age)
		namespaces[entry.Namespace] = struct{}{}
	}
	require.Len(t, namespaces, 3)
}

func TestNamespaceConfigBuilderStableOrdering(t *testing.T) {
	now := time.Now()
	configMap := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "shared",
			Namespace:         "default",
			ResourceVersion:   "10",
			CreationTimestamp: metav1.NewTime(now.Add(-15 * time.Minute)),
		},
		Data: map[string]string{"foo": "bar"},
	}
	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "shared",
			Namespace:         "default",
			ResourceVersion:   "11",
			CreationTimestamp: metav1.NewTime(now.Add(-10 * time.Minute)),
		},
		Type: corev1.SecretTypeOpaque,
		Data: map[string][]byte{"user": []byte("alice")},
	}

	builder := &NamespaceConfigBuilder{
		configMaps: testsupport.NewConfigMapLister(t, configMap),
		secrets:    testsupport.NewSecretLister(t, secret),
	}

	snapshot, err := builder.Build(context.Background(), "namespace:all")
	require.NoError(t, err)

	payload, ok := snapshot.Payload.(NamespaceConfigSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Resources, 2)
	require.Equal(t, []string{"ConfigMap", "Secret"}, []string{
		payload.Resources[0].Kind,
		payload.Resources[1].Kind,
	})
}

func TestNamespaceNetworkBuilder(t *testing.T) {
	now := time.Now()
	svc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "api",
			Namespace:         "default",
			ResourceVersion:   "61",
			CreationTimestamp: metav1.NewTime(now.Add(-30 * time.Minute)),
		},
		Spec: corev1.ServiceSpec{
			Type:      corev1.ServiceTypeClusterIP,
			ClusterIP: "10.0.0.1",
			Ports: []corev1.ServicePort{{
				Port:     443,
				Protocol: corev1.ProtocolTCP,
			}},
		},
	}

	portName := "https"
	portValue := int32(443)
	protocol := corev1.ProtocolTCP
	ready := true
	slice := &discoveryv1.EndpointSlice{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "api-abcde",
			Namespace:         "default",
			ResourceVersion:   "62",
			CreationTimestamp: metav1.NewTime(now.Add(-25 * time.Minute)),
			Labels: map[string]string{
				discoveryv1.LabelServiceName: svc.Name,
			},
		},
		AddressType: discoveryv1.AddressTypeIPv4,
		Ports: []discoveryv1.EndpointPort{{
			Name:     &portName,
			Port:     &portValue,
			Protocol: &protocol,
		}},
		Endpoints: []discoveryv1.Endpoint{{
			Addresses: []string{"192.168.0.10"},
			Conditions: discoveryv1.EndpointConditions{
				Ready: &ready,
			},
		}},
	}

	ing := &networkingv1.Ingress{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "web",
			Namespace:         "default",
			ResourceVersion:   "63",
			CreationTimestamp: metav1.NewTime(now.Add(-20 * time.Minute)),
		},
		Spec: networkingv1.IngressSpec{
			Rules: []networkingv1.IngressRule{{Host: "app.example.com"}},
		},
	}

	policy := &networkingv1.NetworkPolicy{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "deny-all",
			Namespace:         "default",
			ResourceVersion:   "64",
			CreationTimestamp: metav1.NewTime(now.Add(-15 * time.Minute)),
		},
		Spec: networkingv1.NetworkPolicySpec{},
	}

	builder := &NamespaceNetworkBuilder{
		serviceLister:       testsupport.NewServiceLister(t, svc),
		endpointSliceLister: testsupport.NewEndpointSliceLister(t, slice),
		ingressLister:       testsupport.NewIngressLister(t, ing),
		policyLister:        testsupport.NewNetworkPolicyLister(t, policy),
	}

	snapshot, err := builder.Build(context.Background(), "namespace:default")
	require.NoError(t, err)
	require.Equal(t, namespaceNetworkDomainName, snapshot.Domain)

	payload, ok := snapshot.Payload.(NamespaceNetworkSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Resources, 4)
	for _, entry := range payload.Resources {
		require.NotEmpty(t, entry.Age)
	}
}

func TestNamespaceNetworkBuilderAllNamespaces(t *testing.T) {
	now := time.Now()
	svcDefault := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "api",
			Namespace:         "default",
			ResourceVersion:   "61",
			CreationTimestamp: metav1.NewTime(now.Add(-30 * time.Minute)),
		},
		Spec: corev1.ServiceSpec{Type: corev1.ServiceTypeClusterIP},
	}

	svcOther := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "metrics",
			Namespace:         "staging",
			ResourceVersion:   "62",
			CreationTimestamp: metav1.NewTime(now.Add(-25 * time.Minute)),
		},
		Spec: corev1.ServiceSpec{Type: corev1.ServiceTypeClusterIP},
	}

	portName := "https"
	portValue := int32(443)
	protocol := corev1.ProtocolTCP
	ready := true
	sliceDefault := &discoveryv1.EndpointSlice{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "api-abcde",
			Namespace:         svcDefault.Namespace,
			ResourceVersion:   "63",
			CreationTimestamp: metav1.NewTime(now.Add(-28 * time.Minute)),
			Labels: map[string]string{
				discoveryv1.LabelServiceName: svcDefault.Name,
			},
		},
		AddressType: discoveryv1.AddressTypeIPv4,
		Ports: []discoveryv1.EndpointPort{{
			Name:     &portName,
			Port:     &portValue,
			Protocol: &protocol,
		}},
		Endpoints: []discoveryv1.Endpoint{{
			Addresses: []string{"10.0.0.1"},
			Conditions: discoveryv1.EndpointConditions{
				Ready: &ready,
			},
		}},
	}

	sliceOther := sliceDefault.DeepCopy()
	sliceOther.Name = "metrics-xyz"
	sliceOther.Namespace = svcOther.Namespace
	sliceOther.Labels = map[string]string{discoveryv1.LabelServiceName: svcOther.Name}

	ingDefault := &networkingv1.Ingress{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "web",
			Namespace:         "default",
			ResourceVersion:   "64",
			CreationTimestamp: metav1.NewTime(now.Add(-20 * time.Minute)),
		},
	}

	policyOther := &networkingv1.NetworkPolicy{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "deny-all",
			Namespace:         "staging",
			ResourceVersion:   "65",
			CreationTimestamp: metav1.NewTime(now.Add(-15 * time.Minute)),
		},
	}

	builder := &NamespaceNetworkBuilder{
		serviceLister:       testsupport.NewServiceLister(t, svcDefault, svcOther),
		endpointSliceLister: testsupport.NewEndpointSliceLister(t, sliceDefault, sliceOther),
		ingressLister:       testsupport.NewIngressLister(t, ingDefault),
		policyLister:        testsupport.NewNetworkPolicyLister(t, policyOther),
	}

	snapshot, err := builder.Build(context.Background(), "namespace:all")
	require.NoError(t, err)
	require.Equal(t, namespaceNetworkDomainName, snapshot.Domain)
	require.Equal(t, "namespace:all", snapshot.Scope)

	payload, ok := snapshot.Payload.(NamespaceNetworkSnapshot)
	require.True(t, ok)
	require.True(t, len(payload.Resources) >= 4)

	namespaces := make(map[string]struct{})
	for _, entry := range payload.Resources {
		require.NotEmpty(t, entry.Namespace)
		namespaces[entry.Namespace] = struct{}{}
	}
	require.Len(t, namespaces, 2)
}

func TestNamespaceStorageBuilder(t *testing.T) {
	now := time.Now()
	storageClass := "standard"
	pvc := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "data",
			Namespace:         "default",
			ResourceVersion:   "18",
			CreationTimestamp: metav1.NewTime(now.Add(-45 * time.Minute)),
		},
		Spec: corev1.PersistentVolumeClaimSpec{
			StorageClassName: &storageClass,
			Resources: corev1.VolumeResourceRequirements{
				Requests: corev1.ResourceList{
					corev1.ResourceStorage: mustQuantity(t, "2Gi"),
				},
			},
		},
		Status: corev1.PersistentVolumeClaimStatus{
			Phase: corev1.ClaimBound,
			Capacity: corev1.ResourceList{
				corev1.ResourceStorage: mustQuantity(t, "2Gi"),
			},
		},
	}

	builder := &NamespaceStorageBuilder{
		pvcLister: testsupport.NewPersistentVolumeClaimLister(t, pvc),
	}

	snapshot, err := builder.Build(context.Background(), "namespace:default")
	require.NoError(t, err)
	require.Equal(t, namespaceStorageDomainName, snapshot.Domain)

	payload, ok := snapshot.Payload.(NamespaceStorageSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Resources, 1)

	entry := payload.Resources[0]
	require.Equal(t, "PersistentVolumeClaim", entry.Kind)
	require.Equal(t, "2Gi", entry.Capacity)
	require.Equal(t, string(corev1.ClaimBound), entry.Status)
	require.NotEmpty(t, entry.Age)
}

func TestNamespaceStorageBuilderAllNamespaces(t *testing.T) {
	now := time.Now()
	pvcDefault := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "data",
			Namespace:         "default",
			ResourceVersion:   "18",
			CreationTimestamp: metav1.NewTime(now.Add(-45 * time.Minute)),
		},
		Status: corev1.PersistentVolumeClaimStatus{Phase: corev1.ClaimBound},
	}

	pvcOther := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "cache",
			Namespace:         "staging",
			ResourceVersion:   "19",
			CreationTimestamp: metav1.NewTime(now.Add(-20 * time.Minute)),
		},
		Status: corev1.PersistentVolumeClaimStatus{Phase: corev1.ClaimPending},
	}

	builder := &NamespaceStorageBuilder{
		pvcLister: testsupport.NewPersistentVolumeClaimLister(t, pvcDefault, pvcOther),
	}

	snapshot, err := builder.Build(context.Background(), "namespace:all")
	require.NoError(t, err)
	require.Equal(t, namespaceStorageDomainName, snapshot.Domain)
	require.Equal(t, "namespace:all", snapshot.Scope)

	payload, ok := snapshot.Payload.(NamespaceStorageSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Resources, 2)

	namespaces := make(map[string]struct{})
	for _, entry := range payload.Resources {
		require.NotEmpty(t, entry.Namespace)
		namespaces[entry.Namespace] = struct{}{}
	}
	require.Len(t, namespaces, 2)
}

func TestNamespaceQuotasBuilder(t *testing.T) {
	now := time.Now()
	quota := &corev1.ResourceQuota{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "hard-limits",
			Namespace:         "default",
			ResourceVersion:   "31",
			CreationTimestamp: metav1.NewTime(now.Add(-1 * time.Hour)),
		},
		Status: corev1.ResourceQuotaStatus{
			Hard: corev1.ResourceList{
				corev1.ResourceCPU: mustQuantity(t, "5"),
			},
		},
	}
	limit := &corev1.LimitRange{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "pod-limits",
			Namespace:         "default",
			ResourceVersion:   "32",
			CreationTimestamp: metav1.NewTime(now.Add(-20 * time.Minute)),
		},
		Spec: corev1.LimitRangeSpec{Limits: []corev1.LimitRangeItem{{Type: corev1.LimitTypePod}}},
	}

	builder := &NamespaceQuotasBuilder{
		quotaLister: testsupport.NewResourceQuotaLister(t, quota),
		limitLister: testsupport.NewLimitRangeLister(t, limit),
	}

	snapshot, err := builder.Build(context.Background(), "namespace:default")
	require.NoError(t, err)
	require.Equal(t, namespaceQuotasDomainName, snapshot.Domain)

	payload, ok := snapshot.Payload.(NamespaceQuotasSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Resources, 2)
	for _, summary := range payload.Resources {
		require.NotEmpty(t, summary.Age)
	}
}

func TestNamespaceQuotasBuilderAllNamespaces(t *testing.T) {
	now := time.Now()
	quotaDefault := &corev1.ResourceQuota{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "hard-limits",
			Namespace:         "default",
			ResourceVersion:   "31",
			CreationTimestamp: metav1.NewTime(now.Add(-1 * time.Hour)),
		},
		Status: corev1.ResourceQuotaStatus{},
	}
	quotaOther := &corev1.ResourceQuota{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "other-limits",
			Namespace:         "staging",
			ResourceVersion:   "33",
			CreationTimestamp: metav1.NewTime(now.Add(-30 * time.Minute)),
		},
	}
	limitDefault := &corev1.LimitRange{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "pod-limits",
			Namespace:         "default",
			ResourceVersion:   "32",
			CreationTimestamp: metav1.NewTime(now.Add(-20 * time.Minute)),
		},
	}

	builder := &NamespaceQuotasBuilder{
		quotaLister: testsupport.NewResourceQuotaLister(t, quotaDefault, quotaOther),
		limitLister: testsupport.NewLimitRangeLister(t, limitDefault),
	}

	snapshot, err := builder.Build(context.Background(), "namespace:all")
	require.NoError(t, err)
	require.Equal(t, namespaceQuotasDomainName, snapshot.Domain)
	require.Equal(t, "namespace:all", snapshot.Scope)

	payload, ok := snapshot.Payload.(NamespaceQuotasSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Resources, 3)

	namespaces := make(map[string]struct{})
	for _, entry := range payload.Resources {
		require.NotEmpty(t, entry.Namespace)
		namespaces[entry.Namespace] = struct{}{}
	}
	require.Len(t, namespaces, 2)
}

func TestNamespaceAutoscalingBuilder(t *testing.T) {
	now := time.Now()
	min := int32(1)
	hpa := &autoscalingv1.HorizontalPodAutoscaler{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "api",
			Namespace:         "default",
			ResourceVersion:   "42",
			CreationTimestamp: metav1.NewTime(now.Add(-20 * time.Minute)),
		},
		Spec: autoscalingv1.HorizontalPodAutoscalerSpec{
			ScaleTargetRef: autoscalingv1.CrossVersionObjectReference{Kind: "Deployment", Name: "api"},
			MinReplicas:    &min,
			MaxReplicas:    4,
		},
		Status: autoscalingv1.HorizontalPodAutoscalerStatus{
			CurrentReplicas: 2,
		},
	}

	builder := &NamespaceAutoscalingBuilder{
		hpaLister: testsupport.NewHorizontalPodAutoscalerLister(t, hpa),
	}

	snapshot, err := builder.Build(context.Background(), "namespace:default")
	require.NoError(t, err)
	require.Equal(t, namespaceAutoscalingDomainName, snapshot.Domain)

	payload, ok := snapshot.Payload.(NamespaceAutoscalingSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Resources, 1)

	entry := payload.Resources[0]
	require.Equal(t, "HorizontalPodAutoscaler", entry.Kind)
	require.Equal(t, "Deployment/api", entry.Target)
	require.Equal(t, int32(2), entry.Current)
	require.NotEmpty(t, entry.Age)
}

func TestNamespaceAutoscalingBuilderAllNamespaces(t *testing.T) {
	now := time.Now()
	min := int32(1)
	hpaDefault := &autoscalingv1.HorizontalPodAutoscaler{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "api",
			Namespace:         "default",
			ResourceVersion:   "42",
			CreationTimestamp: metav1.NewTime(now.Add(-20 * time.Minute)),
		},
		Spec: autoscalingv1.HorizontalPodAutoscalerSpec{
			ScaleTargetRef: autoscalingv1.CrossVersionObjectReference{Kind: "Deployment", Name: "api"},
			MinReplicas:    &min,
			MaxReplicas:    4,
		},
		Status: autoscalingv1.HorizontalPodAutoscalerStatus{
			CurrentReplicas: 2,
		},
	}

	hpaSystem := &autoscalingv1.HorizontalPodAutoscaler{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "metrics",
			Namespace:         "kube-system",
			ResourceVersion:   "43",
			CreationTimestamp: metav1.NewTime(now.Add(-15 * time.Minute)),
		},
		Spec: autoscalingv1.HorizontalPodAutoscalerSpec{
			ScaleTargetRef: autoscalingv1.CrossVersionObjectReference{Kind: "Deployment", Name: "metrics"},
			MinReplicas:    &min,
			MaxReplicas:    6,
		},
		Status: autoscalingv1.HorizontalPodAutoscalerStatus{
			CurrentReplicas: 3,
		},
	}

	builder := &NamespaceAutoscalingBuilder{
		hpaLister: testsupport.NewHorizontalPodAutoscalerLister(t, hpaDefault, hpaSystem),
	}

	snapshot, err := builder.Build(context.Background(), "namespace:all")
	require.NoError(t, err)
	require.Equal(t, namespaceAutoscalingDomainName, snapshot.Domain)
	require.Equal(t, "namespace:all", snapshot.Scope)

	payload, ok := snapshot.Payload.(NamespaceAutoscalingSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Resources, 2)

	namespaces := make(map[string]struct{})
	for _, entry := range payload.Resources {
		require.NotEmpty(t, entry.Namespace)
		require.NotEmpty(t, entry.Age)
		namespaces[entry.Namespace] = struct{}{}
	}
	require.Len(t, namespaces, 2)
}

func TestNamespaceEventsBuilder(t *testing.T) {
	now := time.Now()
	eventNew := &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "event-new",
			Namespace:         "default",
			ResourceVersion:   "5",
			CreationTimestamp: metav1.NewTime(now.Add(-5 * time.Minute)),
		},
		Type:    corev1.EventTypeNormal,
		Reason:  "Scheduled",
		Message: "pod scheduled",
		Source: corev1.EventSource{
			Component: "scheduler",
		},
		InvolvedObject: corev1.ObjectReference{
			Kind:      "Pod",
			Name:      "api-0",
			Namespace: "default",
		},
	}

	eventOld := &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "event-old",
			Namespace:         "default",
			ResourceVersion:   "4",
			CreationTimestamp: metav1.NewTime(now.Add(-30 * time.Minute)),
		},
		Type:   corev1.EventTypeWarning,
		Reason: "BackOff",
		InvolvedObject: corev1.ObjectReference{
			Kind:      "Pod",
			Name:      "api-0",
			Namespace: "default",
		},
		Source: corev1.EventSource{
			Component: "kubelet",
			Host:      "node-a",
		},
		Message: "",
	}

	builder := &NamespaceEventsBuilder{
		eventLister: testsupport.NewEventLister(t, eventNew, eventOld),
	}

	snapshot, err := builder.Build(context.Background(), "namespace:default")
	require.NoError(t, err)
	require.Equal(t, uint64(5), snapshot.Version)

	payload, ok := snapshot.Payload.(NamespaceEventsSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Events, 2)

	first := payload.Events[0]
	require.Equal(t, "event-new", first.Name)
	require.Equal(t, "Pod/api-0", first.Object)
	require.Equal(t, "scheduler", first.Source)

	second := payload.Events[1]
	require.Equal(t, "event-old", second.Name)
	require.Contains(t, second.Source, "kubelet")
	require.Equal(t, "Pod/api-0", second.Object)
	require.Equal(t, "BackOff", second.Reason)
}

func TestNamespaceEventsBuilderAllNamespaces(t *testing.T) {
	now := time.Now()

	eventDefault := &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "default-event",
			Namespace:         "default",
			ResourceVersion:   "10",
			CreationTimestamp: metav1.NewTime(now.Add(-5 * time.Minute)),
		},
		Type:   corev1.EventTypeWarning,
		Reason: "CrashLoopBackOff",
		InvolvedObject: corev1.ObjectReference{
			Kind:      "Pod",
			Name:      "api-default",
			Namespace: "default",
		},
		Source: corev1.EventSource{
			Component: "kubelet",
			Host:      "node-a",
		},
		Message: "Back-off restarting failed container",
	}

	eventStaging := &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "staging-event",
			Namespace:         "staging",
			ResourceVersion:   "20",
			CreationTimestamp: metav1.NewTime(now.Add(-2 * time.Minute)),
		},
		Type:   corev1.EventTypeNormal,
		Reason: "Scheduled",
		InvolvedObject: corev1.ObjectReference{
			Kind:      "Pod",
			Name:      "api-staging",
			Namespace: "staging",
		},
		Source: corev1.EventSource{
			Component: "scheduler",
		},
		Message: "Successfully assigned staging/api-staging to node-b",
	}

	builder := &NamespaceEventsBuilder{
		eventLister: testsupport.NewEventLister(t, eventDefault, eventStaging),
	}

	snapshot, err := builder.Build(context.Background(), "namespace:all")
	require.NoError(t, err)
	require.Equal(t, namespaceEventsDomainName, snapshot.Domain)
	require.Equal(t, "namespace:all", snapshot.Scope)

	payload, ok := snapshot.Payload.(NamespaceEventsSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Events, 2)

	namespaces := map[string]struct{}{}
	for _, evt := range payload.Events {
		require.NotEmpty(t, evt.Namespace)
		namespaces[evt.Namespace] = struct{}{}
	}
	require.Contains(t, namespaces, "default")
	require.Contains(t, namespaces, "staging")
}

func TestNamespaceRBACBuilder(t *testing.T) {
	now := time.Now()
	role := &rbacv1.Role{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "edit",
			Namespace:         "default",
			ResourceVersion:   "50",
			CreationTimestamp: metav1.NewTime(now.Add(-3 * time.Hour)),
		},
		Rules: []rbacv1.PolicyRule{{APIGroups: []string{""}}},
	}

	binding := &rbacv1.RoleBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "edit-binding",
			Namespace:         "default",
			ResourceVersion:   "60",
			CreationTimestamp: metav1.NewTime(now.Add(-90 * time.Minute)),
		},
		RoleRef: rbacv1.RoleRef{Kind: "Role", Name: "edit"},
		Subjects: []rbacv1.Subject{{
			Kind: "User", Name: "alice",
		}},
	}

	sa := &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "builder",
			Namespace:         "default",
			ResourceVersion:   "70",
			CreationTimestamp: metav1.NewTime(now.Add(-2 * time.Hour)),
		},
		Secrets: []corev1.ObjectReference{{Name: "builder-token"}},
	}

	builder := &NamespaceRBACBuilder{
		roleLister:    testsupport.NewRoleLister(t, role),
		bindingLister: testsupport.NewRoleBindingLister(t, binding),
		saLister:      testsupport.NewServiceAccountLister(t, sa),
	}

	snapshot, err := builder.Build(context.Background(), "namespace:default")
	require.NoError(t, err)
	require.Equal(t, uint64(70), snapshot.Version)

	payload, ok := snapshot.Payload.(NamespaceRBACSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Resources, 3)

	resources := map[string]RBACSummary{}
	for _, summary := range payload.Resources {
		resources[summary.Kind] = summary
	}

	require.Contains(t, resources["Role"].Details, "Rules: 1")
	require.Contains(t, resources["RoleBinding"].Details, "Role: edit")
	require.Contains(t, resources["RoleBinding"].Details, "Subjects: 1")
	require.Contains(t, resources["ServiceAccount"].Details, "Secrets: 1")
}

func TestNamespaceRBACBuilderAllNamespaces(t *testing.T) {
	now := time.Now()
	roleDefault := &rbacv1.Role{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "view",
			Namespace:         "default",
			ResourceVersion:   "51",
			CreationTimestamp: metav1.NewTime(now.Add(-1 * time.Hour)),
		},
	}
	roleOther := &rbacv1.Role{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "edit",
			Namespace:         "staging",
			ResourceVersion:   "52",
			CreationTimestamp: metav1.NewTime(now.Add(-30 * time.Minute)),
		},
	}
	binding := &rbacv1.RoleBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "view-binding",
			Namespace:         "default",
			ResourceVersion:   "53",
			CreationTimestamp: metav1.NewTime(now.Add(-45 * time.Minute)),
		},
		RoleRef:  rbacv1.RoleRef{Name: roleDefault.Name},
		Subjects: []rbacv1.Subject{{Kind: rbacv1.UserKind, Name: "alice"}},
	}
	sa := &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "builder",
			Namespace:         "staging",
			ResourceVersion:   "54",
			CreationTimestamp: metav1.NewTime(now.Add(-20 * time.Minute)),
		},
	}

	builder := &NamespaceRBACBuilder{
		roleLister:    testsupport.NewRoleLister(t, roleDefault, roleOther),
		bindingLister: testsupport.NewRoleBindingLister(t, binding),
		saLister:      testsupport.NewServiceAccountLister(t, sa),
	}

	snapshot, err := builder.Build(context.Background(), "namespace:all")
	require.NoError(t, err)
	require.Equal(t, namespaceRBACDomainName, snapshot.Domain)
	require.Equal(t, "namespace:all", snapshot.Scope)

	payload, ok := snapshot.Payload.(NamespaceRBACSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Resources, 4)

	namespaces := make(map[string]struct{})
	for _, entry := range payload.Resources {
		require.NotEmpty(t, entry.Namespace)
		namespaces[entry.Namespace] = struct{}{}
	}
	require.True(t, len(namespaces) >= 2)
}

func TestNamespaceRBACBuilderStableOrdering(t *testing.T) {
	now := time.Now()
	roleDefault := &rbacv1.Role{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "alpha",
			Namespace:         "default",
			ResourceVersion:   "10",
			CreationTimestamp: metav1.NewTime(now.Add(-1 * time.Hour)),
		},
	}
	roleStaging := &rbacv1.Role{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "beta",
			Namespace:         "staging",
			ResourceVersion:   "11",
			CreationTimestamp: metav1.NewTime(now.Add(-50 * time.Minute)),
		},
	}
	bindingDefault := &rbacv1.RoleBinding{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "z-binding",
			Namespace:         "default",
			ResourceVersion:   "12",
			CreationTimestamp: metav1.NewTime(now.Add(-45 * time.Minute)),
		},
	}
	serviceAccount := &corev1.ServiceAccount{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "a-serviceaccount",
			Namespace:         "staging",
			ResourceVersion:   "13",
			CreationTimestamp: metav1.NewTime(now.Add(-30 * time.Minute)),
		},
	}

	builder := &NamespaceRBACBuilder{
		roleLister:    testsupport.NewRoleLister(t, roleStaging, roleDefault),
		bindingLister: testsupport.NewRoleBindingLister(t, bindingDefault),
		saLister:      testsupport.NewServiceAccountLister(t, serviceAccount),
	}

	snapshot, err := builder.Build(context.Background(), "namespace:all")
	require.NoError(t, err)

	payload, ok := snapshot.Payload.(NamespaceRBACSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Resources, 4)

	var ordered []string
	for _, entry := range payload.Resources {
		ordered = append(ordered, fmt.Sprintf("%s:%s:%s", entry.Namespace, entry.Kind, entry.Name))
	}

	require.Equal(t, []string{
		"default:Role:alpha",
		"default:RoleBinding:z-binding",
		"staging:Role:beta",
		"staging:ServiceAccount:a-serviceaccount",
	}, ordered)
}

func TestNamespaceWorkloadsBuilder(t *testing.T) {
	now := time.Now()
	replicas := int32(1)

	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "web",
			Namespace:         "default",
			ResourceVersion:   "10",
			CreationTimestamp: metav1.NewTime(now.Add(-1 * time.Hour)),
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: &replicas,
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}},
		},
		Status: appsv1.DeploymentStatus{
			ReadyReplicas: 1,
			Replicas:      1,
		},
	}

	replicaSetOwner := true
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "web-abc123",
			Namespace:         "default",
			ResourceVersion:   "20",
			CreationTimestamp: metav1.NewTime(now.Add(-30 * time.Minute)),
			OwnerReferences: []metav1.OwnerReference{{
				Kind:       "ReplicaSet",
				Name:       "web-abc123",
				Controller: &replicaSetOwner,
			}},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
			ContainerStatuses: []corev1.ContainerStatus{{
				Name:         "web",
				Ready:        true,
				RestartCount: 0,
			}},
		},
	}

	provider := &workloadMetricsProvider{
		pods: map[string]metrics.PodUsage{
			"default/web-abc123": {CPUUsageMilli: 80, MemoryUsageBytes: 150 * 1024 * 1024},
		},
	}

	builder := &NamespaceWorkloadsBuilder{
		podLister:        testsupport.NewPodLister(t, pod),
		deploymentLister: testsupport.NewDeploymentLister(t, deployment),
		statefulLister:   testsupport.NewStatefulSetLister(t),
		daemonLister:     testsupport.NewDaemonSetLister(t),
		jobLister:        testsupport.NewJobLister(t),
		cronJobLister:    testsupport.NewCronJobLister(t),
		metrics:          provider,
	}

	snapshot, err := builder.Build(context.Background(), "namespace:default")
	require.NoError(t, err)
	require.Equal(t, namespaceWorkloadsDomainName, snapshot.Domain)

	payload, ok := snapshot.Payload.(NamespaceWorkloadsSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Workloads, 1)

	summaries := map[string]WorkloadSummary{}
	for _, summary := range payload.Workloads {
		summaries[summary.Kind+"-"+summary.Name] = summary
	}

	deploySummary, ok := summaries["Deployment-web"]
	require.True(t, ok)
	require.Equal(t, "1/1", deploySummary.Ready)
	require.Equal(t, "Running", deploySummary.Status)
	require.NotEmpty(t, deploySummary.Age)

}

func TestNamespaceWorkloadsBuilderAllNamespaces(t *testing.T) {
	now := time.Now()
	replicas := int32(2)

	webDeployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "web",
			Namespace:         "default",
			ResourceVersion:   "101",
			CreationTimestamp: metav1.NewTime(now.Add(-90 * time.Minute)),
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: &replicas,
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}},
		},
		Status: appsv1.DeploymentStatus{
			ReadyReplicas: 2,
			Replicas:      2,
		},
	}

	apiDeployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "api",
			Namespace:         "staging",
			ResourceVersion:   "102",
			CreationTimestamp: metav1.NewTime(now.Add(-45 * time.Minute)),
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: &replicas,
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "api"}},
		},
		Status: appsv1.DeploymentStatus{
			ReadyReplicas: 1,
			Replicas:      2,
		},
	}

	replicaSetOwner := true
	webPod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "web-123",
			Namespace:         "default",
			ResourceVersion:   "201",
			CreationTimestamp: metav1.NewTime(now.Add(-50 * time.Minute)),
			OwnerReferences: []metav1.OwnerReference{{
				Kind:       "ReplicaSet",
				Name:       "web-123",
				Controller: &replicaSetOwner,
			}},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
			ContainerStatuses: []corev1.ContainerStatus{{
				Name:         "web",
				Ready:        true,
				RestartCount: 0,
			}},
		},
	}

	apiPod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "api-789",
			Namespace:         "staging",
			ResourceVersion:   "202",
			CreationTimestamp: metav1.NewTime(now.Add(-20 * time.Minute)),
			OwnerReferences: []metav1.OwnerReference{{
				Kind:       "ReplicaSet",
				Name:       "api-789",
				Controller: &replicaSetOwner,
			}},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
			ContainerStatuses: []corev1.ContainerStatus{{
				Name:         "api",
				Ready:        true,
				RestartCount: 1,
			}},
		},
	}

	builder := &NamespaceWorkloadsBuilder{
		podLister:        testsupport.NewPodLister(t, webPod, apiPod),
		deploymentLister: testsupport.NewDeploymentLister(t, webDeployment, apiDeployment),
		statefulLister:   testsupport.NewStatefulSetLister(t),
		daemonLister:     testsupport.NewDaemonSetLister(t),
		jobLister:        testsupport.NewJobLister(t),
		cronJobLister:    testsupport.NewCronJobLister(t),
		metrics:          &workloadMetricsProvider{pods: map[string]metrics.PodUsage{}},
	}
	snapshot, err := builder.Build(context.Background(), "namespace:all")
	require.NoError(t, err)
	require.Equal(t, namespaceWorkloadsDomainName, snapshot.Domain)
	require.Equal(t, "namespace:all", snapshot.Scope)

	payload, ok := snapshot.Payload.(NamespaceWorkloadsSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Workloads, 2)

	namespaces := map[string]struct{}{}
	for _, summary := range payload.Workloads {
		require.NotEmpty(t, summary.Namespace)
		namespaces[summary.Namespace] = struct{}{}
	}
	require.Len(t, namespaces, 2)
}

func mustQuantity(t testing.TB, value string) resource.Quantity {
	t.Helper()
	q, err := resource.ParseQuantity(value)
	if err != nil {
		t.Fatalf("failed to parse quantity %s: %v", value, err)
	}
	return q
}

type workloadMetricsProvider struct {
	pods map[string]metrics.PodUsage
}

func (f *workloadMetricsProvider) LatestNodeUsage() map[string]metrics.NodeUsage {
	return map[string]metrics.NodeUsage{}
}

func (f *workloadMetricsProvider) LatestPodUsage() map[string]metrics.PodUsage {
	return f.pods
}

func (f *workloadMetricsProvider) Metadata() metrics.Metadata {
	return metrics.Metadata{}
}
