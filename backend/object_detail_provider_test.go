package backend

import (
	"context"
	"strings"
	"testing"

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
	"k8s.io/client-go/kubernetes/fake"

	"github.com/luxury-yacht/app/backend/refresh/snapshot"
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

	app := NewApp()
	app.Ctx = context.Background()
	// Per-cluster clients are stored in clusterClients, not in global fields.
	clusterID := "config:ctx"
	fakeClient := fake.NewClientset(deploy, configMap, clusterRole, namespace)
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
		kind, namespace, name string
	}{
		{"Deployment", "default", "demo-deploy"},
		{"ConfigMap", "default", "demo-cm"},
		{"ClusterRole", "", "demo-cr"},
		{"Namespace", "", "demo-ns"},
	}

	for _, tt := range tests {
		detail, _, err := provider.FetchObjectDetails(ctx, tt.kind, tt.namespace, tt.name)
		if err != nil {
			t.Fatalf("FetchObjectDetails(%s) returned error: %v", tt.kind, err)
		}
		if detail == nil {
			t.Fatalf("FetchObjectDetails(%s) returned nil detail", tt.kind)
		}
	}
}

func TestObjectDetailProviderUnknownKind(t *testing.T) {
	app := NewApp()
	provider := app.objectDetailProvider()

	_, _, err := provider.FetchObjectDetails(context.Background(), "unknown-kind", "ns", "name")
	if err == nil {
		t.Fatalf("expected error for unknown kind")
	}
	if err != snapshot.ErrObjectDetailNotImplemented {
		t.Fatalf("expected ErrObjectDetailNotImplemented, got %v", err)
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

	detail, _, err := provider.FetchObjectDetails(ctx, "Node", "", "node-b")
	if err != nil {
		t.Fatalf("FetchObjectDetails returned error: %v", err)
	}
	if detail == nil {
		t.Fatal("FetchObjectDetails returned nil detail")
	}

	if _, _, err := provider.FetchObjectDetails(ctx, "Node", "", "node-a"); err == nil {
		t.Fatal("expected error when fetching node from another cluster")
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
		{"endpointslice", "extra", "svc"},
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
		_, _, err := provider.FetchObjectDetails(ctx, tt.kind, tt.ns, tt.name)
		if err != nil {
			t.Fatalf("FetchObjectDetails(%s) returned error: %v", tt.kind, err)
		}
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
