/*
 * backend/resources/generic/generic_test.go
 *
 * Tests for Generic resource deletion helpers.
 * - Covers Generic resource deletion helpers behavior and edge cases.
 */

package generic

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/testsupport"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes/fake"
	cgotesting "k8s.io/client-go/testing"
)

func TestServiceDeleteByGVKCoreResource(t *testing.T) {
	scheme := testsupport.NewScheme(t, corev1.AddToScheme)
	pod := testsupport.PodFixture("default", "web-0")

	dynamicClient := testsupport.NewDynamicClient(t, scheme, pod.DeepCopyObject())
	kubeClient := fake.NewClientset(pod.DeepCopy())

	// DeleteByGVK goes through the object-catalog resource resolver, which
	// hydrates from discovery on a miss, so the fake needs to advertise Pod.
	testsupport.SeedAPIResources(t, kubeClient, testsupport.NewAPIResourceList("v1", metav1.APIResource{
		Name:         "pods",
		SingularName: "pod",
		Namespaced:   true,
		Kind:         "Pod",
		Verbs:        metav1.Verbs{"get", "list", "watch", "delete"},
	}))

	deps := testsupport.NewResourceDependencies(
		testsupport.WithDepsKubeClient(kubeClient),
		testsupport.WithDepsDynamicClient(dynamicClient),
	)
	deps.ResourceResolver = objectcatalog.NewResourceResolver(deps, nil)
	service := NewService(deps)

	gvk := schema.GroupVersionKind{Group: "", Version: "v1", Kind: "Pod"}
	if err := service.DeleteByGVK(context.Background(), gvk, "default", "web-0"); err != nil {
		t.Fatalf("DeleteByGVK returned error: %v", err)
	}

	gvr := schema.GroupVersionResource{Group: "", Version: "v1", Resource: "pods"}
	_, err := dynamicClient.Resource(gvr).Namespace("default").Get(context.Background(), "web-0", metav1.GetOptions{})
	if !apierrors.IsNotFound(err) {
		t.Fatalf("expected pod to be deleted, got err=%v", err)
	}
}

func TestServiceDeleteByGVKRequiresName(t *testing.T) {
	service := NewService(testsupport.NewResourceDependencies())
	gvk := schema.GroupVersionKind{Group: "", Version: "v1", Kind: "Pod"}

	for _, name := range []string{"", "  "} {
		t.Run("name="+name, func(t *testing.T) {
			err := service.DeleteByGVK(context.Background(), gvk, "default", name)
			if err == nil {
				t.Fatal("expected error when name is empty")
			}
			if err.Error() != "name is required" {
				t.Fatalf("expected name error, got %v", err)
			}
		})
	}
}

func TestServiceDeleteByGVKCustomResource(t *testing.T) {
	kubeClient := fake.NewClientset()
	testsupport.SeedAPIResources(t, kubeClient, testsupport.NewAPIResourceList("example.com/v1", metav1.APIResource{
		Name:         "widgets",
		SingularName: "widget",
		Namespaced:   true,
		Kind:         "Widget",
		Verbs:        metav1.Verbs{"get", "list", "watch", "delete"},
	}))

	obj := &unstructured.Unstructured{
		Object: map[string]any{
			"apiVersion": "example.com/v1",
			"kind":       "Widget",
			"metadata": map[string]any{
				"name":      "sample",
				"namespace": "default",
			},
		},
	}
	obj.SetGroupVersionKind(schema.GroupVersionKind{Group: "example.com", Version: "v1", Kind: "Widget"})

	dynamicClient := testsupport.NewDynamicClient(t, nil, obj)

	deps := testsupport.NewResourceDependencies(
		testsupport.WithDepsKubeClient(kubeClient),
		testsupport.WithDepsDynamicClient(dynamicClient),
	)
	deps.ResourceResolver = objectcatalog.NewResourceResolver(deps, nil)
	service := NewService(deps)

	gvk := schema.GroupVersionKind{Group: "example.com", Version: "v1", Kind: "Widget"}
	if err := service.DeleteByGVK(context.Background(), gvk, "default", "sample"); err != nil {
		t.Fatalf("DeleteByGVK returned error: %v", err)
	}

	gvr := schema.GroupVersionResource{Group: "example.com", Version: "v1", Resource: "widgets"}
	_, err := dynamicClient.Resource(gvr).Namespace("default").Get(context.Background(), "sample", metav1.GetOptions{})
	if !apierrors.IsNotFound(err) {
		t.Fatalf("expected widget to be deleted, got err=%v", err)
	}
}

func TestServiceRemoveMetadataFinalizerByGVKRemovesOnlySelectedFinalizer(t *testing.T) {
	deletingAt := metav1.NewTime(time.Date(2026, time.August, 10, 12, 0, 0, 0, time.UTC))
	obj := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "example.com/v1",
		"kind":       "Widget",
		"metadata": map[string]any{
			"name":              "sample",
			"namespace":         "default",
			"deletionTimestamp": deletingAt.Format(time.RFC3339),
			"finalizers": []any{
				"example.com/keep",
				"example.com/remove",
			},
		},
	}}
	obj.SetGroupVersionKind(schema.GroupVersionKind{Group: "example.com", Version: "v1", Kind: "Widget"})

	kubeClient := fake.NewClientset()
	testsupport.SeedAPIResources(t, kubeClient, testsupport.NewAPIResourceList("example.com/v1", metav1.APIResource{
		Name: "widgets", SingularName: "widget", Namespaced: true, Kind: "Widget",
		Verbs: metav1.Verbs{"get", "list", "watch", "patch"},
	}))
	dynamicClient := testsupport.NewDynamicClient(t, nil, obj)
	deps := testsupport.NewResourceDependencies(
		testsupport.WithDepsKubeClient(kubeClient),
		testsupport.WithDepsDynamicClient(dynamicClient),
	)
	deps.ResourceResolver = objectcatalog.NewResourceResolver(deps, nil)

	err := NewService(deps).RemoveMetadataFinalizerByGVK(
		context.Background(), obj.GroupVersionKind(), "default", "sample", "example.com/remove",
	)
	if err != nil {
		t.Fatalf("RemoveMetadataFinalizerByGVK returned error: %v", err)
	}

	gvr := schema.GroupVersionResource{Group: "example.com", Version: "v1", Resource: "widgets"}
	updated, err := dynamicClient.Resource(gvr).Namespace("default").Get(context.Background(), "sample", metav1.GetOptions{})
	if err != nil {
		t.Fatalf("get patched widget: %v", err)
	}
	if got, want := updated.GetFinalizers(), []string{"example.com/keep"}; !equalStrings(got, want) {
		t.Fatalf("expected finalizers %v, got %v", want, got)
	}

	actions := dynamicClient.Actions()
	patchAction, ok := actions[len(actions)-2].(cgotesting.PatchAction)
	if !ok {
		t.Fatalf("expected patch action before verification get, got %#v", actions)
	}
	if patchAction.GetPatchType() != types.JSONPatchType {
		t.Fatalf("expected JSON patch, got %s", patchAction.GetPatchType())
	}
	var operations []map[string]any
	if err := json.Unmarshal(patchAction.GetPatch(), &operations); err != nil {
		t.Fatalf("decode patch: %v", err)
	}
	if len(operations) != 2 || operations[0]["op"] != "test" || operations[0]["path"] != "/metadata/finalizers" {
		t.Fatalf("expected finalizer test precondition before replacement, got %#v", operations)
	}
}

func TestServiceRemoveMetadataFinalizerByGVKRejectsActiveObject(t *testing.T) {
	obj := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "v1",
		"kind":       "ConfigMap",
		"metadata": map[string]any{
			"name":       "sample",
			"namespace":  "default",
			"finalizers": []any{"example.com/remove"},
		},
	}}
	obj.SetGroupVersionKind(schema.GroupVersionKind{Version: "v1", Kind: "ConfigMap"})
	kubeClient := fake.NewClientset()
	testsupport.SeedAPIResources(t, kubeClient, testsupport.NewAPIResourceList("v1", metav1.APIResource{
		Name: "configmaps", SingularName: "configmap", Namespaced: true, Kind: "ConfigMap",
		Verbs: metav1.Verbs{"get", "list", "watch", "patch"},
	}))
	dynamicClient := testsupport.NewDynamicClient(t, nil, obj)
	deps := testsupport.NewResourceDependencies(
		testsupport.WithDepsKubeClient(kubeClient),
		testsupport.WithDepsDynamicClient(dynamicClient),
	)
	deps.ResourceResolver = objectcatalog.NewResourceResolver(deps, nil)

	err := NewService(deps).RemoveMetadataFinalizerByGVK(
		context.Background(), obj.GroupVersionKind(), "default", "sample", "example.com/remove",
	)
	if err == nil {
		t.Fatal("expected active object removal to be rejected")
	}
	for _, action := range dynamicClient.Actions() {
		if action.Matches("patch", "configmaps") {
			t.Fatalf("active object must not be patched: %#v", action)
		}
	}
}

func TestServiceRemoveMetadataFinalizerByGVKValidatesResolutionAndInputs(t *testing.T) {
	ctx := context.Background()
	service := NewService(testsupport.NewResourceDependencies())
	requireErrorContains(t, service.RemoveMetadataFinalizerByGVK(ctx, schema.GroupVersionKind{}, "", "sample", "cleanup"), "version and kind are required")
	requireErrorContains(t, service.RemoveMetadataFinalizerByGVK(ctx, schema.GroupVersionKind{Version: "v1", Kind: "ConfigMap"}, "default", "sample", "cleanup"), "resource resolver not initialized")

	obj := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "v1",
		"kind":       "ConfigMap",
		"metadata": map[string]any{
			"name":              "sample",
			"namespace":         "default",
			"deletionTimestamp": "2026-08-10T12:00:00Z",
			"finalizers":        []any{"example.com/keep"},
		},
	}}
	obj.SetGroupVersionKind(schema.GroupVersionKind{Version: "v1", Kind: "ConfigMap"})
	kubeClient := fake.NewClientset()
	testsupport.SeedAPIResources(t, kubeClient, testsupport.NewAPIResourceList("v1", metav1.APIResource{
		Name: "configmaps", SingularName: "configmap", Namespaced: true, Kind: "ConfigMap",
		Verbs: metav1.Verbs{"get", "list", "watch", "patch"},
	}))
	dynamicClient := testsupport.NewDynamicClient(t, nil, obj)
	deps := testsupport.NewResourceDependencies(
		testsupport.WithDepsKubeClient(kubeClient),
		testsupport.WithDepsDynamicClient(dynamicClient),
	)
	deps.ResourceResolver = objectcatalog.NewResourceResolver(deps, nil)
	service = NewService(deps)

	requireErrorContains(t, service.RemoveMetadataFinalizerByGVK(ctx, obj.GroupVersionKind(), "default", "", "cleanup"), "name is required")
	requireErrorContains(t, service.RemoveMetadataFinalizerByGVK(ctx, obj.GroupVersionKind(), "default", "sample", ""), "finalizer is required")
	requireErrorContains(t, service.RemoveMetadataFinalizerByGVK(ctx, obj.GroupVersionKind(), "", "sample", "cleanup"), "requires a namespace")
	requireErrorContains(t, service.RemoveMetadataFinalizerByGVK(ctx, obj.GroupVersionKind(), "default", "missing", "cleanup"), "failed to get finalizers")
	requireNoError(t, service.RemoveMetadataFinalizerByGVK(ctx, obj.GroupVersionKind(), "default", "sample", "example.com/absent"))
	for _, action := range dynamicClient.Actions() {
		if action.Matches("patch", "configmaps") {
			t.Fatalf("absent finalizer must not be patched: %#v", action)
		}
	}
}

func requireErrorContains(t testing.TB, err error, contains string) {
	t.Helper()
	if err == nil || !strings.Contains(err.Error(), contains) {
		t.Fatalf("expected error containing %q, got %v", contains, err)
	}
}

func requireNoError(t testing.TB, err error) {
	t.Helper()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

func equalStrings(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
