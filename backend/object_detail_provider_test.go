package backend

import (
	"context"
	"strings"
	"testing"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	autoscalingv2 "k8s.io/api/autoscaling/v2"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	networkingv1 "k8s.io/api/networking/v1"
	policyv1 "k8s.io/api/policy/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	storagev1 "k8s.io/api/storage/v1"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	apiextensionsfake "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset/fake"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	fakediscovery "k8s.io/client-go/discovery/fake"
	"k8s.io/client-go/kubernetes/fake"

	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/resourcecontract"
)

func TestObjectDetailProviderFetchesKnownKinds(t *testing.T) {
	deploy := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: "demo-deploy", Namespace: "default"},
		Spec: appsv1.DeploymentSpec{
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "demo"}},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"app": "demo"}},
				Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "c"}}},
			},
		},
	}
	configMap := &corev1.ConfigMap{ObjectMeta: metav1.ObjectMeta{Name: "demo-cm", Namespace: "default"}}
	clusterRole := &rbacv1.ClusterRole{ObjectMeta: metav1.ObjectMeta{Name: "demo-cr"}}
	namespace := &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "demo-ns"}}
	event := &corev1.Event{ObjectMeta: metav1.ObjectMeta{Name: "demo-event", Namespace: "default"}}

	app := NewApp()
	app.Ctx = context.Background()
	// Per-cluster clients are stored in clusterClients, not in global fields.
	clusterID := "config:ctx"
	fakeClient := fake.NewClientset(deploy, configMap, clusterRole, namespace, event)
	app.clusterClients = map[string]*clusterClients{
		clusterID: {
			meta:              ClusterMeta{ID: clusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
			client:            fakeClient,
		},
	}

	provider := app.objectDetailProvider()
	ctx := snapshot.WithClusterMeta(context.Background(), snapshot.ClusterMeta{
		ClusterID:   clusterID,
		ClusterName: "ctx",
	})

	tests := []struct {
		gvk             schema.GroupVersionKind
		namespace, name string
	}{
		{schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "Deployment"}, "default", "demo-deploy"},
		{schema.GroupVersionKind{Version: "v1", Kind: "ConfigMap"}, "default", "demo-cm"},
		{schema.GroupVersionKind{Group: "rbac.authorization.k8s.io", Version: "v1", Kind: "ClusterRole"}, "", "demo-cr"},
		{schema.GroupVersionKind{Version: "v1", Kind: "Namespace"}, "", "demo-ns"},
		{schema.GroupVersionKind{Version: "v1", Kind: "Event"}, "default", "demo-event"},
	}

	for _, tt := range tests {
		detail, err := provider.FetchObjectDetails(ctx, tt.gvk, tt.namespace, tt.name)
		if err != nil {
			t.Fatalf("FetchObjectDetails(%s) returned error: %v", tt.gvk.Kind, err)
		}
		if detail == nil {
			t.Fatalf("FetchObjectDetails(%s) returned nil detail", tt.gvk.Kind)
		}
	}
}

func TestObjectDetailProviderUnknownKind(t *testing.T) {
	app := NewApp()
	provider := app.objectDetailProvider()

	_, err := provider.FetchObjectDetails(context.Background(), schema.GroupVersionKind{Kind: "unknown-kind"}, "ns", "name")
	if err == nil {
		t.Fatalf("expected error for unknown kind")
	}
	if err != snapshot.ErrObjectDetailNotImplemented {
		t.Fatalf("expected ErrObjectDetailNotImplemented, got %v", err)
	}
}

func TestObjectDetailProviderRejectsKnownKindWithoutGVK(t *testing.T) {
	app := NewApp()
	provider := app.objectDetailProvider()

	_, err := provider.FetchObjectDetails(context.Background(), schema.GroupVersionKind{Kind: "Pod"}, "default", "api")
	if err != snapshot.ErrObjectDetailNotImplemented {
		t.Fatalf("expected kind-only known resource to be rejected as not implemented, got %v", err)
	}
}

func TestObjectDetailProviderRejectsKnownKindWithWrongGVK(t *testing.T) {
	app := NewApp()
	app.Ctx = context.Background()
	clusterID := "config:ctx"
	client := fake.NewClientset(&corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{Name: "demo", Namespace: "default"},
	})
	discoveryClient := client.Discovery().(*fakediscovery.FakeDiscovery)
	discoveryClient.Resources = []*metav1.APIResourceList{{
		GroupVersion: "example.com/v1",
		APIResources: []metav1.APIResource{{
			Name:       "configmaps",
			Kind:       "ConfigMap",
			Namespaced: true,
			Verbs:      metav1.Verbs{"get", "list"},
		}},
	}}
	app.clusterClients = map[string]*clusterClients{
		clusterID: {
			meta:              ClusterMeta{ID: clusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
			client:            client,
		},
	}

	provider := app.objectDetailProvider()
	ctx := snapshot.WithClusterMeta(context.Background(), snapshot.ClusterMeta{
		ClusterID:   clusterID,
		ClusterName: "ctx",
	})

	_, err := provider.FetchObjectDetails(ctx, schema.GroupVersionKind{
		Group: "example.com", Version: "v1", Kind: "ConfigMap",
	}, "default", "demo")
	if err != snapshot.ErrObjectDetailNotImplemented {
		t.Fatalf("expected mismatched GVK to be rejected as not implemented, got %v", err)
	}
}

func TestObjectDetailFetchersHaveExactGVKPolicy(t *testing.T) {
	for kind := range objectDetailFetchers {
		if kind == helmReleaseKind {
			continue
		}
		gvk, ok := objectDetailFetcherGVKs[kind]
		if !ok {
			t.Fatalf("object detail fetcher %q is missing exact GVK policy", kind)
		}
		if strings.TrimSpace(gvk.Version) == "" || strings.TrimSpace(gvk.Kind) == "" {
			t.Fatalf("object detail fetcher %q has incomplete GVK policy: %#v", kind, gvk)
		}
	}
	for kind := range objectDetailFetcherGVKs {
		if _, ok := objectDetailFetchers[kind]; !ok {
			t.Fatalf("object detail GVK policy %q has no fetcher", kind)
		}
	}
}

func TestObjectDetailFetcherGVKsContractDerived(t *testing.T) {
	// Every typed fetcher GVK must come from the built-in resource contract, so
	// the GVK metadata cannot drift from resourcecontract.BuiltinResources.
	for kind, gvk := range objectDetailFetcherGVKs {
		if _, ok := resourcecontract.FindBuiltin(gvk.Group, gvk.Version, gvk.Kind); !ok {
			t.Fatalf("object detail fetcher %q resolves to GVK %s which is not in the built-in contract", kind, gvk)
		}
	}

	// resolveDetailFetcherGVK resolves a fetcher kind to its contract GVK.
	cases := map[string]schema.GroupVersionKind{
		"pod":                     {Group: "", Version: "v1", Kind: "Pod"},
		"deployment":              {Group: "apps", Version: "v1", Kind: "Deployment"},
		"storageclass":            {Group: "storage.k8s.io", Version: "v1", Kind: "StorageClass"},
		"horizontalpodautoscaler": {Group: "autoscaling", Version: "v2", Kind: "HorizontalPodAutoscaler"},
	}
	for kind, want := range cases {
		if got := resolveDetailFetcherGVK(kind); got != want {
			t.Fatalf("resolveDetailFetcherGVK(%q) = %s, want %s", kind, got, want)
		}
	}

	// The HPA version pin must serve autoscaling/v2 only; v1 falls back to the
	// generic detail path.
	if _, ok := lookupObjectDetailFetcher(schema.GroupVersionKind{Group: "autoscaling", Version: "v2", Kind: "HorizontalPodAutoscaler"}); !ok {
		t.Fatal("expected autoscaling/v2 HorizontalPodAutoscaler to be served by a typed fetcher")
	}
	if _, ok := lookupObjectDetailFetcher(schema.GroupVersionKind{Group: "autoscaling", Version: "v1", Kind: "HorizontalPodAutoscaler"}); ok {
		t.Fatal("expected autoscaling/v1 HorizontalPodAutoscaler to fall back to the generic detail path")
	}
}

func TestObjectDetailProviderCacheKeyIncludesGVK(t *testing.T) {
	coreConfigMap := schema.GroupVersionKind{Version: "v1", Kind: "ConfigMap"}
	otherConfigMap := schema.GroupVersionKind{Group: "example.com", Version: "v1", Kind: "ConfigMap"}

	coreKey := objectDetailCacheKeyForGVK(coreConfigMap, "default", "demo")
	otherKey := objectDetailCacheKeyForGVK(otherConfigMap, "default", "demo")
	if coreKey == otherKey {
		t.Fatalf("expected distinct cache keys for colliding GVKs, got %q", coreKey)
	}

	app := NewApp()
	app.responseCache = newResponseCache(time.Minute, 10)
	selectionKey := "cluster-a"
	app.responseCacheStore(selectionKey, coreKey, "core")
	app.responseCacheStore(selectionKey, otherKey, "other")

	app.invalidateResponseCache(selectionKey, "ConfigMap", "default", "demo")

	if _, ok := app.responseCacheLookup(selectionKey, coreKey); ok {
		t.Fatalf("expected built-in GVK cache key to be invalidated")
	}
	if got, ok := app.responseCacheLookup(selectionKey, otherKey); !ok || got != "other" {
		t.Fatalf("expected unrelated colliding GVK cache entry to remain, got %#v ok=%v", got, ok)
	}
}

func TestObjectDetailProviderUsesClusterContext(t *testing.T) {
	app := NewApp()
	app.Ctx = context.Background()

	clusterAID := "config-a:ctx-a"
	clusterBID := "config-b:ctx-b"

	app.clusterClients = map[string]*clusterClients{
		clusterAID: {
			meta:              ClusterMeta{ID: clusterAID, Name: "ctx-a"},
			kubeconfigPath:    "/path/a",
			kubeconfigContext: "ctx-a",
			client:            fake.NewClientset(&corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "node-a"}}),
		},
		clusterBID: {
			meta:              ClusterMeta{ID: clusterBID, Name: "ctx-b"},
			kubeconfigPath:    "/path/b",
			kubeconfigContext: "ctx-b",
			client:            fake.NewClientset(&corev1.Node{ObjectMeta: metav1.ObjectMeta{Name: "node-b"}}),
		},
	}

	provider := app.objectDetailProvider()
	ctx := snapshot.WithClusterMeta(context.Background(), snapshot.ClusterMeta{
		ClusterID:   clusterBID,
		ClusterName: "ctx-b",
	})

	detail, err := provider.FetchObjectDetails(ctx, schema.GroupVersionKind{Version: "v1", Kind: "Node"}, "", "node-b")
	if err != nil {
		t.Fatalf("FetchObjectDetails returned error: %v", err)
	}
	if detail == nil {
		t.Fatal("FetchObjectDetails returned nil detail")
	}

	if _, err := provider.FetchObjectDetails(ctx, schema.GroupVersionKind{Version: "v1", Kind: "Node"}, "", "node-a"); err == nil {
		t.Fatal("expected error when fetching node from another cluster")
	}
}

// TestObjectDetailProviderFetchObjectHeaderMetadata proves Age works for the
// kind that previously had none: a custom resource with no typed detail panel.
// The provider reads the live object via the generic GVK path and returns its
// creation timestamp in RFC3339 UTC (the same format the object catalog stores,
// so the Details Age matches the Browse table byte-for-byte).
func TestObjectDetailProviderFetchObjectHeaderMetadata(t *testing.T) {
	const clusterID = "headermeta-provider"
	app := newCollidingDBInstanceCluster(t, clusterID)

	provider, ok := app.objectDetailProvider().(snapshot.ObjectHeaderMetadataProvider)
	if !ok {
		t.Fatal("object detail provider does not implement ObjectHeaderMetadataProvider")
	}
	ctx := snapshot.WithClusterMeta(context.Background(), snapshot.ClusterMeta{
		ClusterID:   clusterID,
		ClusterName: "ctx",
	})

	meta, err := provider.FetchObjectHeaderMetadata(ctx, ackDBInstanceGVK, "default", "my-db")
	if err != nil {
		t.Fatalf("FetchObjectHeaderMetadata returned error: %v", err)
	}
	if meta.CreationTimestamp != "2023-01-02T03:04:05Z" {
		t.Fatalf("expected RFC3339 creation timestamp, got %q", meta.CreationTimestamp)
	}
	// The header metadata carries the object's resourceVersion so the
	// object-details snapshot has a real source clock (drives the ETag).
	if meta.ResourceVersion != "100" {
		t.Fatalf("expected resourceVersion %q, got %q", "100", meta.ResourceVersion)
	}
}

func TestObjectDetailProviderCoversAdditionalKinds(t *testing.T) {
	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{Name: "demo-deploy", Namespace: "extra"},
		Spec: appsv1.DeploymentSpec{
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "demo"}},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"app": "demo"}},
				Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "c"}}},
			},
		},
	}
	ns := &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "extra"}}
	service := &corev1.Service{ObjectMeta: metav1.ObjectMeta{Name: "svc", Namespace: "extra"}}
	ing := &networkingv1.Ingress{ObjectMeta: metav1.ObjectMeta{Name: "ing", Namespace: "extra"}}
	ingClass := &networkingv1.IngressClass{ObjectMeta: metav1.ObjectMeta{Name: "standard"}}
	netpol := &networkingv1.NetworkPolicy{ObjectMeta: metav1.ObjectMeta{Name: "np", Namespace: "extra"}}
	port := int32(80)
	slice := &discoveryv1.EndpointSlice{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "svc-slice",
			Namespace: "extra",
			Labels: map[string]string{
				discoveryv1.LabelServiceName: "svc",
			},
		},
		AddressType: discoveryv1.AddressTypeIPv4,
		Ports:       []discoveryv1.EndpointPort{{Port: &port}},
		Endpoints: []discoveryv1.Endpoint{{
			Addresses: []string{"10.1.1.1"},
		}},
	}
	pvc := &corev1.PersistentVolumeClaim{ObjectMeta: metav1.ObjectMeta{Name: "pvc", Namespace: "extra"}}
	pv := &corev1.PersistentVolume{ObjectMeta: metav1.ObjectMeta{Name: "pv"}}
	sc := &storagev1.StorageClass{ObjectMeta: metav1.ObjectMeta{Name: "sc"}}
	sa := &corev1.ServiceAccount{ObjectMeta: metav1.ObjectMeta{Name: "sa", Namespace: "extra"}}
	role := &rbacv1.Role{ObjectMeta: metav1.ObjectMeta{Name: "role", Namespace: "extra"}}
	roleBinding := &rbacv1.RoleBinding{ObjectMeta: metav1.ObjectMeta{Name: "rb", Namespace: "extra"}}
	clusterRoleBinding := &rbacv1.ClusterRoleBinding{ObjectMeta: metav1.ObjectMeta{Name: "crb"}}
	rq := &corev1.ResourceQuota{ObjectMeta: metav1.ObjectMeta{Name: "rq", Namespace: "extra"}}
	lr := &corev1.LimitRange{ObjectMeta: metav1.ObjectMeta{Name: "lr", Namespace: "extra"}}
	hpa := &autoscalingv2.HorizontalPodAutoscaler{
		ObjectMeta: metav1.ObjectMeta{Name: "hpa", Namespace: "extra"},
		Spec:       autoscalingv2.HorizontalPodAutoscalerSpec{ScaleTargetRef: autoscalingv2.CrossVersionObjectReference{Kind: "Deployment", Name: "demo-deploy"}},
		Status:     autoscalingv2.HorizontalPodAutoscalerStatus{},
	}
	pdb := &policyv1.PodDisruptionBudget{ObjectMeta: metav1.ObjectMeta{Name: "pdb", Namespace: "extra"}}
	cron := &batchv1.CronJob{
		ObjectMeta: metav1.ObjectMeta{Name: "cron", Namespace: "extra"},
		Spec: batchv1.CronJobSpec{
			JobTemplate: batchv1.JobTemplateSpec{
				Spec: batchv1.JobSpec{
					Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "demo"}},
				},
			},
		},
	}
	job := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{Name: "job", Namespace: "extra"},
		Spec:       batchv1.JobSpec{Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "demo"}}},
	}
	replicaSet := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{Name: "rs", Namespace: "extra"},
		Spec: appsv1.ReplicaSetSpec{
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "demo"}},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"app": "demo"}},
				Spec:       corev1.PodSpec{Containers: []corev1.Container{{Name: "rs"}}},
			},
		},
	}

	client := fake.NewClientset(
		ns, service, ing, ingClass, netpol, slice,
		pvc, pv, sc, sa, role, roleBinding, clusterRoleBinding, rq, lr, hpa, pdb, cron, job, deployment,
		replicaSet,
	)
	apiExtClient := apiextensionsfake.NewClientset(
		&apiextensionsv1.CustomResourceDefinition{ObjectMeta: metav1.ObjectMeta{Name: "foos.example.com"}},
	)

	app := NewApp()
	app.Ctx = context.Background()
	// Per-cluster clients are stored in clusterClients, not in global fields.
	clusterID := "config:ctx"
	app.clusterClients = map[string]*clusterClients{
		clusterID: {
			meta:                ClusterMeta{ID: clusterID, Name: "ctx"},
			kubeconfigPath:      "/path",
			kubeconfigContext:   "ctx",
			client:              client,
			apiextensionsClient: apiExtClient,
		},
	}
	provider := app.objectDetailProvider()
	ctx := snapshot.WithClusterMeta(context.Background(), snapshot.ClusterMeta{
		ClusterID:   clusterID,
		ClusterName: "ctx",
	})

	kinds := []struct {
		kind, ns, name string
	}{
		{"service", "extra", "svc"},
		{"ingress", "extra", "ing"},
		{"ingressclass", "", "standard"},
		{"networkpolicy", "extra", "np"},
		{"endpointslice", "extra", "svc-slice"},
		{"persistentvolumeclaim", "extra", "pvc"},
		{"persistentvolume", "", "pv"},
		{"storageclass", "", "sc"},
		{"serviceaccount", "extra", "sa"},
		{"role", "extra", "role"},
		{"rolebinding", "extra", "rb"},
		{"clusterrolebinding", "", "crb"},
		{"resourcequota", "extra", "rq"},
		{"limitrange", "extra", "lr"},
		{"horizontalpodautoscaler", "extra", "hpa"},
		{"poddisruptionbudget", "extra", "pdb"},
		{"cronjob", "extra", "cron"},
		{"job", "extra", "job"},
		{"replicaset", "extra", "rs"},
		{"namespace", "", "extra"},
		{"customresourcedefinition", "", "foos.example.com"},
	}

	for _, tt := range kinds {
		_, err := provider.FetchObjectDetails(ctx, testObjectDetailGVK(tt.kind), tt.ns, tt.name)
		if err != nil {
			t.Fatalf("FetchObjectDetails(%s) returned error: %v", tt.kind, err)
		}
	}
}

func testObjectDetailGVK(kind string) schema.GroupVersionKind {
	switch strings.ToLower(kind) {
	case "service", "persistentvolumeclaim", "persistentvolume", "serviceaccount", "resourcequota", "limitrange", "namespace":
		return schema.GroupVersionKind{Version: "v1", Kind: kind}
	case "ingress", "ingressclass", "networkpolicy":
		return schema.GroupVersionKind{Group: "networking.k8s.io", Version: "v1", Kind: kind}
	case "endpointslice":
		return schema.GroupVersionKind{Group: "discovery.k8s.io", Version: "v1", Kind: kind}
	case "storageclass":
		return schema.GroupVersionKind{Group: "storage.k8s.io", Version: "v1", Kind: kind}
	case "role", "rolebinding", "clusterrolebinding":
		return schema.GroupVersionKind{Group: "rbac.authorization.k8s.io", Version: "v1", Kind: kind}
	case "horizontalpodautoscaler":
		return schema.GroupVersionKind{Group: "autoscaling", Version: "v2", Kind: kind}
	case "poddisruptionbudget":
		return schema.GroupVersionKind{Group: "policy", Version: "v1", Kind: kind}
	case "cronjob", "job":
		return schema.GroupVersionKind{Group: "batch", Version: "v1", Kind: kind}
	case "replicaset":
		return schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: kind}
	case "customresourcedefinition":
		return schema.GroupVersionKind{Group: "apiextensions.k8s.io", Version: "v1", Kind: kind}
	default:
		return schema.GroupVersionKind{Kind: kind}
	}
}

// TestObjectDetailProviderFetchObjectYAMLRejectsKindOnly proves the legacy
// kind-only fallback is no longer reachable. The frontend scope-string
// producers now emit the GVK form (group/version embedded), so a caller
// reaching FetchObjectYAML with an empty Version is a programming bug
// rather than an old cache entry — fail loud instead of silently
// resolving to whichever colliding CRD discovery returns first.
func TestObjectDetailProviderFetchObjectYAMLRejectsKindOnly(t *testing.T) {
	app := NewApp()
	app.Ctx = context.Background()
	app.logger = NewLogger(10)

	clusterID := "config:ctx"
	app.clusterClients = map[string]*clusterClients{
		clusterID: {
			meta:              ClusterMeta{ID: clusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
		},
	}

	provider := app.objectDetailProvider().(*objectDetailProvider)
	ctx := snapshot.WithClusterMeta(context.Background(), snapshot.ClusterMeta{
		ClusterID:   clusterID,
		ClusterName: "ctx",
	})

	_, err := provider.FetchObjectYAML(ctx, schema.GroupVersionKind{Kind: "ConfigMap"}, "default", "cm")
	if err == nil {
		t.Fatalf("expected FetchObjectYAML to reject kind-only GVK")
	}
	if !strings.Contains(err.Error(), "apiVersion") {
		t.Fatalf("error should mention apiVersion requirement, got: %v", err)
	}
}

// TestObjectDetailProviderFetchObjectYAMLByGVKDisambiguates is the refresh-domain
// acceptance test for step 3 of the kind-only-objects fix. It proves that
// the primary panel YAML load path (ObjectYAMLBuilder.Build → provider.FetchObjectYAML)
// now honors group/version when the caller supplies a fully-qualified GVK.
//
// The fixture seeds two colliding DBInstance CRDs in the test cluster:
//   - rds.services.k8s.aws/v1alpha1.DBInstance  (ACK)
//   - kinda.rocks/v1beta1.DbInstance            (db-operator)
//
// With the old kind-only path, a single bare-kind request would resolve to
// whichever entry discovery yielded first — that's the bug. With the new
// GVK-aware path, each GVK resolves strictly to its own object.
func TestObjectDetailProviderFetchObjectYAMLByGVKDisambiguates(t *testing.T) {
	const clusterID = "collision-provider"
	app := newCollidingDBInstanceCluster(t, clusterID)

	provider := app.objectDetailProvider().(*objectDetailProvider)
	ctx := snapshot.WithClusterMeta(context.Background(), snapshot.ClusterMeta{
		ClusterID:   clusterID,
		ClusterName: "ctx",
	})

	t.Run("ACK DBInstance", func(t *testing.T) {
		yamlStr, err := provider.FetchObjectYAML(ctx, schema.GroupVersionKind{
			Group: "rds.services.k8s.aws", Version: "v1alpha1", Kind: "DBInstance",
		}, "default", "my-db")
		if err != nil {
			t.Fatalf("FetchObjectYAML returned error for ACK: %v", err)
		}
		if !strings.Contains(yamlStr, "source: ack-rds") {
			t.Fatalf("expected ACK YAML to contain 'source: ack-rds', got:\n%s", yamlStr)
		}
		if strings.Contains(yamlStr, "source: db-operator") {
			t.Fatalf("ACK lookup returned db-operator object by mistake:\n%s", yamlStr)
		}
	})

	t.Run("kinda.rocks DbInstance", func(t *testing.T) {
		yamlStr, err := provider.FetchObjectYAML(ctx, schema.GroupVersionKind{
			Group: "kinda.rocks", Version: "v1beta1", Kind: "DbInstance",
		}, "default", "my-db")
		if err != nil {
			t.Fatalf("FetchObjectYAML returned error for kinda.rocks: %v", err)
		}
		if !strings.Contains(yamlStr, "source: db-operator") {
			t.Fatalf("expected kinda.rocks YAML to contain 'source: db-operator', got:\n%s", yamlStr)
		}
		if strings.Contains(yamlStr, "source: ack-rds") {
			t.Fatalf("kinda.rocks lookup returned ack-rds object by mistake:\n%s", yamlStr)
		}
	})
}

func TestObjectDetailProviderHelmErrorsWhenClientMissing(t *testing.T) {
	app := NewApp()
	app.logger = NewLogger(10)
	// Bind the test client to a concrete cluster scope for Helm detail fetches.
	clusterID := "config:ctx"
	app.clusterClients = map[string]*clusterClients{
		clusterID: {
			meta:              ClusterMeta{ID: clusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
		},
	}
	provider := app.objectDetailProvider().(*objectDetailProvider)
	ctx := snapshot.WithClusterMeta(context.Background(), snapshot.ClusterMeta{
		ClusterID:   clusterID,
		ClusterName: "ctx",
	})

	if _, _, err := provider.FetchHelmManifest(ctx, "ns", "release"); err == nil {
		t.Fatal("expected error when client is missing")
	}

	if _, _, err := provider.FetchHelmValues(ctx, "ns", "release"); err == nil {
		t.Fatal("expected error when client is missing")
	}
}
