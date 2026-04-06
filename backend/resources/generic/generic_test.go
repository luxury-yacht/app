/*
 * backend/resources/generic/generic_test.go
 *
 * Tests for Generic resource deletion helpers.
 * - Covers Generic resource deletion helpers behavior and edge cases.
 */

package generic

import (
	"context"
	"testing"

	"github.com/luxury-yacht/app/backend/testsupport"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/kubernetes/fake"
)

func TestServiceDeleteByGVKCoreResource(t *testing.T) {
	scheme := testsupport.NewScheme(t, corev1.AddToScheme)
	pod := testsupport.PodFixture("default", "web-0")

	dynamicClient := testsupport.NewDynamicClient(t, scheme, pod.DeepCopyObject())
	kubeClient := fake.NewClientset(pod.DeepCopy())

	// DeleteByGVK goes through common.ResolveGVRForGVK which hits discovery
	// to learn the resource plural name and namespace scope, so the fake
	// needs to advertise Pod.
	testsupport.SeedAPIResources(t, kubeClient, testsupport.NewAPIResourceList("v1", metav1.APIResource{
		Name:         "pods",
		SingularName: "pod",
		Namespaced:   true,
		Kind:         "Pod",
		Verbs:        metav1.Verbs{"get", "list", "watch", "delete"},
	}))

	deps := testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(kubeClient),
		testsupport.WithDepsDynamicClient(dynamicClient),
	)
	service := NewService(deps)

	gvk := schema.GroupVersionKind{Group: "", Version: "v1", Kind: "Pod"}
	if err := service.DeleteByGVK(gvk, "default", "web-0"); err != nil {
		t.Fatalf("DeleteByGVK returned error: %v", err)
	}

	gvr := schema.GroupVersionResource{Group: "", Version: "v1", Resource: "pods"}
	_, err := dynamicClient.Resource(gvr).Namespace("default").Get(context.Background(), "web-0", metav1.GetOptions{})
	if !apierrors.IsNotFound(err) {
		t.Fatalf("expected pod to be deleted, got err=%v", err)
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
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(kubeClient),
		testsupport.WithDepsDynamicClient(dynamicClient),
	)
	service := NewService(deps)

	gvk := schema.GroupVersionKind{Group: "example.com", Version: "v1", Kind: "Widget"}
	if err := service.DeleteByGVK(gvk, "default", "sample"); err != nil {
		t.Fatalf("DeleteByGVK returned error: %v", err)
	}

	gvr := schema.GroupVersionResource{Group: "example.com", Version: "v1", Resource: "widgets"}
	_, err := dynamicClient.Resource(gvr).Namespace("default").Get(context.Background(), "sample", metav1.GetOptions{})
	if !apierrors.IsNotFound(err) {
		t.Fatalf("expected widget to be deleted, got err=%v", err)
	}
}
