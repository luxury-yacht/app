// backend/refresh/snapshot/streaming_helpers_test.go
//
// Verifies stream row projection helpers keep parity with snapshot builders.
package snapshot

import (
	"encoding/json"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	networkingv1 "k8s.io/api/networking/v1"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	v1 "k8s.io/client-go/listers/apps/v1"
	"k8s.io/client-go/tools/cache"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"

	"github.com/stretchr/testify/require"

	"github.com/luxury-yacht/app/backend/refresh/metrics"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/apiextensions"
	"github.com/luxury-yacht/app/backend/resources/backendtlspolicy"
	"github.com/luxury-yacht/app/backend/resources/configmap"
	"github.com/luxury-yacht/app/backend/resources/customresource"
	"github.com/luxury-yacht/app/backend/resources/endpointslice"
	gatewaypkg "github.com/luxury-yacht/app/backend/resources/gateway"
	"github.com/luxury-yacht/app/backend/resources/gatewayclass"
	hpapkg "github.com/luxury-yacht/app/backend/resources/hpa"
	"github.com/luxury-yacht/app/backend/resources/httproute"
	ingresspkg "github.com/luxury-yacht/app/backend/resources/ingress"
	"github.com/luxury-yacht/app/backend/resources/ingressclass"
	"github.com/luxury-yacht/app/backend/resources/listenerset"
	"github.com/luxury-yacht/app/backend/resources/networkpolicy"
	podres "github.com/luxury-yacht/app/backend/resources/pods"
	"github.com/luxury-yacht/app/backend/resources/referencegrant"
	secretpkg "github.com/luxury-yacht/app/backend/resources/secret"
	servicepkg "github.com/luxury-yacht/app/backend/resources/service"
)

func TestBuildPodSummaryResolvesDeploymentOwner(t *testing.T) {
	rs := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "web-abc",
			Namespace: "default",
			OwnerReferences: []metav1.OwnerReference{{
				Kind:       "Deployment",
				Name:       "web",
				Controller: ptrBool(true),
			}},
		},
	}
	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{
		cache.NamespaceIndex: cache.MetaNamespaceIndexFunc,
	})
	require.NoError(t, indexer.Add(rs))
	rsLister := v1.NewReplicaSetLister(indexer)

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "pod-1",
			Namespace: "default",
			OwnerReferences: []metav1.OwnerReference{{
				Kind:       "ReplicaSet",
				Name:       "web-abc",
				Controller: ptrBool(true),
			}},
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{{
				Name:  "app",
				Image: "example/app:1.0.0",
				Ports: []corev1.ContainerPort{{ContainerPort: 8080}},
			}},
		},
	}

	summary := buildPodSummaryForTest(ClusterMeta{ClusterID: "c1", ClusterName: "cluster"}, pod, nil, rsLister)
	require.Equal(t, "Deployment", summary.OwnerKind)
	require.Equal(t, "web", summary.OwnerName)
	require.True(t, summary.PortForwardAvailable)
}

func TestBuildPodSummaryMarksNoForwardablePorts(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "pod-1",
			Namespace: "default",
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{{
				Name:  "dns",
				Image: "example/dns:1.0.0",
				Ports: []corev1.ContainerPort{{ContainerPort: 53, Protocol: corev1.ProtocolUDP}},
			}},
		},
	}

	summary := buildPodSummaryForTest(ClusterMeta{ClusterID: "c1", ClusterName: "cluster"}, pod, nil, nil)
	require.False(t, summary.PortForwardAvailable)
}

func TestBuildPodSummaryUsesSharedPodStatusPresentation(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "pod-1",
			Namespace: "default",
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{{Name: "app"}, {Name: "sidecar"}},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
			ContainerStatuses: []corev1.ContainerStatus{{
				Name:  "app",
				Ready: true,
				State: corev1.ContainerState{Running: &corev1.ContainerStateRunning{}},
			}},
		},
	}

	summary := buildPodSummaryForTest(ClusterMeta{ClusterID: "c1", ClusterName: "cluster"}, pod, nil, nil)
	require.Equal(t, "Running", summary.Status)
	require.Equal(t, "Running", summary.StatusState)
	require.Equal(t, "warning", summary.StatusPresentation)
	require.Equal(t, "1/2", summary.Ready)
}

func TestBuildConfigSummariesUseSharedConfigFacts(t *testing.T) {
	configMap := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{Name: "app-config", Namespace: "default"},
		Data:       map[string]string{"app.yaml": "enabled: true"},
		BinaryData: map[string][]byte{"cert.der": []byte("cert")},
	}
	configMapSummary := configmap.BuildStreamSummary(ClusterMeta{ClusterID: "c1", ClusterName: "cluster"}, configMap)
	require.Equal(t, "ConfigMap", configMapSummary.Ref.Kind)
	require.Equal(t, "CM", configMapSummary.TypeAlias)
	require.Equal(t, 2, configMapSummary.Data)

	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: "app-secret", Namespace: "default"},
		Type:       corev1.SecretTypeTLS,
		Data:       map[string][]byte{"tls.crt": []byte("cert")},
		StringData: map[string]string{"write-only": "not-returned-by-api"},
	}
	secretSummary := secretpkg.BuildStreamSummary(ClusterMeta{ClusterID: "c1", ClusterName: "cluster"}, secret)
	require.Equal(t, "Secret", secretSummary.Ref.Kind)
	require.Equal(t, "TLS", secretSummary.TypeAlias)
	require.Equal(t, 1, secretSummary.Data)
}

func TestBuildNetworkSummariesUseSharedNetworkFacts(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c1", ClusterName: "cluster"}
	ready := true
	port := int32(443)
	protocol := corev1.ProtocolTCP
	service := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{Name: "api", Namespace: "default"},
		Spec: corev1.ServiceSpec{
			Type:      corev1.ServiceTypeClusterIP,
			ClusterIP: "10.0.0.10",
			Ports:     []corev1.ServicePort{{Port: 443, Protocol: corev1.ProtocolTCP}},
		},
	}
	slice := &discoveryv1.EndpointSlice{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "api-a",
			Namespace: "default",
			Labels:    map[string]string{discoveryv1.LabelServiceName: "api"},
		},
		AddressType: discoveryv1.AddressTypeIPv4,
		Ports:       []discoveryv1.EndpointPort{{Port: &port, Protocol: &protocol}},
		Endpoints: []discoveryv1.Endpoint{{
			Addresses:  []string{"10.244.0.10"},
			Conditions: discoveryv1.EndpointConditions{Ready: &ready},
		}},
	}

	serviceSummary := servicepkg.BuildStreamSummary(meta, service, []*discoveryv1.EndpointSlice{slice})
	require.Equal(t, "Service", serviceSummary.Ref.Kind)
	require.Equal(t, "api", serviceSummary.Ref.Name)
	require.Equal(t, []resourcemodel.DetailSegment{
		{Slot: resourcemodel.DetailSlotReference, Label: "Type", Value: "ClusterIP"},
		{Slot: resourcemodel.DetailSlotAddress, Label: "Cluster IP", Value: "10.0.0.10"},
		{Slot: resourcemodel.DetailSlotAddress, Label: "Ports", Value: "443/TCP"},
		{Slot: resourcemodel.DetailSlotCounts, Label: "Endpoints", Value: "1"},
	}, serviceSummary.Details)

	sliceFacts := endpointslice.BuildFacts(meta.ClusterID, slice)
	sliceSummary := endpointslice.BuildStreamSummary(meta, slice)
	require.Equal(t, "EndpointSlice", sliceSummary.Ref.Kind)
	require.Equal(t, []resourcemodel.DetailSegment{
		{Slot: resourcemodel.DetailSlotReference, Label: "Service", Value: "api", Link: sliceFacts.Service},
		{Slot: resourcemodel.DetailSlotAddress, Label: "Addresses", Value: "10.244.0.10"},
		{Slot: resourcemodel.DetailSlotCounts, Label: "Ready", Value: "1"},
	}, sliceSummary.Details)

	// A slice with a not-ready endpoint surfaces it as a warning-presented
	// segment; an orphan slice (no service-name label) has no Service segment.
	notReadyCondition := false
	orphanSlice := &discoveryv1.EndpointSlice{
		ObjectMeta:  metav1.ObjectMeta{Name: "orphan-a", Namespace: "default"},
		AddressType: discoveryv1.AddressTypeIPv4,
		Endpoints: []discoveryv1.Endpoint{
			{Addresses: []string{"10.244.0.11"}, Conditions: discoveryv1.EndpointConditions{Ready: &ready}},
			{Addresses: []string{"10.244.0.12"}, Conditions: discoveryv1.EndpointConditions{Ready: &notReadyCondition}},
		},
	}
	orphanSummary := endpointslice.BuildStreamSummary(meta, orphanSlice)
	require.Equal(t, []resourcemodel.DetailSegment{
		// Only READY addresses fill the address slot; not-ready is flagged in counts.
		{Slot: resourcemodel.DetailSlotAddress, Label: "Addresses", Value: "10.244.0.11"},
		{Slot: resourcemodel.DetailSlotCounts, Label: "Ready", Value: "1"},
		{Slot: resourcemodel.DetailSlotCounts, Label: "Not ready", Value: "1", Presentation: "warning"},
	}, orphanSummary.Details)

	ingress := &networkingv1.Ingress{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default"},
		Spec: networkingv1.IngressSpec{
			IngressClassName: stringPtr("nginx"),
			Rules:            []networkingv1.IngressRule{{Host: "web.example.com"}},
		},
	}
	ingressFacts := ingresspkg.BuildFacts(meta.ClusterID, ingress)
	ingressSummary := ingresspkg.BuildStreamSummary(meta, ingress)
	require.Equal(t, "Ingress", ingressSummary.Ref.Kind)
	require.Equal(t, []resourcemodel.DetailSegment{
		{Slot: resourcemodel.DetailSlotReference, Label: "Class", Value: "nginx", Link: ingressFacts.Class},
		{Slot: resourcemodel.DetailSlotAddress, Label: "Hosts", Value: "web.example.com"},
		{Slot: resourcemodel.DetailSlotCounts, Label: "Rules", Value: "1"},
	}, ingressSummary.Details)

	policy := &networkingv1.NetworkPolicy{
		ObjectMeta: metav1.ObjectMeta{Name: "egress", Namespace: "default"},
		Spec: networkingv1.NetworkPolicySpec{
			Egress: []networkingv1.NetworkPolicyEgressRule{{}},
		},
	}
	policySummary := networkpolicy.BuildStreamSummary(meta, policy)
	require.Equal(t, "NetworkPolicy", policySummary.Ref.Kind)
	require.Equal(t, []resourcemodel.DetailSegment{
		{Slot: resourcemodel.DetailSlotReference, Label: "Policy", Value: "Ingress, Egress"},
		{Slot: resourcemodel.DetailSlotCounts, Label: "Rules", Value: "1"},
	}, policySummary.Details)
}

func TestBuildClusterIngressClassSummaryUsesSharedNetworkFacts(t *testing.T) {
	ingressClass := &networkingv1.IngressClass{
		ObjectMeta: metav1.ObjectMeta{
			Name:        "nginx",
			Annotations: map[string]string{"ingressclass.kubernetes.io/is-default-class": "true"},
		},
		Spec: networkingv1.IngressClassSpec{Controller: "k8s.io/ingress-nginx"},
	}

	summary := ingressclass.BuildStreamSummary(ClusterMeta{ClusterID: "c1", ClusterName: "cluster"}, ingressClass)
	require.Equal(t, "IngressClass", summary.Ref.Kind)
	require.Equal(t, "nginx", summary.Ref.Name)
	require.Equal(t, "k8s.io/ingress-nginx", summary.Details)
	require.True(t, summary.IsDefault)
}

func TestBuildGatewayAPISummariesUseSharedGatewayFacts(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c1", ClusterName: "cluster"}
	gateway := &gatewayv1.Gateway{
		ObjectMeta: metav1.ObjectMeta{Name: "edge", Namespace: "default"},
		Spec: gatewayv1.GatewaySpec{
			GatewayClassName: gatewayv1.ObjectName("public"),
			Listeners:        []gatewayv1.Listener{{Name: gatewayv1.SectionName("http"), Port: gatewayv1.PortNumber(80), Protocol: gatewayv1.HTTPProtocolType}},
		},
	}
	gatewayFacts := gatewaypkg.BuildFacts(meta.ClusterID, gateway)
	gatewaySummary := gatewaypkg.BuildStreamSummary(meta, gateway)
	require.Equal(t, "Gateway", gatewaySummary.Ref.Kind)
	require.Equal(t, []resourcemodel.DetailSegment{
		{Slot: resourcemodel.DetailSlotReference, Label: "Class", Value: "public", Link: gatewayFacts.Class},
		{Slot: resourcemodel.DetailSlotCounts, Label: "Listeners", Value: "1"},
	}, gatewaySummary.Details)

	route := &gatewayv1.HTTPRoute{
		ObjectMeta: metav1.ObjectMeta{Name: "api", Namespace: "default"},
		Spec: gatewayv1.HTTPRouteSpec{
			CommonRouteSpec: gatewayv1.CommonRouteSpec{ParentRefs: []gatewayv1.ParentReference{{Name: gatewayv1.ObjectName("edge")}}},
			Hostnames:       []gatewayv1.Hostname{"api.example.com"},
			Rules:           []gatewayv1.HTTPRouteRule{{}},
		},
	}
	routeFacts := httproute.BuildFacts(meta.ClusterID, route)
	routeSummary := httproute.BuildStreamSummary(meta, route)
	require.Equal(t, "HTTPRoute", routeSummary.Ref.Kind)
	require.Equal(t, []resourcemodel.DetailSegment{
		{Slot: resourcemodel.DetailSlotReference, Label: "Parent", Value: "edge", Link: &routeFacts.ParentRefs[0]},
		{Slot: resourcemodel.DetailSlotAddress, Label: "Hosts", Value: "api.example.com"},
		{Slot: resourcemodel.DetailSlotCounts, Label: "Rules", Value: "1"},
	}, routeSummary.Details)

	listenerSet := &gatewayv1.ListenerSet{
		ObjectMeta: metav1.ObjectMeta{Name: "extra", Namespace: "default"},
		Spec: gatewayv1.ListenerSetSpec{
			ParentRef: gatewayv1.ParentGatewayReference{Name: gatewayv1.ObjectName("edge")},
			Listeners: []gatewayv1.ListenerEntry{{Name: gatewayv1.SectionName("http"), Port: gatewayv1.PortNumber(80), Protocol: gatewayv1.HTTPProtocolType}},
		},
	}
	listenerSetFacts := listenerset.BuildFacts(meta.ClusterID, listenerSet)
	listenerSetSummary := listenerset.BuildStreamSummary(meta, listenerSet)
	require.Equal(t, "ListenerSet", listenerSetSummary.Ref.Kind)
	require.Equal(t, []resourcemodel.DetailSegment{
		{Slot: resourcemodel.DetailSlotReference, Label: "Parent", Value: "edge", Link: &listenerSetFacts.ParentRef},
		// Hostless listeners fall back to the compact port list.
		{Slot: resourcemodel.DetailSlotAddress, Label: "Ports", Value: "80/HTTP"},
		{Slot: resourcemodel.DetailSlotCounts, Label: "Listeners", Value: "1"},
	}, listenerSetSummary.Details)

	hostedListenerSet := &gatewayv1.ListenerSet{
		ObjectMeta: metav1.ObjectMeta{Name: "hosted", Namespace: "default"},
		Spec: gatewayv1.ListenerSetSpec{
			ParentRef: gatewayv1.ParentGatewayReference{Name: gatewayv1.ObjectName("edge")},
			Listeners: []gatewayv1.ListenerEntry{
				{Name: gatewayv1.SectionName("a"), Hostname: gatewayHostnamePtr("a.example.com"), Port: gatewayv1.PortNumber(443), Protocol: gatewayv1.HTTPSProtocolType},
				{Name: gatewayv1.SectionName("b"), Hostname: gatewayHostnamePtr("b.example.com"), Port: gatewayv1.PortNumber(443), Protocol: gatewayv1.HTTPSProtocolType},
			},
		},
	}
	hostedFacts := listenerset.BuildFacts(meta.ClusterID, hostedListenerSet)
	hostedSummary := listenerset.BuildStreamSummary(meta, hostedListenerSet)
	require.Equal(t, []resourcemodel.DetailSegment{
		{Slot: resourcemodel.DetailSlotReference, Label: "Parent", Value: "edge", Link: &hostedFacts.ParentRef},
		{Slot: resourcemodel.DetailSlotAddress, Label: "Hosts", Value: "a.example.com +1", Search: "a.example.com, b.example.com"},
		{Slot: resourcemodel.DetailSlotCounts, Label: "Listeners", Value: "2"},
	}, hostedSummary.Details)

	grant := &gatewayv1.ReferenceGrant{
		ObjectMeta: metav1.ObjectMeta{Name: "allow", Namespace: "default"},
		Spec: gatewayv1.ReferenceGrantSpec{
			From: []gatewayv1.ReferenceGrantFrom{{Group: gatewayv1.Group("gateway.networking.k8s.io"), Kind: gatewayv1.Kind("HTTPRoute"), Namespace: gatewayv1.Namespace("apps")}},
			To:   []gatewayv1.ReferenceGrantTo{{Group: gatewayv1.Group(""), Kind: gatewayv1.Kind("Service"), Name: gatewayObjectNamePtr("api")}},
		},
	}
	grantSummary := referencegrant.BuildStreamSummary(meta, grant)
	require.Equal(t, "ReferenceGrant", grantSummary.Ref.Kind)
	require.Equal(t, []resourcemodel.DetailSegment{
		{Slot: resourcemodel.DetailSlotReference, Label: "Access", Value: "HTTPRoute → Service"},
		{Slot: resourcemodel.DetailSlotCounts, Label: "From", Value: "1"},
		{Slot: resourcemodel.DetailSlotCounts, Label: "To", Value: "1"},
	}, grantSummary.Details)

	policy := &gatewayv1.BackendTLSPolicy{
		ObjectMeta: metav1.ObjectMeta{Name: "tls", Namespace: "default"},
		Spec: gatewayv1.BackendTLSPolicySpec{TargetRefs: []gatewayv1.LocalPolicyTargetReferenceWithSectionName{{
			LocalPolicyTargetReference: gatewayv1.LocalPolicyTargetReference{Group: gatewayv1.Group(""), Kind: gatewayv1.Kind("Service"), Name: gatewayv1.ObjectName("api")},
		}}},
	}
	tlsPolicyFacts := backendtlspolicy.BuildFacts(meta.ClusterID, policy)
	policySummary := backendtlspolicy.BuildStreamSummary(meta, policy)
	require.Equal(t, "BackendTLSPolicy", policySummary.Ref.Kind)
	require.Equal(t, []resourcemodel.DetailSegment{
		{Slot: resourcemodel.DetailSlotReference, Label: "Target", Value: "api", Link: &tlsPolicyFacts.TargetRefs[0]},
		{Slot: resourcemodel.DetailSlotCounts, Label: "Targets", Value: "1"},
	}, policySummary.Details)

	gatewayClass := &gatewayv1.GatewayClass{
		ObjectMeta: metav1.ObjectMeta{Name: "public"},
		Spec:       gatewayv1.GatewayClassSpec{ControllerName: "example.com/controller"},
	}
	classSummary := gatewayclass.BuildStreamSummary(meta, gatewayClass)
	require.Equal(t, "GatewayClass", classSummary.Ref.Kind)
	require.Equal(t, "example.com/controller", classSummary.Details)
}

func ptrBool(value bool) *bool {
	return &value
}

func ptrInt32(value int32) *int32 {
	return &value
}

func gatewayObjectNamePtr(value string) *gatewayv1.ObjectName {
	name := gatewayv1.ObjectName(value)
	return &name
}

func gatewayHostnamePtr(value string) *gatewayv1.Hostname {
	hostname := gatewayv1.Hostname(value)
	return &hostname
}

// TestBuildClusterCRDSummaryPopulatesAllFields is a regression guard for
// the dual-path drift bug: the streaming/incremental update path used to
// emit CRD rows without StorageVersion / ExtraServedVersionCount, which
// caused the Version column in the cluster CRDs view to "disappear" for
// rows that received a streaming update. The fix was to make the full-
// snapshot builder delegate to BuildClusterCRDSummary so the two paths
// share one row constructor.
//
// **This test exists to catch future drift.** Any new field added to
// ClusterCRDEntry must be populated by BuildClusterCRDSummary; assert it
// here so a missing field surfaces as a test failure rather than an
// invisible production bug.
func TestBuildClusterCRDSummaryPopulatesAllFields(t *testing.T) {
	crd := &apiextensionsv1.CustomResourceDefinition{
		ObjectMeta: metav1.ObjectMeta{
			Name: "dbinstances.rds.services.k8s.aws",
		},
		Spec: apiextensionsv1.CustomResourceDefinitionSpec{
			Group: "rds.services.k8s.aws",
			Scope: apiextensionsv1.NamespaceScoped,
			Names: apiextensionsv1.CustomResourceDefinitionNames{
				Plural: "dbinstances",
				Kind:   "DBInstance",
			},
			Versions: []apiextensionsv1.CustomResourceDefinitionVersion{
				{Name: "v1alpha1", Served: true, Storage: false},
				{Name: "v1beta1", Served: true, Storage: false},
				{Name: "v1", Served: true, Storage: true},
			},
		},
	}

	meta := ClusterMeta{ClusterID: "c1", ClusterName: "cluster"}
	row := apiextensions.BuildStreamSummary(meta, crd)

	require.Equal(t, "c1", row.Ref.ClusterID)
	require.Equal(t, "CustomResourceDefinition", row.Ref.Kind)
	require.Equal(t, crd.Name, row.Ref.Name)
	require.Equal(t, "rds.services.k8s.aws", row.Group)
	require.Equal(t, "Namespaced", row.Scope)
	require.Equal(t, "CRD", row.TypeAlias)
	require.Contains(t, row.Details, "v1*", "Details should mark storage version with *")
	// The two fields that the streaming path used to drop. Asserting them
	// explicitly catches future drift if a new field is added without
	// being plumbed here.
	require.Equal(t, "v1", row.StorageVersion)
	require.Equal(t, 2, row.ExtraServedVersionCount)
}

// TestBuildClusterCRDSummaryNilCRDIsSafe ensures the streaming path
// doesn't panic on a nil CRD (which can happen briefly during cache
// warmup or delete events).
func TestBuildClusterCRDSummaryNilCRDIsSafe(t *testing.T) {
	row := apiextensions.BuildStreamSummary(ClusterMeta{ClusterID: "c1"}, nil)
	require.Equal(t, "c1", row.Ref.ClusterID)
	require.Equal(t, "CustomResourceDefinition", row.Ref.Kind)
	require.Empty(t, row.StorageVersion)
	require.Equal(t, 0, row.ExtraServedVersionCount)
}

// TestBuildHPASummaryPopulatesTargetAPIVersion is a regression guard for
// the HPA variant of the dual-path drift bug. Before the fix, the
// streaming path emitted AutoscalingSummary rows without TargetAPIVersion,
// and HPAs receive streaming updates constantly as Status.CurrentReplicas
// changes. That silently re-introduced the kind-only-objects bug for any
// HPA targeting a CRD with a scale subresource (Argo Rollout, KEDA,
// custom workload operators).
//
// **Any new field added to AutoscalingSummary MUST be asserted here** so
// a missing field surfaces as a test failure rather than an invisible
// production regression.
func TestBuildHPASummaryPopulatesTargetAPIVersion(t *testing.T) {
	minReplicasVal := int32(2)
	hpa := &autoscalingv1.HorizontalPodAutoscaler{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "rollout-hpa",
			Namespace: "prod",
		},
		Spec: autoscalingv1.HorizontalPodAutoscalerSpec{
			ScaleTargetRef: autoscalingv1.CrossVersionObjectReference{
				Kind:       "Rollout",
				Name:       "canary",
				APIVersion: "argoproj.io/v1alpha1",
			},
			MinReplicas: &minReplicasVal,
			MaxReplicas: 10,
		},
		Status: autoscalingv1.HorizontalPodAutoscalerStatus{
			CurrentReplicas: 5,
		},
	}

	row := hpapkg.BuildStreamSummary(ClusterMeta{ClusterID: "c1", ClusterName: "cluster"}, hpa)

	require.Equal(t, "c1", row.Ref.ClusterID)
	require.Equal(t, "HorizontalPodAutoscaler", row.Ref.Kind)
	require.Equal(t, "rollout-hpa", row.Ref.Name)
	require.Equal(t, "prod", row.Ref.Namespace)
	require.Equal(t, "Rollout/canary", row.Target)
	// The field that the streaming path used to drop. Asserting it
	// explicitly catches any future drift of the HPA row builder.
	require.Equal(t, "argoproj.io/v1alpha1", row.TargetAPIVersion)
	require.Equal(t, int32(2), row.Min)
	require.Equal(t, int32(10), row.Max)
	require.Equal(t, int32(5), row.Current)
}

// TestBuildHPASummaryNilHPAIsSafe ensures the streaming path doesn't
// panic on a nil HPA.
func TestBuildHPASummaryNilHPAIsSafe(t *testing.T) {
	row := hpapkg.BuildStreamSummary(ClusterMeta{ClusterID: "c1"}, nil)
	require.Equal(t, "c1", row.Ref.ClusterID)
	require.Equal(t, "HorizontalPodAutoscaler", row.Ref.Kind)
	require.Empty(t, row.TargetAPIVersion)
}

// TestBuildNamespaceCustomSummaryFallsBackToDefaultNamespace verifies
// the convergence behavior: when an unstructured resource doesn't carry
// its own namespace (rare but possible), the builder falls back to the
// defaultNamespace parameter. The snapshot path passes its scope
// namespace; the streaming path passes the resource's own namespace.
// Before the convergence these two paths behaved differently.
func TestBuildNamespaceCustomSummaryFallsBackToDefaultNamespace(t *testing.T) {
	resourceWithNamespace := &unstructured.Unstructured{}
	resourceWithNamespace.SetAPIVersion("example.com/v1")
	resourceWithNamespace.SetKind("Foo")
	resourceWithNamespace.SetName("explicit")
	resourceWithNamespace.SetNamespace("team-a")

	row := customresource.BuildNamespaceStreamSummary(
		ClusterMeta{ClusterID: "c1"},
		resourceWithNamespace, customresource.NewDescriptor(

			"example.com",
			"v1",
			"foos",
			"Foo",
			"foos.example.com"),

		"fallback-ns")

	require.Equal(t, "team-a", row.Ref.Namespace, "resource's own namespace wins over fallback")
	require.Equal(t, "foos.example.com", row.CRDName, "CRDName threads through verbatim")

	resourceWithoutNamespace := &unstructured.Unstructured{}
	resourceWithoutNamespace.SetAPIVersion("example.com/v1")
	resourceWithoutNamespace.SetKind("Foo")
	resourceWithoutNamespace.SetName("implicit")

	row = customresource.BuildNamespaceStreamSummary(
		ClusterMeta{ClusterID: "c1"},
		resourceWithoutNamespace, customresource.NewDescriptor(

			"example.com",
			"v1",
			"foos",
			"Foo",
			"foos.example.com"),

		"fallback-ns")

	require.Equal(t, "fallback-ns", row.Ref.Namespace, "empty namespace falls back to default")
}

// TestBuildNamespaceCustomSummaryNilResourceIsSafe ensures the streaming
// path doesn't panic on a nil resource.
func TestBuildNamespaceCustomSummaryNilResourceIsSafe(t *testing.T) {
	row := customresource.BuildNamespaceStreamSummary(
		ClusterMeta{ClusterID: "c1"},
		nil, customresource.NewDescriptor(

			"example.com",
			"v1",
			"foos",
			"Foo",
			"foos.example.com"),

		"fallback-ns")

	require.Equal(t, "c1", row.Ref.ClusterID)
	require.Equal(t, "Foo", row.Ref.Kind)
	require.Equal(t, "example.com", row.Ref.Group)
	require.Equal(t, "v1", row.Ref.Version)
	require.Equal(t, "foos.example.com", row.CRDName)
}

func TestBuildNamespaceCustomSummaryWireIdentityUsesGroupVersion(t *testing.T) {
	row := customresource.BuildNamespaceStreamSummary(
		ClusterMeta{ClusterID: "c1"},
		nil, customresource.NewDescriptor(

			"example.com",
			"v1",
			"foos",
			"Foo",
			"foos.example.com"),

		"fallback-ns")

	payload, err := json.Marshal(row)
	require.NoError(t, err)

	var fields map[string]any
	require.NoError(t, json.Unmarshal(payload, &fields))
	ref, ok := fields["ref"].(map[string]any)
	require.True(t, ok)
	require.Equal(t, "example.com", ref["group"])
	require.Equal(t, "v1", ref["version"])
	require.NotContains(t, fields, "group")
	require.NotContains(t, fields, "version")
	require.NotContains(t, fields, "apiGroup")
	require.NotContains(t, fields, "apiVersion")
}

// TestBuildClusterCustomSummaryThreadsCRDName is the cluster-scoped
// twin of the namespace-scoped regression test below. Same shape of bug
// to guard against: the frontend's CRD column in ClusterViewCustom
// relies on this being populated by both the snapshot path (which
// passes `crd.Name`) and the streaming path (which passes
// `gvr.Resource + "." + gvr.Group`).
//
// Any new field added to ClusterCustomSummary MUST be asserted here.
func TestBuildClusterCustomSummaryThreadsCRDName(t *testing.T) {
	resource := &unstructured.Unstructured{}
	resource.SetAPIVersion("rds.services.k8s.aws/v1alpha1")
	resource.SetKind("DBCluster")
	resource.SetName("primary")

	row := customresource.BuildClusterStreamSummary(
		ClusterMeta{ClusterID: "c1"},
		resource, customresource.NewDescriptor(

			"rds.services.k8s.aws",
			"v1alpha1",
			"dbclusters",
			"DBCluster",
			"dbclusters.rds.services.k8s.aws"))

	require.Equal(t, "c1", row.Ref.ClusterID)
	require.Equal(t, "DBCluster", row.Ref.Kind)
	require.Equal(t, "primary", row.Ref.Name)
	require.Equal(t, "rds.services.k8s.aws", row.Ref.Group)
	require.Equal(t, "v1alpha1", row.Ref.Version)
	require.Equal(t, "dbclusters.rds.services.k8s.aws", row.CRDName)
	require.Equal(t, "Unknown", row.Status)
	require.Equal(t, "unknown", row.StatusState)
	require.Equal(t, "unknown", row.StatusPresentation)
}

// TestBuildClusterCustomSummaryNilResourceIsSafe ensures the streaming
// path doesn't panic on a nil resource.
func TestBuildClusterCustomSummaryNilResourceIsSafe(t *testing.T) {
	row := customresource.BuildClusterStreamSummary(
		ClusterMeta{ClusterID: "c1"},
		nil, customresource.NewDescriptor(

			"rds.services.k8s.aws",
			"v1alpha1",
			"dbclusters",
			"DBCluster",
			"dbclusters.rds.services.k8s.aws"))

	require.Equal(t, "c1", row.Ref.ClusterID)
	require.Equal(t, "DBCluster", row.Ref.Kind)
	require.Equal(t, "rds.services.k8s.aws", row.Ref.Group)
	require.Equal(t, "v1alpha1", row.Ref.Version)
	require.Equal(t, "dbclusters.rds.services.k8s.aws", row.CRDName)
}

// TestBuildNamespaceCustomSummaryThreadsCRDName regression-guards the
// new CRDName field. The frontend's CRD column relies on this being
// populated by both the snapshot path (which passes `crd.Name`) and the
// streaming path (which passes `gvr.Resource + "." + gvr.Group`).
// Without it the column would silently render as "-" for any row that
// went through a streaming update — same dual-path drift pattern as the
// HPA TargetAPIVersion bug.
func TestBuildNamespaceCustomSummaryThreadsCRDName(t *testing.T) {
	resource := &unstructured.Unstructured{}
	resource.SetAPIVersion("rds.services.k8s.aws/v1alpha1")
	resource.SetKind("DBInstance")
	resource.SetName("primary")
	resource.SetNamespace("data")

	row := customresource.BuildNamespaceStreamSummary(
		ClusterMeta{ClusterID: "c1"},
		resource, customresource.NewDescriptor(

			"rds.services.k8s.aws",
			"v1alpha1",
			"dbinstances",
			"DBInstance",
			"dbinstances.rds.services.k8s.aws"),

		"data")

	require.Equal(t, "dbinstances.rds.services.k8s.aws", row.CRDName)
	require.Equal(t, "Unknown", row.Status)
	require.Equal(t, "unknown", row.StatusState)
	require.Equal(t, "unknown", row.StatusPresentation)
}

// buildPodSummaryForTest resolves a pod's usage from the map and calls the
// pods-package builder (which takes usage primitives, not the metrics map).
func buildPodSummaryForTest(meta ClusterMeta, pod *corev1.Pod, usage map[string]metrics.PodUsage, rsLister v1.ReplicaSetLister) PodSummary {
	var u metrics.PodUsage
	if pod != nil {
		u = usage[pod.Namespace+"/"+pod.Name]
	}
	row := podres.BuildStreamSummary(meta, pod, u.CPUUsageMilli, u.MemoryUsageBytes, rsLister, nil)
	// Mirror the production serve-time overlay so the parity harness and the real
	// Build path render CPU/mem identically — including the no-data marker for a
	// pod with no valid sample (Risk #9 / §3.6). overlayPodMetrics re-derives the
	// usage cells from the same map keyed by namespace/name.
	rows := []PodSummary{row}
	overlayPodMetrics(rows, usage)
	return rows[0]
}
