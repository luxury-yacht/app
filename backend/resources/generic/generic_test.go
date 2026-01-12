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
	kubefake "k8s.io/client-go/kubernetes/fake"
)

func TestServiceDeleteCoreResource(t *testing.T) {
	scheme := testsupport.NewScheme(t, corev1.AddToScheme)
	pod := testsupport.PodFixture("default", "web-0")

	dynamicClient := testsupport.NewDynamicClient(t, scheme, pod.DeepCopyObject())
	kubeClient := kubefake.NewClientset(pod.DeepCopy())

	deps := testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(kubeClient),
		testsupport.WithDepsDynamicClient(dynamicClient),
	)
	service := NewService(Dependencies{Common: deps})

	if err := service.Delete("Pod", "default", "web-0"); err != nil {
		t.Fatalf("Delete returned error: %v", err)
	}

	gvr := schema.GroupVersionResource{Group: "", Version: "v1", Resource: "pods"}
	_, err := dynamicClient.Resource(gvr).Namespace("default").Get(context.Background(), "web-0", metav1.GetOptions{})
	if !apierrors.IsNotFound(err) {
		t.Fatalf("expected pod to be deleted, got err=%v", err)
	}
}

func TestServiceDeleteCustomResource(t *testing.T) {
	kubeClient := kubefake.NewClientset()
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
	service := NewService(Dependencies{Common: deps})

	if err := service.Delete("Widget", "default", "sample"); err != nil {
		t.Fatalf("Delete returned error: %v", err)
	}

	gvr := schema.GroupVersionResource{Group: "example.com", Version: "v1", Resource: "widgets"}
	_, err := dynamicClient.Resource(gvr).Namespace("default").Get(context.Background(), "sample", metav1.GetOptions{})
	if !apierrors.IsNotFound(err) {
		t.Fatalf("expected widget to be deleted, got err=%v", err)
	}
}
