package backend

import (
	"context"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/testsupport"
	authorizationv1 "k8s.io/api/authorization/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	cgofake "k8s.io/client-go/kubernetes/fake"
	cgotesting "k8s.io/client-go/testing"
)

func TestRunObjectActionRemovesMetadataFinalizerWithExactPatchPermission(t *testing.T) {
	deletingAt := metav1.NewTime(time.Date(2026, time.August, 10, 12, 0, 0, 0, time.UTC))
	object := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "v1",
		"kind":       "ConfigMap",
		"metadata": map[string]any{
			"name":              "sample",
			"namespace":         "default",
			"deletionTimestamp": deletingAt.Format(time.RFC3339),
			"finalizers":        []any{"example.com/keep", "example.com/remove"},
		},
	}}
	object.SetGroupVersionKind(schema.GroupVersionKind{Version: "v1", Kind: "ConfigMap"})
	scheme := runtime.NewScheme()
	dynamicClient := dynamicfake.NewSimpleDynamicClient(scheme, object)
	kubeClient := cgofake.NewClientset()
	allowSelfSubjectAccessReviews(kubeClient)
	testsupport.SeedAPIResources(t, kubeClient, testsupport.NewAPIResourceList("v1", metav1.APIResource{
		Name: "configmaps", SingularName: "configmap", Namespaced: true, Kind: "ConfigMap",
		Verbs: metav1.Verbs{"get", "list", "watch", "patch"},
	}))
	app := finalizerActionTestApp(t, kubeClient, dynamicClient)

	_, err := app.RunObjectAction(ObjectActionRequest{
		Action:    ObjectActionRemoveFinalizer,
		Target:    objectActionTarget("cluster-a", "", "v1", "ConfigMap", "default", "sample"),
		Finalizer: "example.com/remove", FinalizerPath: "metadata.finalizers",
	})
	if err != nil {
		t.Fatalf("RunObjectAction returned error: %v", err)
	}

	gvr := schema.GroupVersionResource{Version: "v1", Resource: "configmaps"}
	updated, err := dynamicClient.Resource(gvr).Namespace("default").Get(context.Background(), "sample", metav1.GetOptions{})
	if err != nil {
		t.Fatalf("get updated ConfigMap: %v", err)
	}
	if got := updated.GetFinalizers(); len(got) != 1 || got[0] != "example.com/keep" {
		t.Fatalf("unexpected finalizers: %v", got)
	}
	assertFinalizerPermission(t, kubeClient.Actions(), authorizationv1.ResourceAttributes{
		Namespace: "default", Verb: "patch", Resource: "configmaps", Name: "sample",
	})
}

func TestRunObjectActionRemovesNamespaceSpecFinalizerWithFinalizePermission(t *testing.T) {
	deletingAt := metav1.NewTime(time.Date(2026, time.August, 10, 12, 0, 0, 0, time.UTC))
	namespace := &corev1.Namespace{
		ObjectMeta: metav1.ObjectMeta{Name: "terminating", DeletionTimestamp: &deletingAt},
		Spec: corev1.NamespaceSpec{Finalizers: []corev1.FinalizerName{
			corev1.FinalizerKubernetes,
			corev1.FinalizerName("example.com/keep"),
		}},
	}
	kubeClient := cgofake.NewClientset(namespace.DeepCopy())
	allowSelfSubjectAccessReviews(kubeClient)
	testsupport.SeedAPIResources(t, kubeClient, testsupport.NewAPIResourceList("v1", metav1.APIResource{
		Name: "namespaces", SingularName: "namespace", Namespaced: false, Kind: "Namespace",
		Verbs: metav1.Verbs{"get", "list", "watch", "update"},
	}))
	app := finalizerActionTestApp(t, kubeClient, nil)

	_, err := app.RunObjectAction(ObjectActionRequest{
		Action:    ObjectActionRemoveFinalizer,
		Target:    objectActionTarget("cluster-a", "", "v1", "Namespace", "", namespace.Name),
		Finalizer: string(corev1.FinalizerKubernetes), FinalizerPath: "spec.finalizers",
	})
	if err != nil {
		t.Fatalf("RunObjectAction returned error: %v", err)
	}

	updated, err := kubeClient.CoreV1().Namespaces().Get(context.Background(), namespace.Name, metav1.GetOptions{})
	if err != nil {
		t.Fatalf("get updated Namespace: %v", err)
	}
	if got := updated.Spec.Finalizers; len(got) != 1 || got[0] != "example.com/keep" {
		t.Fatalf("unexpected Namespace finalizers: %v", got)
	}
	assertFinalizerPermission(t, kubeClient.Actions(), authorizationv1.ResourceAttributes{
		Verb: "update", Resource: "namespaces", Subresource: "finalize", Name: namespace.Name,
	})
}

func TestRunObjectActionDoesNotPatchFinalizerWhenPermissionDenied(t *testing.T) {
	object := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "v1", "kind": "ConfigMap",
		"metadata": map[string]any{
			"name": "sample", "namespace": "default",
			"deletionTimestamp": "2026-08-10T12:00:00Z",
			"finalizers":        []any{"example.com/remove"},
		},
	}}
	dynamicClient := dynamicfake.NewSimpleDynamicClient(runtime.NewScheme(), object)
	kubeClient := cgofake.NewClientset()
	denySelfSubjectAccessReviews(kubeClient, "no patch")
	testsupport.SeedAPIResources(t, kubeClient, testsupport.NewAPIResourceList("v1", metav1.APIResource{
		Name: "configmaps", Namespaced: true, Kind: "ConfigMap", Verbs: metav1.Verbs{"get", "list", "watch", "patch"},
	}))
	app := finalizerActionTestApp(t, kubeClient, dynamicClient)

	_, err := app.RunObjectAction(ObjectActionRequest{
		Action:    ObjectActionRemoveFinalizer,
		Target:    objectActionTarget("cluster-a", "", "v1", "ConfigMap", "default", "sample"),
		Finalizer: "example.com/remove", FinalizerPath: "metadata.finalizers",
	})
	if err == nil {
		t.Fatal("expected permission denial")
	}
	for _, action := range dynamicClient.Actions() {
		if action.Matches("patch", "configmaps") {
			t.Fatalf("finalizer patch must not run after denial: %#v", action)
		}
	}
}

func TestRemoveObjectFinalizerActionRejectsInvalidDirectPathsAndMissingClusters(t *testing.T) {
	kubeClient := cgofake.NewClientset()
	app := finalizerActionTestApp(t, kubeClient, dynamicfake.NewSimpleDynamicClient(runtime.NewScheme()))
	target := objectActionTarget("cluster-a", "", "v1", "ConfigMap", "default", "sample")

	if err := app.removeObjectFinalizerAction(target, "example.com/remove", "status.finalizers"); err == nil {
		t.Fatal("expected unsupported path error")
	}
	if err := app.removeObjectFinalizerAction(target, "example.com/remove", objectFinalizerPathSpec); err == nil {
		t.Fatal("expected Namespace target error")
	}
	if err := NewApp().removeObjectFinalizerAction(
		objectActionTarget("missing", "", "v1", "ConfigMap", "default", "sample"),
		"example.com/remove",
		objectFinalizerPathMetadata,
	); err == nil {
		t.Fatal("expected missing cluster error")
	}
}

func finalizerActionTestApp(t testing.TB, kubeClient *cgofake.Clientset, dynamicClient *dynamicfake.FakeDynamicClient) *App {
	t.Helper()
	app := NewApp()
	app.setRuntimeContext(context.Background())
	registerTestClusterWithClients(app, "cluster-a", &clusterClients{
		meta: ClusterMeta{ID: "cluster-a", Name: "cluster-a"}, kubeconfigPath: "/path", kubeconfigContext: "ctx",
		client: kubeClient, dynamicClient: dynamicClient,
	})
	return app
}

func assertFinalizerPermission(t testing.TB, actions []cgotesting.Action, want authorizationv1.ResourceAttributes) {
	t.Helper()
	for _, action := range actions {
		create, ok := action.(cgotesting.CreateAction)
		if !ok || create.GetResource().Resource != "selfsubjectaccessreviews" {
			continue
		}
		review, ok := create.GetObject().(*authorizationv1.SelfSubjectAccessReview)
		if ok && review.Spec.ResourceAttributes != nil && *review.Spec.ResourceAttributes == want {
			return
		}
	}
	t.Fatalf("permission review %#v not found in actions %#v", want, actions)
}
