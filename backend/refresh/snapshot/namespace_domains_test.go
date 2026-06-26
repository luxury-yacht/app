package snapshot

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	networkingv1 "k8s.io/api/networking/v1"
	policyv1 "k8s.io/api/policy/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	"github.com/luxury-yacht/app/backend/refresh/domainpermissions"
	"github.com/luxury-yacht/app/backend/refresh/metrics"
	"github.com/luxury-yacht/app/backend/testsupport"
)

// quotasCollectIndexer resolves the namespace-quotas stream descriptors to the
// supplied test indexers (nil = kind unavailable).
func quotasCollectIndexer(quotaIdx, limitIdx, pdbIdx cache.Indexer) func(streamspec.Descriptor) cache.Indexer {
	return func(d streamspec.Descriptor) cache.Indexer {
		switch d.Resource {
		case "resourcequotas":
			return quotaIdx
		case "limitranges":
			return limitIdx
		case "poddisruptionbudgets":
			return pdbIdx
		}
		return nil
	}
}

// configCollectIndexer resolves the namespace-config stream descriptors to the
// supplied test indexers (nil = kind unavailable).
func configCollectIndexer(cmIdx, secIdx cache.Indexer) func(streamspec.Descriptor) cache.Indexer {
	return func(d streamspec.Descriptor) cache.Indexer {
		switch d.Resource {
		case "configmaps":
			return cmIdx
		case "secrets":
			return secIdx
		}
		return nil
	}
}

// autoscalingCollectIndexer resolves the namespace-autoscaling stream descriptor
// to the supplied test indexer (nil = kind unavailable).
func autoscalingCollectIndexer(hpaIdx cache.Indexer) func(streamspec.Descriptor) cache.Indexer {
	return func(d streamspec.Descriptor) cache.Indexer {
		if d.Resource == "horizontalpodautoscalers" {
			return hpaIdx
		}
		return nil
	}
}

// storageCollectIndexer resolves the namespace-storage stream descriptor to the
// supplied test indexer (nil = kind unavailable).
func storageCollectIndexer(pvcIdx cache.Indexer) func(streamspec.Descriptor) cache.Indexer {
	return func(d streamspec.Descriptor) cache.Indexer {
		if d.Resource == "persistentvolumeclaims" {
			return pvcIdx
		}
		return nil
	}
}

// clusterStorageCollectIndexer resolves the cluster-storage stream descriptor to
// the supplied test indexer (nil = kind unavailable).
func clusterStorageCollectIndexer(pvIdx cache.Indexer) func(streamspec.Descriptor) cache.Indexer {
	return func(d streamspec.Descriptor) cache.Indexer {
		if d.Resource == "persistentvolumes" {
			return pvIdx
		}
		return nil
	}
}

// networkIndexers holds the per-kind test indexers for the descriptor-driven
// network kinds (nil = kind unavailable).
type networkIndexers struct {
	ingress          cache.Indexer
	networkpolicy    cache.Indexer
	gateway          cache.Indexer
	httproute        cache.Indexer
	grpcroute        cache.Indexer
	tlsroute         cache.Indexer
	listenerset      cache.Indexer
	referencegrant   cache.Indexer
	backendtlspolicy cache.Indexer
}

// networkCollectIndexer resolves the namespace-network stream descriptors to the
// supplied test indexers. Service, EndpointSlice, Ingress, and NetworkPolicy are cut to
// the ingest path: their availability resolves to the shared sentinel indexer (a non-nil
// empty indexer) when the test supplies one, so the descriptor source gate marks them
// Available without a typed informer — exactly as factoryIndexers does in production. Their
// ROWS come from the builder's ingest source, not here.
func networkCollectIndexer(idx networkIndexers) func(streamspec.Descriptor) cache.Indexer {
	return func(d streamspec.Descriptor) cache.Indexer {
		switch d.Resource {
		case "ingresses":
			return idx.ingress
		case "networkpolicies":
			return idx.networkpolicy
		case "gateways":
			return idx.gateway
		case "httproutes":
			return idx.httproute
		case "grpcroutes":
			return idx.grpcroute
		case "tlsroutes":
			return idx.tlsroute
		case "listenersets":
			return idx.listenerset
		case "referencegrants":
			return idx.referencegrant
		case "backendtlspolicies":
			return idx.backendtlspolicy
		}
		return nil
	}
}

// rbacCollectIndexer returns a collectIndexer that resolves the RBAC stream
// descriptors to the supplied test indexers (nil = kind unavailable), so the
// descriptor-driven NamespaceRBACBuilder can be tested without an informer factory.
func rbacCollectIndexer(roleIdx, bindingIdx, saIdx cache.Indexer) func(streamspec.Descriptor) cache.Indexer {
	return func(d streamspec.Descriptor) cache.Indexer {
		switch d.Resource {
		case "roles":
			return roleIdx
		case "rolebindings":
			return bindingIdx
		case "serviceaccounts":
			return saIdx
		}
		return nil
	}
}

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
		collectIndexer: configCollectIndexer(
			testsupport.NewNamespacedIndexer(t, configMap),
			testsupport.NewNamespacedIndexer(t, secret),
		),
	}

	snapshot, err := builder.Build(context.Background(), "namespace:default")
	require.NoError(t, err)
	require.Equal(t, namespaceConfigDomainName, snapshot.Domain)

	payload, ok := snapshot.Payload.(NamespaceConfigSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Rows, 2)
	require.Equal(t, []string{"ConfigMap", "Secret"}, payload.Kinds)
	for _, entry := range payload.Rows {
		require.NotEmpty(t, entry.Age)
	}
}

func TestNamespaceConfigBuilderHonorsRuntimeAllowedResources(t *testing.T) {
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
		collectIndexer: configCollectIndexer(
			testsupport.NewNamespacedIndexer(t, configMap),
			testsupport.NewNamespacedIndexer(t, secret),
		),
	}
	ctx := domainpermissions.WithAllowedResources(context.Background(), namespaceConfigDomainName, domainpermissions.AllowedResources{
		"core/configmaps": false,
		"core/secrets":    true,
	})

	snapshot, err := builder.Build(ctx, "namespace:default")
	require.NoError(t, err)

	payload, ok := snapshot.Payload.(NamespaceConfigSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Rows, 1)
	require.Equal(t, "Secret", payload.Rows[0].Kind)
	require.Equal(t, []string{"Secret"}, payload.Kinds)
}

func TestNamespaceConfigBuilderQueryReportsPartialAllowedResources(t *testing.T) {
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
		collectIndexer: configCollectIndexer(
			testsupport.NewNamespacedIndexer(t, configMap),
			testsupport.NewNamespacedIndexer(t, secret),
		),
	}
	ctx := domainpermissions.WithAllowedResources(context.Background(), namespaceConfigDomainName, domainpermissions.AllowedResources{
		"core/configmaps": false,
		"core/secrets":    true,
	})

	snapshot, err := builder.Build(ctx, "cluster-a|namespace:default?limit=10")
	require.NoError(t, err)
	payload := snapshot.Payload.(NamespaceConfigSnapshot)
	require.False(t, payload.TotalIsExact)
	require.False(t, payload.FacetsExact)
	require.Len(t, payload.Issues, 1)
	require.Equal(t, "ConfigMap", payload.Issues[0].Kind)
	require.Contains(t, payload.Issues[0].Message, "partial")

	secretOnly, err := builder.Build(ctx, "cluster-a|namespace:default?limit=10&kinds=Secret")
	require.NoError(t, err)
	secretOnlyPayload := secretOnly.Payload.(NamespaceConfigSnapshot)
	require.True(t, secretOnlyPayload.TotalIsExact)
	require.True(t, secretOnlyPayload.FacetsExact)
	require.Empty(t, secretOnlyPayload.Issues)
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
		collectIndexer: configCollectIndexer(
			testsupport.NewNamespacedIndexer(t, configMapDefault, configMapSystem),
			testsupport.NewNamespacedIndexer(t, secretDefault, secretOther),
		),
	}

	snapshot, err := builder.Build(context.Background(), "namespace:all")
	require.NoError(t, err)
	require.Equal(t, namespaceConfigDomainName, snapshot.Domain)
	require.Equal(t, "namespace:all", snapshot.Scope)

	payload, ok := snapshot.Payload.(NamespaceConfigSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Rows, 4)
	require.Equal(t, []string{"ConfigMap", "Secret"}, payload.Kinds)

	namespaces := make(map[string]struct{})
	for _, entry := range payload.Rows {
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
		collectIndexer: configCollectIndexer(
			testsupport.NewNamespacedIndexer(t, configMap),
			testsupport.NewNamespacedIndexer(t, secret),
		),
	}

	snapshot, err := builder.Build(context.Background(), "namespace:all")
	require.NoError(t, err)

	payload, ok := snapshot.Payload.(NamespaceConfigSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Rows, 2)
	require.Equal(t, []string{"ConfigMap", "Secret"}, []string{
		payload.Rows[0].Kind,
		payload.Rows[1].Kind,
	})
}

func TestNamespaceEventsBuilderUsesEventTimestampOrdering(t *testing.T) {
	now := time.Now()
	newer := now.Add(-1 * time.Minute)
	older := now.Add(-9 * time.Minute)

	eventA := &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "event-a",
			Namespace:         "default",
			CreationTimestamp: metav1.NewTime(older),
		},
		InvolvedObject: corev1.ObjectReference{
			Namespace: "default",
		},
		LastTimestamp: metav1.NewTime(newer),
	}
	eventB := &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "event-b",
			Namespace:         "default",
			CreationTimestamp: metav1.NewTime(newer),
		},
		InvolvedObject: corev1.ObjectReference{
			Namespace: "default",
		},
		LastTimestamp: metav1.NewTime(older),
	}

	builder := &NamespaceEventsBuilder{
		eventLister: testsupport.NewEventLister(t, eventA, eventB),
	}

	snapshot, err := builder.Build(context.Background(), "namespace:default")
	require.NoError(t, err)

	payload, ok := snapshot.Payload.(NamespaceEventsSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Rows, 2)
	require.Equal(t, "event-a", payload.Rows[0].Name)
	require.Equal(t, "event-b", payload.Rows[1].Name)
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
		networkIngest:          newFakeNetworkIngestSource(ClusterMeta{}, svc, slice, ing, policy),
		includeServices:        true,
		includeEndpointSlices:  true,
		includeIngresses:       true,
		includeNetworkPolicies: true,
		// Cut kinds resolve availability via the sentinel indexer; rows come from ingest.
		collectIndexer: networkCollectIndexer(networkIndexers{
			ingress:       ingestAvailabilityIndexer,
			networkpolicy: ingestAvailabilityIndexer,
		}),
	}
	seedNetworkMaintained(builder, ClusterMeta{})

	snapshot, err := builder.Build(context.Background(), "namespace:default")
	require.NoError(t, err)
	require.Equal(t, namespaceNetworkDomainName, snapshot.Domain)

	payload, ok := snapshot.Payload.(NamespaceNetworkSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Rows, 4)
	require.Equal(t, []string{"EndpointSlice", "Ingress", "NetworkPolicy", "Service"}, payload.Kinds)
	endpointSliceSummary, ok := findNetworkSummary(payload.Rows, "EndpointSlice", "api-abcde")
	require.True(t, ok)
	require.Equal(t, "default", endpointSliceSummary.Namespace)
	// The Service row's endpoint join is re-applied at serve from the EndpointSlice store:
	// the single ready endpoint contributes "Addresses: 1" to the Service Details, exactly
	// as the typed service.BuildStreamSummary(svc, slices) path produced.
	serviceSummary, ok := findNetworkSummary(payload.Rows, "Service", "api")
	require.True(t, ok)
	require.Contains(t, serviceSummary.Details, "Addresses: 1")
	for _, entry := range payload.Rows {
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
		networkIngest:          newFakeNetworkIngestSource(ClusterMeta{}, svcDefault, svcOther, sliceDefault, sliceOther, ingDefault, policyOther),
		includeServices:        true,
		includeEndpointSlices:  true,
		includeIngresses:       true,
		includeNetworkPolicies: true,
		collectIndexer: networkCollectIndexer(networkIndexers{
			ingress:       ingestAvailabilityIndexer,
			networkpolicy: ingestAvailabilityIndexer,
		}),
	}
	seedNetworkMaintained(builder, ClusterMeta{})

	snapshot, err := builder.Build(context.Background(), "namespace:all")
	require.NoError(t, err)
	require.Equal(t, namespaceNetworkDomainName, snapshot.Domain)
	require.Equal(t, "namespace:all", snapshot.Scope)

	payload, ok := snapshot.Payload.(NamespaceNetworkSnapshot)
	require.True(t, ok)
	require.True(t, len(payload.Rows) >= 4)
	require.Equal(t, []string{"EndpointSlice", "Ingress", "NetworkPolicy", "Service"}, payload.Kinds)

	namespaces := make(map[string]struct{})
	for _, entry := range payload.Rows {
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
		collectIndexer: storageCollectIndexer(testsupport.NewNamespacedIndexer(t, pvc)),
	}

	snapshot, err := builder.Build(context.Background(), "namespace:default")
	require.NoError(t, err)
	require.Equal(t, namespaceStorageDomainName, snapshot.Domain)

	payload, ok := snapshot.Payload.(NamespaceStorageSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Rows, 1)

	entry := payload.Rows[0]
	require.Equal(t, "PersistentVolumeClaim", entry.Kind)
	require.Equal(t, "2Gi", entry.Capacity)
	require.Equal(t, string(corev1.ClaimBound), entry.Status)
	require.Equal(t, string(corev1.ClaimBound), entry.StatusState)
	require.Equal(t, "ready", entry.StatusPresentation)
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
		collectIndexer: storageCollectIndexer(testsupport.NewNamespacedIndexer(t, pvcDefault, pvcOther)),
	}

	snapshot, err := builder.Build(context.Background(), "namespace:all")
	require.NoError(t, err)
	require.Equal(t, namespaceStorageDomainName, snapshot.Domain)
	require.Equal(t, "namespace:all", snapshot.Scope)

	payload, ok := snapshot.Payload.(NamespaceStorageSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Rows, 2)

	namespaces := make(map[string]struct{})
	for _, entry := range payload.Rows {
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
	minAvailable := intstr.FromInt(1)
	pdb := &policyv1.PodDisruptionBudget{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "pdb-policy",
			Namespace:         "default",
			ResourceVersion:   "33",
			CreationTimestamp: metav1.NewTime(now.Add(-10 * time.Minute)),
		},
		Spec: policyv1.PodDisruptionBudgetSpec{
			MinAvailable: &minAvailable,
		},
		Status: policyv1.PodDisruptionBudgetStatus{
			CurrentHealthy:     1,
			DesiredHealthy:     2,
			DisruptionsAllowed: 1,
		},
	}

	builder := &NamespaceQuotasBuilder{
		collectIndexer: quotasCollectIndexer(
			testsupport.NewNamespacedIndexer(t, quota),
			testsupport.NewNamespacedIndexer(t, limit),
			testsupport.NewNamespacedIndexer(t, pdb),
		),
	}

	snapshot, err := builder.Build(context.Background(), "namespace:default")
	require.NoError(t, err)
	require.Equal(t, namespaceQuotasDomainName, snapshot.Domain)

	payload, ok := snapshot.Payload.(NamespaceQuotasSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Rows, 3)
	require.Equal(t, []string{"LimitRange", "PodDisruptionBudget", "ResourceQuota"}, payload.Kinds)
	for _, summary := range payload.Rows {
		require.NotEmpty(t, summary.Age)
	}
	var pdbSummary *QuotaSummary
	for i := range payload.Rows {
		if payload.Rows[i].Kind == "PodDisruptionBudget" {
			pdbSummary = &payload.Rows[i]
			break
		}
	}
	// Ensure PDB-specific fields are present for the quotas view.
	require.NotNil(t, pdbSummary)
	require.NotNil(t, pdbSummary.MinAvailable)
	require.NotNil(t, pdbSummary.Status)
	require.Equal(t, int32(1), pdbSummary.Status.DisruptionsAllowed)
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
	maxUnavailable := intstr.FromInt(2)
	pdbDefault := &policyv1.PodDisruptionBudget{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "pdb-policy",
			Namespace:         "default",
			ResourceVersion:   "34",
			CreationTimestamp: metav1.NewTime(now.Add(-15 * time.Minute)),
		},
		Spec: policyv1.PodDisruptionBudgetSpec{
			MaxUnavailable: &maxUnavailable,
		},
		Status: policyv1.PodDisruptionBudgetStatus{DisruptionsAllowed: 2},
	}

	builder := &NamespaceQuotasBuilder{
		collectIndexer: quotasCollectIndexer(
			testsupport.NewNamespacedIndexer(t, quotaDefault, quotaOther),
			testsupport.NewNamespacedIndexer(t, limitDefault),
			testsupport.NewNamespacedIndexer(t, pdbDefault),
		),
	}

	snapshot, err := builder.Build(context.Background(), "namespace:all")
	require.NoError(t, err)
	require.Equal(t, namespaceQuotasDomainName, snapshot.Domain)
	require.Equal(t, "namespace:all", snapshot.Scope)

	payload, ok := snapshot.Payload.(NamespaceQuotasSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Rows, 4)
	require.Equal(t, []string{"LimitRange", "PodDisruptionBudget", "ResourceQuota"}, payload.Kinds)

	namespaces := make(map[string]struct{})
	for _, entry := range payload.Rows {
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
		collectIndexer: autoscalingCollectIndexer(testsupport.NewNamespacedIndexer(t, hpa)),
	}

	snapshot, err := builder.Build(context.Background(), "namespace:default")
	require.NoError(t, err)
	require.Equal(t, namespaceAutoscalingDomainName, snapshot.Domain)

	payload, ok := snapshot.Payload.(NamespaceAutoscalingSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Rows, 1)
	require.Equal(t, []string{"HorizontalPodAutoscaler"}, payload.Kinds)

	entry := payload.Rows[0]
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
		collectIndexer: autoscalingCollectIndexer(testsupport.NewNamespacedIndexer(t, hpaDefault, hpaSystem)),
	}

	snapshot, err := builder.Build(context.Background(), "namespace:all")
	require.NoError(t, err)
	require.Equal(t, namespaceAutoscalingDomainName, snapshot.Domain)
	require.Equal(t, "namespace:all", snapshot.Scope)

	payload, ok := snapshot.Payload.(NamespaceAutoscalingSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Rows, 2)
	require.Equal(t, []string{"HorizontalPodAutoscaler"}, payload.Kinds)

	namespaces := make(map[string]struct{})
	for _, entry := range payload.Rows {
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
	require.Len(t, payload.Rows, 2)

	first := payload.Rows[0]
	require.Equal(t, "event-new", first.Name)
	require.Equal(t, "Pod/api-0", first.Object)
	require.Equal(t, "scheduler", first.Source)

	second := payload.Rows[1]
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
	require.Len(t, payload.Rows, 2)

	namespaces := map[string]struct{}{}
	for _, evt := range payload.Rows {
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
		collectIndexer: rbacCollectIndexer(
			testsupport.NewNamespacedIndexer(t, role),
			testsupport.NewNamespacedIndexer(t, binding),
			testsupport.NewNamespacedIndexer(t, sa),
		),
	}

	snapshot, err := builder.Build(context.Background(), "namespace:default")
	require.NoError(t, err)
	require.Equal(t, uint64(70), snapshot.Version)

	payload, ok := snapshot.Payload.(NamespaceRBACSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Rows, 3)
	require.Equal(t, []string{"Role", "RoleBinding", "ServiceAccount"}, payload.Kinds)

	resources := map[string]RBACSummary{}
	for _, summary := range payload.Rows {
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
		collectIndexer: rbacCollectIndexer(
			testsupport.NewNamespacedIndexer(t, roleDefault, roleOther),
			testsupport.NewNamespacedIndexer(t, binding),
			testsupport.NewNamespacedIndexer(t, sa),
		),
	}

	snapshot, err := builder.Build(context.Background(), "namespace:all")
	require.NoError(t, err)
	require.Equal(t, namespaceRBACDomainName, snapshot.Domain)
	require.Equal(t, "namespace:all", snapshot.Scope)

	payload, ok := snapshot.Payload.(NamespaceRBACSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Rows, 4)
	require.Equal(t, []string{"Role", "RoleBinding", "ServiceAccount"}, payload.Kinds)

	namespaces := make(map[string]struct{})
	for _, entry := range payload.Rows {
		require.NotEmpty(t, entry.Namespace)
		namespaces[entry.Namespace] = struct{}{}
	}
	require.True(t, len(namespaces) >= 2)
}

func TestNamespaceRBACBuilderAllNamespacesCapsLargeSnapshots(t *testing.T) {
	roles := make([]*rbacv1.Role, 0, config.SnapshotNamespaceRBACEntryLimit+1)
	for i := 0; i < config.SnapshotNamespaceRBACEntryLimit+1; i++ {
		roles = append(roles, &rbacv1.Role{
			ObjectMeta: metav1.ObjectMeta{
				Name:            fmt.Sprintf("role-%04d", i),
				Namespace:       fmt.Sprintf("ns-%04d", i),
				ResourceVersion: "1",
			},
		})
	}

	builder := &NamespaceRBACBuilder{
		collectIndexer: rbacCollectIndexer(testsupport.NewNamespacedIndexer(t, roles...), nil, nil),
	}

	snapshot, err := builder.Build(context.Background(), "namespace:all")
	require.NoError(t, err)
	payload := snapshot.Payload.(NamespaceRBACSnapshot)
	require.Len(t, payload.Rows, config.SnapshotNamespaceRBACEntryLimit)
	require.True(t, snapshot.Stats.Truncated)
	require.Equal(t, config.SnapshotNamespaceRBACEntryLimit+1, snapshot.Stats.TotalItems)
	require.Contains(t, snapshot.Stats.Warnings[0], "RBAC resources")
}

func TestNamespaceRBACBuilderSingleNamespaceCapsLargeSnapshots(t *testing.T) {
	roles := make([]*rbacv1.Role, 0, config.SnapshotNamespaceRBACEntryLimit+1)
	for i := 0; i < config.SnapshotNamespaceRBACEntryLimit+1; i++ {
		roles = append(roles, &rbacv1.Role{
			ObjectMeta: metav1.ObjectMeta{
				Name:            fmt.Sprintf("role-%04d", i),
				Namespace:       "team-a",
				ResourceVersion: "1",
			},
		})
	}

	builder := &NamespaceRBACBuilder{
		collectIndexer: rbacCollectIndexer(testsupport.NewNamespacedIndexer(t, roles...), nil, nil),
	}

	snapshot, err := builder.Build(context.Background(), "namespace:team-a")
	require.NoError(t, err)
	payload := snapshot.Payload.(NamespaceRBACSnapshot)
	require.Len(t, payload.Rows, config.SnapshotNamespaceRBACEntryLimit)
	require.True(t, snapshot.Stats.Truncated)
	require.Equal(t, config.SnapshotNamespaceRBACEntryLimit+1, snapshot.Stats.TotalItems)
	require.Contains(t, snapshot.Stats.Warnings[0], "RBAC resources")
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
		collectIndexer: rbacCollectIndexer(
			testsupport.NewNamespacedIndexer(t, roleStaging, roleDefault),
			testsupport.NewNamespacedIndexer(t, bindingDefault),
			testsupport.NewNamespacedIndexer(t, serviceAccount),
		),
	}

	snapshot, err := builder.Build(context.Background(), "namespace:all")
	require.NoError(t, err)

	payload, ok := snapshot.Payload.(NamespaceRBACSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Rows, 4)

	var ordered []string
	for _, entry := range payload.Rows {
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

	collectedAt := time.Unix(1000, 0)
	provider := &workloadMetricsProvider{
		pods: map[string]metrics.PodUsage{
			"default/web-abc123": {CPUUsageMilli: 80, MemoryUsageBytes: 150 * 1024 * 1024},
		},
		metadata: metrics.Metadata{CollectedAt: collectedAt},
	}

	builder := &NamespaceWorkloadsBuilder{
		podIngest:           newFakePodWorkloadsIngestSource(ClusterMeta{}, nil, pod),
		includePods:         true,
		workloadIngest:      newFakeWorkloadIngestSource(ClusterMeta{}, deployment),
		includeDeployments:  true,
		includeStatefulSets: true,
		includeDaemonSets:   true,
		includeJobs:         true,
		includeCronJobs:     true,
		metrics:             provider,
	}
	seedWorkloadsFromBuilderSource(builder, ClusterMeta{})

	snapshot, err := builder.Build(context.Background(), "namespace:default")
	require.NoError(t, err)
	require.Equal(t, namespaceWorkloadsDomainName, snapshot.Domain)
	require.Equal(t, uint64(10), snapshot.Version)

	payload, ok := snapshot.Payload.(NamespaceWorkloadsSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Rows, 1)
	require.Equal(t, []string{"Deployment"}, payload.Kinds)

	summaries := map[string]WorkloadSummary{}
	for _, summary := range payload.Rows {
		summaries[summary.Kind+"-"+summary.Name] = summary
	}

	deploySummary, ok := summaries["Deployment-web"]
	require.True(t, ok)
	require.Equal(t, "1/1", deploySummary.Ready)
	require.Equal(t, "Running", deploySummary.Status)
	require.Equal(t, "1/1", deploySummary.StatusState)
	require.Equal(t, "ready", deploySummary.StatusPresentation)
	require.False(t, deploySummary.PortForwardAvailable)
	require.NotEmpty(t, deploySummary.Age)

}

func TestNamespaceWorkloadsBuilderMetricRefreshDoesNotChangeSnapshotVersion(t *testing.T) {
	now := time.Unix(1000, 0)
	replicas := int32(1)
	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "web",
			Namespace:         "default",
			ResourceVersion:   "10",
			CreationTimestamp: metav1.NewTime(now.Add(-time.Hour)),
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: &replicas,
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "web"}},
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
		Status: corev1.PodStatus{Phase: corev1.PodRunning},
	}
	provider := &workloadMetricsProvider{
		pods: map[string]metrics.PodUsage{
			"default/web-abc123": {CPUUsageMilli: 80, MemoryUsageBytes: 150 * 1024 * 1024},
		},
		metadata: metrics.Metadata{CollectedAt: now},
	}
	builder := &NamespaceWorkloadsBuilder{
		podIngest:           newFakePodWorkloadsIngestSource(ClusterMeta{}, nil, pod),
		includePods:         true,
		workloadIngest:      newFakeWorkloadIngestSource(ClusterMeta{}, deployment),
		includeDeployments:  true,
		includeStatefulSets: true,
		includeDaemonSets:   true,
		includeJobs:         true,
		includeCronJobs:     true,
		metrics:             provider,
	}
	seedWorkloadsFromBuilderSource(builder, ClusterMeta{})

	first, err := builder.Build(context.Background(), "namespace:default")
	require.NoError(t, err)
	require.Equal(t, uint64(10), first.Version)
	require.Equal(t, fmt.Sprintf("%d", now.UnixNano()), first.SourceVersions["metric"])
	require.Equal(t, "80m", first.Payload.(NamespaceWorkloadsSnapshot).Rows[0].CPUUsage)

	provider.pods = map[string]metrics.PodUsage{
		"default/web-abc123": {CPUUsageMilli: 120, MemoryUsageBytes: 175 * 1024 * 1024},
	}
	provider.metadata = metrics.Metadata{CollectedAt: now.Add(5 * time.Second)}

	second, err := builder.Build(context.Background(), "namespace:default")
	require.NoError(t, err)
	require.Equal(t, first.Version, second.Version)
	require.Equal(t, fmt.Sprintf("%d", now.Add(5*time.Second).UnixNano()), second.SourceVersions["metric"])
	require.Equal(t, "120m", second.Payload.(NamespaceWorkloadsSnapshot).Rows[0].CPUUsage)
}

func TestNamespaceWorkloadsBuilderSingleNamespaceCapsLargeSnapshots(t *testing.T) {
	deployments := make([]*appsv1.Deployment, 0, config.SnapshotNamespaceWorkloadsEntryLimit+1)
	for i := 0; i < config.SnapshotNamespaceWorkloadsEntryLimit+1; i++ {
		deployments = append(deployments, &appsv1.Deployment{
			ObjectMeta: metav1.ObjectMeta{
				Name:            fmt.Sprintf("deploy-%04d", i),
				Namespace:       "team-a",
				ResourceVersion: "1",
			},
		})
	}

	builder := &NamespaceWorkloadsBuilder{
		podIngest:           newFakePodWorkloadsIngestSource(ClusterMeta{}, nil),
		includePods:         true,
		workloadIngest:      newFakeWorkloadIngestSource(ClusterMeta{}, workloadObjects(deployments)...),
		includeDeployments:  true,
		includeStatefulSets: true,
		includeDaemonSets:   true,
		includeJobs:         true,
		includeCronJobs:     true,
	}
	seedWorkloadsFromBuilderSource(builder, ClusterMeta{})

	snapshot, err := builder.Build(context.Background(), "namespace:team-a")
	require.NoError(t, err)
	payload := snapshot.Payload.(NamespaceWorkloadsSnapshot)
	require.Len(t, payload.Rows, config.SnapshotNamespaceWorkloadsEntryLimit)
	require.Equal(t, config.SnapshotNamespaceWorkloadsEntryLimit+1, payload.Total)
	require.False(t, payload.TotalIsExact)
	require.True(t, snapshot.Stats.Truncated)
	require.Equal(t, config.SnapshotNamespaceWorkloadsEntryLimit+1, snapshot.Stats.TotalItems)
	require.Contains(t, snapshot.Stats.Warnings[0], "workloads")
}

func TestNamespaceWorkloadsBuilderMarksHPAManagedByFullGVK(t *testing.T) {
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
	}
	customTargetHPA := &autoscalingv1.HorizontalPodAutoscaler{
		ObjectMeta: metav1.ObjectMeta{Name: "custom-web", Namespace: "default"},
		Spec: autoscalingv1.HorizontalPodAutoscalerSpec{
			ScaleTargetRef: autoscalingv1.CrossVersionObjectReference{
				APIVersion: "example.com/v1",
				Kind:       "Deployment",
				Name:       "web",
			},
		},
	}
	appsTargetHPA := &autoscalingv1.HorizontalPodAutoscaler{
		ObjectMeta: metav1.ObjectMeta{Name: "apps-web", Namespace: "default"},
		Spec: autoscalingv1.HorizontalPodAutoscalerSpec{
			ScaleTargetRef: autoscalingv1.CrossVersionObjectReference{
				APIVersion: "apps/v1",
				Kind:       "Deployment",
				Name:       "web",
			},
		},
	}

	builder := &NamespaceWorkloadsBuilder{
		workloadIngest:      newFakeWorkloadIngestSource(ClusterMeta{}, deployment),
		includeDeployments:  true,
		includeStatefulSets: true,
		includeDaemonSets:   true,
		includeJobs:         true,
		includeCronJobs:     true,
		hpaLister:           testsupport.NewHorizontalPodAutoscalerLister(t, customTargetHPA),
	}
	seedWorkloadsFromBuilderSource(builder, ClusterMeta{})

	snapshot, err := builder.Build(context.Background(), "namespace:default")
	require.NoError(t, err)
	payload := snapshot.Payload.(NamespaceWorkloadsSnapshot)
	require.Len(t, payload.Rows, 1)
	require.NotNil(t, payload.Rows[0].HPAManaged)
	require.False(t, *payload.Rows[0].HPAManaged)

	builder.hpaLister = nil
	snapshot, err = builder.Build(context.Background(), "namespace:default")
	require.NoError(t, err)
	payload = snapshot.Payload.(NamespaceWorkloadsSnapshot)
	require.Len(t, payload.Rows, 1)
	require.Nil(t, payload.Rows[0].HPAManaged)

	builder.hpaLister = testsupport.NewHorizontalPodAutoscalerLister(t, customTargetHPA, appsTargetHPA)
	snapshot, err = builder.Build(context.Background(), "namespace:default")
	require.NoError(t, err)
	payload = snapshot.Payload.(NamespaceWorkloadsSnapshot)
	require.Len(t, payload.Rows, 1)
	require.NotNil(t, payload.Rows[0].HPAManaged)
	require.True(t, *payload.Rows[0].HPAManaged)
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
		podIngest:           newFakePodWorkloadsIngestSource(ClusterMeta{}, nil, webPod, apiPod),
		includePods:         true,
		workloadIngest:      newFakeWorkloadIngestSource(ClusterMeta{}, webDeployment, apiDeployment),
		includeDeployments:  true,
		includeStatefulSets: true,
		includeDaemonSets:   true,
		includeJobs:         true,
		includeCronJobs:     true,
		metrics:             &workloadMetricsProvider{pods: map[string]metrics.PodUsage{}},
	}
	seedWorkloadsFromBuilderSource(builder, ClusterMeta{})
	snapshot, err := builder.Build(context.Background(), "namespace:all")
	require.NoError(t, err)
	require.Equal(t, namespaceWorkloadsDomainName, snapshot.Domain)
	require.Equal(t, "namespace:all", snapshot.Scope)

	payload, ok := snapshot.Payload.(NamespaceWorkloadsSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Rows, 2)
	require.Equal(t, []string{"Deployment"}, payload.Kinds)

	namespaces := map[string]struct{}{}
	for _, summary := range payload.Rows {
		require.NotEmpty(t, summary.Namespace)
		namespaces[summary.Namespace] = struct{}{}
	}
	require.Len(t, namespaces, 2)
}

func TestNamespaceWorkloadsBuilderAllNamespacesQuerySortsFiltersAndPagesByMetrics(t *testing.T) {
	now := time.Now()
	replicas := int32(1)
	deployments := []*appsv1.Deployment{
		{
			ObjectMeta: metav1.ObjectMeta{
				Name:              "alpha",
				Namespace:         "team-a",
				ResourceVersion:   "101",
				CreationTimestamp: metav1.NewTime(now.Add(-30 * time.Minute)),
			},
			Spec: appsv1.DeploymentSpec{
				Replicas: &replicas,
				Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "alpha"}},
			},
		},
		{
			ObjectMeta: metav1.ObjectMeta{
				Name:              "bravo",
				Namespace:         "team-b",
				ResourceVersion:   "102",
				CreationTimestamp: metav1.NewTime(now.Add(-20 * time.Minute)),
			},
			Spec: appsv1.DeploymentSpec{
				Replicas: &replicas,
				Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "bravo"}},
			},
		},
		{
			ObjectMeta: metav1.ObjectMeta{
				Name:              "charlie",
				Namespace:         "team-b",
				ResourceVersion:   "103",
				CreationTimestamp: metav1.NewTime(now.Add(-10 * time.Minute)),
			},
			Spec: appsv1.DeploymentSpec{
				Replicas: &replicas,
				Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "charlie"}},
			},
		},
	}
	ownerController := true
	pods := []*corev1.Pod{
		{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "alpha-pod",
				Namespace: "team-a",
				OwnerReferences: []metav1.OwnerReference{{
					Kind:       "Deployment",
					Name:       "alpha",
					Controller: &ownerController,
				}},
			},
		},
		{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "bravo-pod",
				Namespace: "team-b",
				OwnerReferences: []metav1.OwnerReference{{
					Kind:       "Deployment",
					Name:       "bravo",
					Controller: &ownerController,
				}},
			},
		},
		{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "charlie-pod",
				Namespace: "team-b",
				OwnerReferences: []metav1.OwnerReference{{
					Kind:       "Deployment",
					Name:       "charlie",
					Controller: &ownerController,
				}},
			},
		},
	}

	builder := &NamespaceWorkloadsBuilder{
		podIngest:           newFakePodWorkloadsIngestSource(ClusterMeta{}, nil, pods...),
		includePods:         true,
		workloadIngest:      newFakeWorkloadIngestSource(ClusterMeta{}, workloadObjects(deployments)...),
		includeDeployments:  true,
		includeStatefulSets: true,
		includeDaemonSets:   true,
		includeJobs:         true,
		includeCronJobs:     true,
		metrics: &workloadMetricsProvider{pods: map[string]metrics.PodUsage{
			"team-a/alpha-pod":   {MemoryUsageBytes: 64 * 1024 * 1024},
			"team-b/bravo-pod":   {MemoryUsageBytes: 512 * 1024 * 1024},
			"team-b/charlie-pod": {MemoryUsageBytes: 128 * 1024 * 1024},
		}},
	}
	seedWorkloadsFromBuilderSource(builder, ClusterMeta{})

	snapshot, err := builder.Build(context.Background(), "cluster-a|namespace:all?namespaces=team-b&sort=memory&sortDirection=desc&limit=1")
	require.NoError(t, err)
	payload := snapshot.Payload.(NamespaceWorkloadsSnapshot)
	require.Equal(t, 2, payload.Total)
	require.True(t, payload.TotalIsExact)
	require.Equal(t, []string{"Deployment"}, payload.Kinds)
	require.Equal(t, []string{"team-b"}, payload.Namespaces)
	require.Len(t, payload.Rows, 1)
	require.Equal(t, "bravo", payload.Rows[0].Name)
	require.NotEmpty(t, payload.Continue)

	next, err := builder.Build(context.Background(), "cluster-a|namespace:all?namespaces=team-b&sort=memory&sortDirection=desc&limit=1&continue="+payload.Continue)
	require.NoError(t, err)
	nextPayload := next.Payload.(NamespaceWorkloadsSnapshot)
	require.Len(t, nextPayload.Rows, 1)
	require.Equal(t, "charlie", nextPayload.Rows[0].Name)
	require.Empty(t, nextPayload.Continue)
}

func TestNamespaceWorkloadsBuilderMetricCursorContinuesAcrossMetricsRefresh(t *testing.T) {
	now := time.Now()
	replicas := int32(1)
	deployments := []*appsv1.Deployment{
		{
			ObjectMeta: metav1.ObjectMeta{
				Name:              "bravo",
				Namespace:         "team-b",
				ResourceVersion:   "102",
				CreationTimestamp: metav1.NewTime(now.Add(-20 * time.Minute)),
			},
			Spec: appsv1.DeploymentSpec{
				Replicas: &replicas,
				Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "bravo"}},
			},
		},
		{
			ObjectMeta: metav1.ObjectMeta{
				Name:              "charlie",
				Namespace:         "team-b",
				ResourceVersion:   "103",
				CreationTimestamp: metav1.NewTime(now.Add(-10 * time.Minute)),
			},
			Spec: appsv1.DeploymentSpec{
				Replicas: &replicas,
				Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "charlie"}},
			},
		},
	}
	ownerController := true
	pods := []*corev1.Pod{
		{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "bravo-pod",
				Namespace: "team-b",
				OwnerReferences: []metav1.OwnerReference{{
					Kind:       "Deployment",
					Name:       "bravo",
					Controller: &ownerController,
				}},
			},
		},
		{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "charlie-pod",
				Namespace: "team-b",
				OwnerReferences: []metav1.OwnerReference{{
					Kind:       "Deployment",
					Name:       "charlie",
					Controller: &ownerController,
				}},
			},
		},
	}

	provider := &workloadMetricsProvider{
		pods: map[string]metrics.PodUsage{
			"team-b/bravo-pod":   {MemoryUsageBytes: 512 * 1024 * 1024},
			"team-b/charlie-pod": {MemoryUsageBytes: 128 * 1024 * 1024},
		},
		metadata: metrics.Metadata{CollectedAt: now},
	}
	builder := &NamespaceWorkloadsBuilder{
		podIngest:           newFakePodWorkloadsIngestSource(ClusterMeta{}, nil, pods...),
		includePods:         true,
		workloadIngest:      newFakeWorkloadIngestSource(ClusterMeta{}, workloadObjects(deployments)...),
		includeDeployments:  true,
		includeStatefulSets: true,
		includeDaemonSets:   true,
		includeJobs:         true,
		includeCronJobs:     true,
		metrics:             provider,
	}
	seedWorkloadsFromBuilderSource(builder, ClusterMeta{})

	first, err := builder.Build(context.Background(), "cluster-a|namespace:all?sort=memory&sortDirection=desc&limit=1")
	require.NoError(t, err)
	firstPayload := first.Payload.(NamespaceWorkloadsSnapshot)
	require.Len(t, firstPayload.Rows, 1)
	require.Equal(t, "bravo", firstPayload.Rows[0].Name)
	require.NotEmpty(t, firstPayload.Continue)

	provider.pods = map[string]metrics.PodUsage{
		"team-b/bravo-pod":   {MemoryUsageBytes: 640 * 1024 * 1024},
		"team-b/charlie-pod": {MemoryUsageBytes: 256 * 1024 * 1024},
	}
	provider.metadata = metrics.Metadata{CollectedAt: now.Add(5 * time.Second)}

	next, err := builder.Build(context.Background(), "cluster-a|namespace:all?sort=memory&sortDirection=desc&limit=1&continue="+firstPayload.Continue)
	require.NoError(t, err)
	nextPayload := next.Payload.(NamespaceWorkloadsSnapshot)
	require.False(t, nextPayload.CursorInvalid)
	require.Len(t, nextPayload.Rows, 1)
	require.Equal(t, "charlie", nextPayload.Rows[0].Name)
	require.Empty(t, nextPayload.Continue)
}

func TestNamespaceWorkloadsQueryMarksDeniedKindsPartial(t *testing.T) {
	now := time.Now()
	replicas := int32(1)
	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "api",
			Namespace:         "team-a",
			ResourceVersion:   "101",
			CreationTimestamp: metav1.NewTime(now.Add(-20 * time.Minute)),
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: &replicas,
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "api"}},
		},
	}
	job := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "migration",
			Namespace:         "team-a",
			ResourceVersion:   "102",
			CreationTimestamp: metav1.NewTime(now.Add(-10 * time.Minute)),
		},
	}
	builder := &NamespaceWorkloadsBuilder{
		podIngest:           newFakePodWorkloadsIngestSource(ClusterMeta{}, nil),
		includePods:         true,
		workloadIngest:      newFakeWorkloadIngestSource(ClusterMeta{}, deployment, job),
		includeDeployments:  true,
		includeStatefulSets: true,
		includeDaemonSets:   true,
		includeJobs:         true,
		includeCronJobs:     true,
	}
	seedWorkloadsFromBuilderSource(builder, ClusterMeta{})
	ctx := domainpermissions.WithAllowedResources(context.Background(), namespaceWorkloadsDomainName, domainpermissions.AllowedResources{
		"core/pods":         true,
		"apps/deployments":  true,
		"apps/statefulsets": true,
		"apps/daemonsets":   true,
		"batch/jobs":        false,
		"batch/cronjobs":    true,
	})

	snapshot, err := builder.Build(ctx, "cluster-a|namespace:all?limit=10")
	require.NoError(t, err)
	payload := snapshot.Payload.(NamespaceWorkloadsSnapshot)
	require.False(t, payload.TotalIsExact)
	require.False(t, payload.FacetsExact)
	require.Len(t, payload.Issues, 1)
	require.Equal(t, "Job", payload.Issues[0].Kind)
	require.Contains(t, payload.Issues[0].Message, "partial")
	require.Len(t, payload.Rows, 1)
	require.Equal(t, "Deployment", payload.Rows[0].Kind)
}

// workloadObjects converts a typed workload slice to the []metav1.Object the
// fake workload ingest source's variadic accepts (Go can't spread []*T directly
// into a ...metav1.Object parameter even though *T implements metav1.Object).
func workloadObjects[T metav1.Object](items []T) []metav1.Object {
	out := make([]metav1.Object, 0, len(items))
	for _, item := range items {
		out = append(out, item)
	}
	return out
}

func mustQuantity(t testing.TB, value string) resource.Quantity {
	t.Helper()
	q, err := resource.ParseQuantity(value)
	if err != nil {
		t.Fatalf("failed to parse quantity %s: %v", value, err)
	}
	return q
}

func findNetworkSummary(resources []NetworkSummary, kind, name string) (NetworkSummary, bool) {
	for _, resource := range resources {
		if resource.Kind == kind && resource.Name == name {
			return resource, true
		}
	}
	return NetworkSummary{}, false
}

type workloadMetricsProvider struct {
	pods     map[string]metrics.PodUsage
	metadata metrics.Metadata
}

func (f *workloadMetricsProvider) LatestNodeUsage() map[string]metrics.NodeUsage {
	return map[string]metrics.NodeUsage{}
}

func (f *workloadMetricsProvider) LatestPodUsage() map[string]metrics.PodUsage {
	return f.pods
}

func (f *workloadMetricsProvider) Metadata() metrics.Metadata {
	return f.metadata
}
