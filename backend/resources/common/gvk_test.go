package common

import (
	"context"
	"testing"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	fakediscovery "k8s.io/client-go/discovery/fake"
	"k8s.io/client-go/kubernetes/fake"
)

func TestResolveGVRForGVKCachesPerClusterAndCanBeCleared(t *testing.T) {
	ctx := context.Background()
	clusterID := "cluster-gvr-cache-test"
	gvk := schema.GroupVersionKind{Group: "example.com", Version: "v1", Kind: "Widget"}
	client := fake.NewClientset()
	deps := Dependencies{
		Context:          ctx,
		KubernetesClient: client,
		ClusterID:        clusterID,
	}
	ClearGVRCacheForCluster(clusterID)
	t.Cleanup(func() {
		ClearGVRCacheForCluster(clusterID)
	})

	seedFakeAPIResources(t, client, &metav1.APIResourceList{
		GroupVersion: "example.com/v1",
		APIResources: []metav1.APIResource{{
			Name:       "widgets",
			Kind:       "Widget",
			Namespaced: true,
		}},
	})
	gvr, namespaced, err := ResolveGVRForGVK(ctx, deps, gvk)
	if err != nil {
		t.Fatalf("ResolveGVRForGVK initial: %v", err)
	}
	if gvr.Resource != "widgets" || !namespaced {
		t.Fatalf("unexpected initial result: %s namespaced=%v", gvr.String(), namespaced)
	}

	seedFakeAPIResources(t, client, &metav1.APIResourceList{
		GroupVersion: "example.com/v1",
		APIResources: []metav1.APIResource{{
			Name:       "widgets2",
			Kind:       "Widget",
			Namespaced: false,
		}},
	})
	gvr, namespaced, err = ResolveGVRForGVK(ctx, deps, gvk)
	if err != nil {
		t.Fatalf("ResolveGVRForGVK cached: %v", err)
	}
	if gvr.Resource != "widgets" || !namespaced {
		t.Fatalf("expected cached result, got %s namespaced=%v", gvr.String(), namespaced)
	}

	ClearGVRCacheForCluster(clusterID)
	gvr, namespaced, err = ResolveGVRForGVK(ctx, deps, gvk)
	if err != nil {
		t.Fatalf("ResolveGVRForGVK after clear: %v", err)
	}
	if gvr.Resource != "widgets2" || namespaced {
		t.Fatalf("expected refreshed result, got %s namespaced=%v", gvr.String(), namespaced)
	}
}

func seedFakeAPIResources(t *testing.T, client *fake.Clientset, lists ...*metav1.APIResourceList) {
	t.Helper()

	discoveryClient, ok := client.Discovery().(*fakediscovery.FakeDiscovery)
	if !ok {
		t.Fatalf("expected fake discovery client, got %T", client.Discovery())
	}
	copyLists := make([]*metav1.APIResourceList, 0, len(lists))
	for _, list := range lists {
		copy := *list
		copy.APIResources = append([]metav1.APIResource(nil), list.APIResources...)
		copyLists = append(copyLists, &copy)
	}
	discoveryClient.Resources = copyLists
}
