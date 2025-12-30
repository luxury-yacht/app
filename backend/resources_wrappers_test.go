package backend

import (
	"context"
	"testing"

	admissionv1 "k8s.io/api/admissionregistration/v1"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	apiextensionsfake "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset/fake"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	kubernetesfake "k8s.io/client-go/kubernetes/fake"
)

func wrapperTestApp(t *testing.T) *App {
	t.Helper()
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()
	app.logger = NewLogger(5)
	return app
}

func TestResourceWrappersRequireClient(t *testing.T) {
	app := wrapperTestApp(t)
	clusterID := "config:ctx"
	app.clusterClients = map[string]*clusterClients{
		clusterID: {
			meta:              ClusterMeta{ID: clusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
		},
	}

	errorCases := []struct {
		name string
		call func() error
	}{
		{"MutatingWebhook", func() error {
			_, err := app.GetMutatingWebhookConfiguration("mw")
			return err
		}},
		{"ValidatingWebhook", func() error {
			_, err := app.GetValidatingWebhookConfiguration("vw")
			return err
		}},
		{"CRD", func() error {
			_, err := app.GetCustomResourceDefinition("crd.example.com")
			return err
		}},
		{"HPA", func() error {
			_, err := app.GetHorizontalPodAutoscaler("ns", "hpa")
			return err
		}},
		{"Service", func() error {
			_, err := app.GetService("ns", "svc")
			return err
		}},
		{"EndpointSlice", func() error {
			_, err := app.GetEndpointSlice("ns", "ep")
			return err
		}},
		{"Ingress", func() error {
			_, err := app.GetIngress("ns", "ing")
			return err
		}},
		{"IngressClass", func() error {
			_, err := app.GetIngressClass("class")
			return err
		}},
		{"NetworkPolicy", func() error {
			_, err := app.GetNetworkPolicy("ns", "np")
			return err
		}},
		{"ConfigMap", func() error {
			_, err := app.GetConfigMap("ns", "cm")
			return err
		}},
		{"Secret", func() error {
			_, err := app.GetSecret("ns", "sec")
			return err
		}},
		{"LimitRange", func() error {
			_, err := app.GetLimitRange("ns", "lr")
			return err
		}},
		{"ResourceQuota", func() error {
			_, err := app.GetResourceQuota("ns", "rq")
			return err
		}},
		{"DeleteResource", func() error {
			return app.DeleteResource(clusterID, "pod", "ns", "name")
		}},
		{"HelmReleaseDetails", func() error {
			_, err := app.GetHelmReleaseDetails("ns", "rel")
			return err
		}},
		{"HelmManifest", func() error {
			_, err := app.GetHelmManifest("ns", "rel")
			return err
		}},
		{"HelmValues", func() error {
			_, err := app.GetHelmValues("ns", "rel")
			return err
		}},
		{"HelmDelete", func() error { return app.DeleteHelmRelease(clusterID, "ns", "rel") }},
		{"Deployment", func() error {
			_, err := app.GetDeployment("ns", "deploy")
			return err
		}},
		{"StatefulSet", func() error {
			_, err := app.GetStatefulSet("ns", "sts")
			return err
		}},
		{"DaemonSet", func() error {
			_, err := app.GetDaemonSet("ns", "ds")
			return err
		}},
		{"Job", func() error {
			_, err := app.GetJob("ns", "job")
			return err
		}},
		{"CronJob", func() error {
			_, err := app.GetCronJob("ns", "cj")
			return err
		}},
		{"Namespace", func() error {
			_, err := app.GetNamespace("ns")
			return err
		}},
		{"ClusterRole", func() error {
			_, err := app.GetClusterRole("cr")
			return err
		}},
		{"ClusterRoleBinding", func() error {
			_, err := app.GetClusterRoleBinding("crb")
			return err
		}},
		{"Role", func() error {
			_, err := app.GetRole("ns", "role")
			return err
		}},
		{"RoleBinding", func() error {
			_, err := app.GetRoleBinding("ns", "rb")
			return err
		}},
		{"ServiceAccount", func() error {
			_, err := app.GetServiceAccount("ns", "sa")
			return err
		}},
		{"PersistentVolume", func() error {
			_, err := app.GetPersistentVolume("pv")
			return err
		}},
		{"PersistentVolumeClaim", func() error {
			_, err := app.GetPersistentVolumeClaim("ns", "pvc")
			return err
		}},
		{"StorageClass", func() error {
			_, err := app.GetStorageClass("sc")
			return err
		}},
		{"Node", func() error {
			_, err := app.GetNode("node")
			return err
		}},
		{"Cordon", func() error { return app.CordonNode(clusterID, "node") }},
		{"Uncordon", func() error { return app.UncordonNode(clusterID, "node") }},
		{"Drain", func() error { return app.DrainNode(clusterID, "node", DrainNodeOptions{}) }},
		{"DeleteNode", func() error { return app.DeleteNode(clusterID, "node") }},
		{"ForceDeleteNode", func() error { return app.ForceDeleteNode(clusterID, "node") }},
	}

	for _, tc := range errorCases {
		if err := tc.call(); err == nil {
			t.Fatalf("expected error for %s", tc.name)
		}
	}

	// Directly cover no-op cache clearer.
	app.clearNodeCaches("node")
}

func TestWrapperHappyPathsWithFakeClients(t *testing.T) {
	app := wrapperTestApp(t)
	app.client = kubernetesfake.NewClientset(
		&admissionv1.MutatingWebhookConfiguration{ObjectMeta: metav1.ObjectMeta{Name: "mw"}},
		&admissionv1.ValidatingWebhookConfiguration{ObjectMeta: metav1.ObjectMeta{Name: "vw"}},
	)
	app.apiextensionsClient = apiextensionsfake.NewClientset(
		&apiextensionsv1.CustomResourceDefinition{ObjectMeta: metav1.ObjectMeta{Name: "crd.example.com"}},
	)

	// CRD path
	if _, err := app.GetCustomResourceDefinition("crd.example.com"); err != nil {
		t.Fatalf("expected CRD fetch to succeed: %v", err)
	}

	// Webhooks
	if _, err := app.GetMutatingWebhookConfiguration("mw"); err != nil {
		t.Fatalf("expected mutating webhook to succeed: %v", err)
	}
	if _, err := app.GetValidatingWebhookConfiguration("vw"); err != nil {
		t.Fatalf("expected validating webhook to succeed: %v", err)
	}
}
