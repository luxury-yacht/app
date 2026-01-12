package backend

import (
	"context"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/capabilities"
	authorizationv1 "k8s.io/api/authorization/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	fakediscovery "k8s.io/client-go/discovery/fake"
	clientgofake "k8s.io/client-go/kubernetes/fake"
	kubetesting "k8s.io/client-go/testing"
)

const capabilitiesClusterID = "config:ctx"

func TestEvaluateCapabilitiesSuccess(t *testing.T) {
	client := clientgofake.NewClientset()
	client.Fake.PrependReactor("create", "selfsubjectaccessreviews", func(action kubetesting.Action) (bool, runtime.Object, error) {
		createAction := action.(kubetesting.CreateAction)
		review := createAction.GetObject().(*authorizationv1.SelfSubjectAccessReview)
		review.Status = authorizationv1.SubjectAccessReviewStatus{
			Allowed: true,
		}
		return true, review, nil
	})

	discovery := client.Discovery().(*fakediscovery.FakeDiscovery)
	discovery.Resources = []*metav1.APIResourceList{
		{
			GroupVersion: "apps/v1",
			APIResources: []metav1.APIResource{
				{
					Name:       "deployments",
					Namespaced: true,
					Kind:       "Deployment",
				},
			},
		},
	}

	app := NewApp()
	app.Ctx = context.Background()
	app.client = client
	app.clusterClients = map[string]*clusterClients{
		capabilitiesClusterID: {
			meta:              ClusterMeta{ID: capabilitiesClusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
			client:            client,
		},
	}

	gvrCacheMutex.Lock()
	original, hadOriginal := gvrCache["Deployment"]
	gvrCache["Deployment"] = gvrCacheEntry{
		gvr: schema.GroupVersionResource{
			Group:    "apps",
			Version:  "v1",
			Resource: "deployments",
		},
		namespaced: true,
		cachedAt:   time.Now(),
	}
	gvrCacheMutex.Unlock()
	defer func() {
		gvrCacheMutex.Lock()
		if hadOriginal {
			gvrCache["Deployment"] = original
		} else {
			delete(gvrCache, "Deployment")
		}
		gvrCacheMutex.Unlock()
	}()

	requests := []capabilities.CheckRequest{
		{
			ID:           "update",
			ClusterID:    capabilitiesClusterID,
			Verb:         "update",
			ResourceKind: "Deployment",
			Namespace:    "default",
			Name:         "demo",
		},
	}

	results, err := app.EvaluateCapabilities(requests)
	if err != nil {
		t.Fatalf("EvaluateCapabilities returned error: %v", err)
	}

	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}

	if !results[0].Allowed {
		t.Fatalf("expected capability to be allowed, got %+v", results[0])
	}
}

func TestEvaluateCapabilitiesHandlesInvalidRequest(t *testing.T) {
	app := NewApp()
	app.Ctx = context.Background()
	app.clusterClients = map[string]*clusterClients{
		capabilitiesClusterID: {
			meta:              ClusterMeta{ID: capabilitiesClusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
		},
	}

	results, err := app.EvaluateCapabilities([]capabilities.CheckRequest{
		{ID: "", ClusterID: capabilitiesClusterID, Verb: "get", ResourceKind: "Pod"},
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}

	if results[0].Error == "" {
		t.Fatalf("expected validation error, got %+v", results[0])
	}
}

func TestEvaluateCapabilitiesDeduplicatesRequests(t *testing.T) {
	client := clientgofake.NewClientset()
	var sarCalls int
	client.Fake.PrependReactor("create", "selfsubjectaccessreviews", func(action kubetesting.Action) (bool, runtime.Object, error) {
		sarCalls++
		createAction := action.(kubetesting.CreateAction)
		review := createAction.GetObject().(*authorizationv1.SelfSubjectAccessReview)
		review.Status = authorizationv1.SubjectAccessReviewStatus{
			Allowed: true,
		}
		return true, review, nil
	})

	app := NewApp()
	app.Ctx = context.Background()
	app.client = client
	app.clusterClients = map[string]*clusterClients{
		capabilitiesClusterID: {
			meta:              ClusterMeta{ID: capabilitiesClusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
			client:            client,
		},
	}

	gvrCacheMutex.Lock()
	gvrCache["Deployment"] = gvrCacheEntry{
		gvr: schema.GroupVersionResource{
			Group:    "apps",
			Version:  "v1",
			Resource: "deployments",
		},
		namespaced: true,
		cachedAt:   time.Now(),
	}
	gvrCacheMutex.Unlock()
	defer func() {
		gvrCacheMutex.Lock()
		delete(gvrCache, "Deployment")
		gvrCacheMutex.Unlock()
	}()

	requests := []capabilities.CheckRequest{
		{
			ID:           "delete-a",
			ClusterID:    capabilitiesClusterID,
			Verb:         "delete",
			ResourceKind: "Deployment",
			Namespace:    "default",
			Name:         "demo",
		},
		{
			ID:           "delete-b",
			ClusterID:    capabilitiesClusterID,
			Verb:         "delete",
			ResourceKind: "Deployment",
			Namespace:    "default",
			Name:         "demo",
		},
	}

	results, err := app.EvaluateCapabilities(requests)
	if err != nil {
		t.Fatalf("EvaluateCapabilities returned error: %v", err)
	}

	if sarCalls != 1 {
		t.Fatalf("expected 1 SAR call, got %d", sarCalls)
	}

	if len(results) != len(requests) {
		t.Fatalf("expected %d results, got %d", len(requests), len(results))
	}

	for i, result := range results {
		if !result.Allowed {
			t.Fatalf("expected result %d to be allowed, got %+v", i, result)
		}
		if result.ID != requests[i].ID {
			t.Fatalf("expected result ID %q, got %q", requests[i].ID, result.ID)
		}
	}
}
