package backend

import (
	"context"
	"testing"

	"github.com/luxury-yacht/app/backend/capabilities"
	authorizationv1 "k8s.io/api/authorization/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	fakediscovery "k8s.io/client-go/discovery/fake"
	cgofake "k8s.io/client-go/kubernetes/fake"
	cgotesting "k8s.io/client-go/testing"
)

const capabilitiesClusterID = "config:ctx"

func TestEvaluateCapabilitiesSuccess(t *testing.T) {
	client := cgofake.NewClientset()
	client.Fake.PrependReactor("create", "selfsubjectaccessreviews", func(action cgotesting.Action) (bool, runtime.Object, error) {
		createAction := action.(cgotesting.CreateAction)
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
	// Per-cluster client is stored in clusterClients, not in global fields.
	app.clusterClients = map[string]*clusterClients{
		capabilitiesClusterID: {
			meta:              ClusterMeta{ID: capabilitiesClusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
			client:            client,
		},
	}

	// discovery.Resources above advertises apps/v1 Deployment so
	// common.ResolveGVRForGVK can resolve the request without a
	// kind-only fallback.
	requests := []capabilities.CheckRequest{
		{
			ID:           "update",
			ClusterID:    capabilitiesClusterID,
			Group:        "apps",
			Version:      "v1",
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
	client := cgofake.NewClientset()
	var sarCalls int
	client.Fake.PrependReactor("create", "selfsubjectaccessreviews", func(action cgotesting.Action) (bool, runtime.Object, error) {
		sarCalls++
		createAction := action.(cgotesting.CreateAction)
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
	// Per-cluster client is stored in clusterClients, not in global fields.
	app.clusterClients = map[string]*clusterClients{
		capabilitiesClusterID: {
			meta:              ClusterMeta{ID: capabilitiesClusterID, Name: "ctx"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
			client:            client,
		},
	}

	requests := []capabilities.CheckRequest{
		{
			ID:           "delete-a",
			ClusterID:    capabilitiesClusterID,
			Group:        "apps",
			Version:      "v1",
			Verb:         "delete",
			ResourceKind: "Deployment",
			Namespace:    "default",
			Name:         "demo",
		},
		{
			ID:           "delete-b",
			ClusterID:    capabilitiesClusterID,
			Group:        "apps",
			Version:      "v1",
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
