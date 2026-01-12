/*
 * backend/resources_wrappers_test.go
 *
 * Tests for resource wrapper handlers.
 * - Covers wrapper behavior for baseline scenarios.
 * - Ensures proper error handling when clients are missing.
 * - Verifies correct handling of resource deletion.
 * - Covers extended success scenarios for wrappers.
 */

package backend

import (
	"context"
	"testing"
	"time"

	admissionv1 "k8s.io/api/admissionregistration/v1"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	networkingv1 "k8s.io/api/networking/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	storagev1 "k8s.io/api/storage/v1"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	apiextensionsfake "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset/fake"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
	clientgofake "k8s.io/client-go/kubernetes/fake"
	"k8s.io/utils/ptr"
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
	app.client = clientgofake.NewClientset(
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

func TestNetworkWrappersHappyPath(t *testing.T) {
	app := wrapperTestApp(t)
	app.Ctx = context.Background()

	now := metav1.NewTime(time.Now().Add(-5 * time.Minute))
	pathType := networkingv1.PathTypePrefix
	endpointPort := int32(8080)

	app.client = clientgofake.NewClientset(
		&corev1.Service{
			ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default", CreationTimestamp: now},
			Spec: corev1.ServiceSpec{
				Type:      corev1.ServiceTypeClusterIP,
				ClusterIP: "10.0.0.1",
				Ports: []corev1.ServicePort{{
					Name:       "http",
					Port:       80,
					TargetPort: intstr.FromInt(8080),
				}},
			},
		},
		&discoveryv1.EndpointSlice{
			ObjectMeta: metav1.ObjectMeta{
				Name:      "web-slice",
				Namespace: "default",
				Labels: map[string]string{
					discoveryv1.LabelServiceName: "web",
				},
			},
			AddressType: discoveryv1.AddressTypeIPv4,
			Ports:       []discoveryv1.EndpointPort{{Port: &endpointPort}},
			Endpoints: []discoveryv1.Endpoint{{
				Addresses: []string{"10.1.1.5"},
				TargetRef: &corev1.ObjectReference{Name: "pod-1", Kind: "Pod"},
			}},
		},
		&networkingv1.Ingress{
			ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default", CreationTimestamp: now},
			Spec: networkingv1.IngressSpec{
				Rules: []networkingv1.IngressRule{{
					Host: "example.com",
					IngressRuleValue: networkingv1.IngressRuleValue{
						HTTP: &networkingv1.HTTPIngressRuleValue{
							Paths: []networkingv1.HTTPIngressPath{{
								Path:     "/",
								PathType: &pathType,
								Backend: networkingv1.IngressBackend{
									Service: &networkingv1.IngressServiceBackend{
										Name: "web",
										Port: networkingv1.ServiceBackendPort{Number: 80},
									},
								},
							}},
						},
					},
				}},
			},
			Status: networkingv1.IngressStatus{
				LoadBalancer: networkingv1.IngressLoadBalancerStatus{
					Ingress: []networkingv1.IngressLoadBalancerIngress{{IP: "35.1.2.3"}},
				},
			},
		},
		&networkingv1.IngressClass{
			ObjectMeta: metav1.ObjectMeta{Name: "public", CreationTimestamp: now},
			Spec:       networkingv1.IngressClassSpec{Controller: "example.com/ingress"},
		},
		&networkingv1.NetworkPolicy{
			ObjectMeta: metav1.ObjectMeta{Name: "deny-all", Namespace: "default", CreationTimestamp: now},
		},
	)

	if _, err := app.GetService("default", "web"); err != nil {
		t.Fatalf("expected service wrapper to succeed: %v", err)
	}
	if _, err := app.GetEndpointSlice("default", "web"); err != nil {
		t.Fatalf("expected endpoint slice wrapper to succeed: %v", err)
	}
	if _, err := app.GetIngress("default", "web"); err != nil {
		t.Fatalf("expected ingress wrapper to succeed: %v", err)
	}
	if _, err := app.GetIngressClass("public"); err != nil {
		t.Fatalf("expected ingress class wrapper to succeed: %v", err)
	}
	if _, err := app.GetNetworkPolicy("default", "deny-all"); err != nil {
		t.Fatalf("expected network policy wrapper to succeed: %v", err)
	}
}

func TestConfigWrappersHappyPath(t *testing.T) {
	app := wrapperTestApp(t)
	app.Ctx = context.Background()

	app.client = clientgofake.NewClientset(
		&corev1.ConfigMap{
			ObjectMeta: metav1.ObjectMeta{Name: "settings", Namespace: "team-a", CreationTimestamp: metav1.NewTime(time.Now().Add(-1 * time.Hour))},
			Data:       map[string]string{"env": "prod"},
		},
		&corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{Name: "creds", Namespace: "team-a", CreationTimestamp: metav1.NewTime(time.Now().Add(-1 * time.Hour))},
			Data:       map[string][]byte{"token": []byte("abc123")},
		},
	)

	if _, err := app.GetConfigMap("team-a", "settings"); err != nil {
		t.Fatalf("expected configmap wrapper to succeed: %v", err)
	}
	if _, err := app.GetSecret("team-a", "creds"); err != nil {
		t.Fatalf("expected secret wrapper to succeed: %v", err)
	}
}

func TestRBACWrappersHappyPath(t *testing.T) {
	app := wrapperTestApp(t)
	app.Ctx = context.Background()

	clusterRole := &rbacv1.ClusterRole{ObjectMeta: metav1.ObjectMeta{Name: "viewer"}}
	clusterRoleBinding := &rbacv1.ClusterRoleBinding{
		ObjectMeta: metav1.ObjectMeta{Name: "viewer-binding"},
		RoleRef: rbacv1.RoleRef{
			Kind: "ClusterRole",
			Name: "viewer",
		},
		Subjects: []rbacv1.Subject{{Kind: "User", Name: "alice"}},
	}
	role := &rbacv1.Role{ObjectMeta: metav1.ObjectMeta{Name: "ns-role", Namespace: "team-a"}}
	roleBinding := &rbacv1.RoleBinding{
		ObjectMeta: metav1.ObjectMeta{Name: "rb", Namespace: "team-a"},
		RoleRef:    rbacv1.RoleRef{Kind: "Role", Name: "ns-role"},
		Subjects:   []rbacv1.Subject{{Kind: "ServiceAccount", Name: "builder", Namespace: "team-a"}},
	}
	serviceAccount := &corev1.ServiceAccount{ObjectMeta: metav1.ObjectMeta{Name: "builder", Namespace: "team-a"}}

	app.client = clientgofake.NewClientset(clusterRole, clusterRoleBinding, role, roleBinding, serviceAccount)

	if _, err := app.GetClusterRole("viewer"); err != nil {
		t.Fatalf("expected ClusterRole wrapper to succeed: %v", err)
	}
	if _, err := app.GetClusterRoleBinding("viewer-binding"); err != nil {
		t.Fatalf("expected ClusterRoleBinding wrapper to succeed: %v", err)
	}
	if _, err := app.GetRole("team-a", "ns-role"); err != nil {
		t.Fatalf("expected Role wrapper to succeed: %v", err)
	}
	if _, err := app.GetRoleBinding("team-a", "rb"); err != nil {
		t.Fatalf("expected RoleBinding wrapper to succeed: %v", err)
	}
	if _, err := app.GetServiceAccount("team-a", "builder"); err != nil {
		t.Fatalf("expected ServiceAccount wrapper to succeed: %v", err)
	}
}

func TestStorageWrappersHappyPath(t *testing.T) {
	app := wrapperTestApp(t)
	app.Ctx = context.Background()

	pv := &corev1.PersistentVolume{
		ObjectMeta: metav1.ObjectMeta{Name: "pv1"},
		Spec: corev1.PersistentVolumeSpec{
			Capacity: corev1.ResourceList{corev1.ResourceStorage: resource.MustParse("5Gi")},
			AccessModes: []corev1.PersistentVolumeAccessMode{
				corev1.ReadWriteOnce,
			},
			PersistentVolumeReclaimPolicy: corev1.PersistentVolumeReclaimRetain,
			VolumeMode:                    ptr.To(corev1.PersistentVolumeFilesystem),
		},
	}
	pvc := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{Name: "pvc1", Namespace: "apps"},
		Spec: corev1.PersistentVolumeClaimSpec{
			AccessModes: []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce},
			Resources: corev1.VolumeResourceRequirements{
				Requests: corev1.ResourceList{corev1.ResourceStorage: resource.MustParse("1Gi")},
			},
		},
		Status: corev1.PersistentVolumeClaimStatus{Phase: corev1.ClaimBound},
	}
	sc := &storagev1.StorageClass{
		ObjectMeta:  metav1.ObjectMeta{Name: "standard"},
		Provisioner: "kubernetes.io/no-provisioner",
	}

	app.client = clientgofake.NewClientset(pv, pvc, sc)

	if _, err := app.GetPersistentVolume("pv1"); err != nil {
		t.Fatalf("expected PV wrapper to succeed: %v", err)
	}
	if _, err := app.GetPersistentVolumeClaim("apps", "pvc1"); err != nil {
		t.Fatalf("expected PVC wrapper to succeed: %v", err)
	}
	if _, err := app.GetStorageClass("standard"); err != nil {
		t.Fatalf("expected StorageClass wrapper to succeed: %v", err)
	}
}

func TestWrapperGuardPathsRequireClient(t *testing.T) {
	app := newTestAppWithDefaults(t)
	app.Ctx = context.Background()
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
		{"GetPod", func() error { _, err := app.GetPod("ns", "pod", false); return err }},
		{"DeletePod", func() error { return app.DeletePod(clusterID, "ns", "pod") }},
		{"PodContainers", func() error { _, err := app.GetPodContainers(clusterID, "ns", "pod"); return err }},
		{"PodDisruptionBudget", func() error { _, err := app.GetPodDisruptionBudget("ns", "pdb"); return err }},
		{"Service", func() error { _, err := app.GetService("ns", "svc"); return err }},
		{"EndpointSlice", func() error { _, err := app.GetEndpointSlice("ns", "ep"); return err }},
		{"Ingress", func() error { _, err := app.GetIngress("ns", "ing"); return err }},
		{"IngressClass", func() error { _, err := app.GetIngressClass("class"); return err }},
		{"NetworkPolicy", func() error { _, err := app.GetNetworkPolicy("ns", "np"); return err }},
		{"ConfigMap", func() error { _, err := app.GetConfigMap("ns", "cm"); return err }},
		{"Secret", func() error { _, err := app.GetSecret("ns", "sec"); return err }},
		{"LimitRange", func() error { _, err := app.GetLimitRange("ns", "lr"); return err }},
		{"ResourceQuota", func() error { _, err := app.GetResourceQuota("ns", "rq"); return err }},
		{"HelmDetails", func() error { _, err := app.GetHelmReleaseDetails("ns", "rel"); return err }},
		{"HelmManifest", func() error { _, err := app.GetHelmManifest("ns", "rel"); return err }},
		{"HelmValues", func() error { _, err := app.GetHelmValues("ns", "rel"); return err }},
		{"HelmDelete", func() error { return app.DeleteHelmRelease(clusterID, "ns", "rel") }},
		{"Deployment", func() error { _, err := app.GetDeployment("ns", "deploy"); return err }},
		{"ReplicaSet", func() error { _, err := app.GetReplicaSet("ns", "rs"); return err }},
		{"StatefulSet", func() error { _, err := app.GetStatefulSet("ns", "sts"); return err }},
		{"DaemonSet", func() error { _, err := app.GetDaemonSet("ns", "ds"); return err }},
		{"Job", func() error { _, err := app.GetJob("ns", "job"); return err }},
		{"CronJob", func() error { _, err := app.GetCronJob("ns", "cj"); return err }},
		{"Namespace", func() error { _, err := app.GetNamespace("ns"); return err }},
		{"ClusterRole", func() error { _, err := app.GetClusterRole("cr"); return err }},
		{"ClusterRoleBinding", func() error { _, err := app.GetClusterRoleBinding("crb"); return err }},
		{"Role", func() error { _, err := app.GetRole("ns", "role"); return err }},
		{"RoleBinding", func() error { _, err := app.GetRoleBinding("ns", "rb"); return err }},
		{"ServiceAccount", func() error { _, err := app.GetServiceAccount("ns", "sa"); return err }},
		{"PersistentVolume", func() error { _, err := app.GetPersistentVolume("pv"); return err }},
		{"PersistentVolumeClaim", func() error { _, err := app.GetPersistentVolumeClaim("ns", "pvc"); return err }},
		{"StorageClass", func() error { _, err := app.GetStorageClass("sc"); return err }},
	}

	for _, tc := range errorCases {
		if err := tc.call(); err == nil {
			t.Fatalf("expected error for %s with nil client", tc.name)
		}
	}

	resp := app.LogFetcher(clusterID, LogFetchRequest{Namespace: "ns", PodName: "pod"})
	if resp.Error == "" {
		t.Fatalf("expected error for LogFetcher without client")
	}
}
