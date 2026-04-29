package backend

import (
	"context"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/capabilities"
	authorizationv1 "k8s.io/api/authorization/v1"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	apiextensionsfake "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset/fake"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	cgofake "k8s.io/client-go/kubernetes/fake"
	cgotesting "k8s.io/client-go/testing"
)

func TestQueryPermissions_EmptyBatch(t *testing.T) {
	app := &App{}
	resp, err := app.QueryPermissions(nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if len(resp.Results) != 0 {
		t.Errorf("expected 0 results, got %d", len(resp.Results))
	}
}

func TestQueryPermissions_FetchesNamespaceSSRRsConcurrently(t *testing.T) {
	const clusterID = "cluster-concurrent"
	const namespaceCount = 8
	client := cgofake.NewClientset()
	var active atomic.Int32
	var maxActive atomic.Int32

	fetchRules := func(context.Context, string) (*authorizationv1.SubjectRulesReviewStatus, error) {
		current := active.Add(1)
		defer active.Add(-1)
		for {
			max := maxActive.Load()
			if current <= max || maxActive.CompareAndSwap(max, current) {
				break
			}
		}
		time.Sleep(25 * time.Millisecond)

		return &authorizationv1.SubjectRulesReviewStatus{
			ResourceRules: []authorizationv1.ResourceRule{
				{
					Verbs:     []string{"list"},
					APIGroups: []string{""},
					Resources: []string{"pods"},
				},
			},
		}, nil
	}

	app := NewApp()
	app.Ctx = context.Background()
	app.clusterClients = map[string]*clusterClients{
		clusterID: {
			meta:              ClusterMeta{ID: clusterID, Name: "Concurrent"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
			client:            client,
		},
	}
	app.ssrrCaches = map[string]*capabilities.SSRRCache{
		clusterID: capabilities.NewSSRRCache(clusterID, time.Minute, 0, fetchRules, nil),
	}

	queries := make([]capabilities.PermissionQuery, 0, namespaceCount)
	for i := range namespaceCount {
		queries = append(queries, capabilities.PermissionQuery{
			ID:           "pod-list",
			ClusterId:    clusterID,
			Group:        "",
			Version:      "v1",
			ResourceKind: "Pod",
			Verb:         "list",
			Namespace:    fmt.Sprintf("ns-%d", i),
		})
	}

	resp, err := app.QueryPermissions(queries)
	if err != nil {
		t.Fatalf("QueryPermissions returned error: %v", err)
	}
	for _, result := range resp.Results {
		if !result.Allowed || result.Source != "ssrr" {
			t.Fatalf("expected allowed SSRR result, got %+v", result)
		}
	}
	if maxActive.Load() < 2 {
		t.Fatalf("expected concurrent SSRR fetches, max active fetches was %d", maxActive.Load())
	}
}

func TestQueryPermissions_ValidationErrors(t *testing.T) {
	app := &App{}

	checks := []capabilities.PermissionQuery{
		{ID: "", Verb: "list", ResourceKind: "Pod", ClusterId: "c1"},
		{ID: "1", Verb: "", ResourceKind: "Pod", ClusterId: "c1"},
		{ID: "2", Verb: "list", ResourceKind: "", ClusterId: "c1"},
		{ID: "3", Verb: "list", ResourceKind: "Pod", ClusterId: ""},
	}

	resp, err := app.QueryPermissions(checks)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(resp.Results) != 4 {
		t.Fatalf("expected 4 results, got %d", len(resp.Results))
	}

	for i, r := range resp.Results {
		if r.Source != "error" {
			t.Errorf("result[%d]: expected source 'error', got %q", i, r.Source)
		}
		if r.Error == "" {
			t.Errorf("result[%d]: expected non-empty error", i)
		}
	}
}

func TestQueryPermissions_BuiltinPodBypassesDiscovery(t *testing.T) {
	const clusterID = "cluster-pods"
	client := cgofake.NewClientset()
	client.Fake.PrependReactor("create", "selfsubjectrulesreviews", func(action cgotesting.Action) (bool, runtime.Object, error) {
		createAction := action.(cgotesting.CreateAction)
		review := createAction.GetObject().(*authorizationv1.SelfSubjectRulesReview)
		review.Status = authorizationv1.SubjectRulesReviewStatus{
			ResourceRules: []authorizationv1.ResourceRule{
				{
					Verbs:     []string{"list", "delete", "get", "create"},
					APIGroups: []string{""},
					Resources: []string{"pods", "pods/log", "pods/portforward"},
				},
			},
		}
		return true, review, nil
	})

	app := NewApp()
	app.Ctx = context.Background()
	app.clusterClients = map[string]*clusterClients{
		clusterID: {
			meta:              ClusterMeta{ID: clusterID, Name: "Pods"},
			kubeconfigPath:    "/path",
			kubeconfigContext: "ctx",
			client:            client,
		},
	}

	queries := []capabilities.PermissionQuery{
		{ID: "pod-list", ClusterId: clusterID, Group: "", Version: "v1", ResourceKind: "Pod", Verb: "list", Namespace: "default"},
		{ID: "pod-delete", ClusterId: clusterID, Group: "", Version: "v1", ResourceKind: "Pod", Verb: "delete", Namespace: "default"},
		{ID: "pod-log", ClusterId: clusterID, Group: "", Version: "v1", ResourceKind: "Pod", Verb: "get", Namespace: "default", Subresource: "log"},
		{ID: "pod-portforward", ClusterId: clusterID, Group: "", Version: "v1", ResourceKind: "Pod", Verb: "create", Namespace: "default", Subresource: "portforward"},
	}

	resp, err := app.QueryPermissions(queries)
	if err != nil {
		t.Fatalf("QueryPermissions returned error: %v", err)
	}
	if len(resp.Results) != len(queries) {
		t.Fatalf("expected %d results, got %d", len(queries), len(resp.Results))
	}
	for _, result := range resp.Results {
		if result.Source == "error" {
			t.Fatalf("builtin pod query %q unexpectedly hit discovery/error path: %s", result.ID, result.Error)
		}
		if !result.Allowed {
			t.Fatalf("builtin pod query %q expected allowed, got source=%s reason=%s", result.ID, result.Source, result.Reason)
		}
	}
}

func TestQueryPermissions_CachesCRDResolutionWithinBatch(t *testing.T) {
	const clusterID = "cluster-crd"
	client := cgofake.NewClientset()
	client.Fake.PrependReactor("create", "selfsubjectrulesreviews", func(action cgotesting.Action) (bool, runtime.Object, error) {
		createAction := action.(cgotesting.CreateAction)
		review := createAction.GetObject().(*authorizationv1.SelfSubjectRulesReview)
		review.Status = authorizationv1.SubjectRulesReviewStatus{
			ResourceRules: []authorizationv1.ResourceRule{
				{
					Verbs:     []string{"get", "delete"},
					APIGroups: []string{"example.com"},
					Resources: []string{"widgets"},
				},
			},
		}
		return true, review, nil
	})

	crd := &apiextensionsv1.CustomResourceDefinition{
		ObjectMeta: metav1.ObjectMeta{Name: "widgets.example.com"},
		Spec: apiextensionsv1.CustomResourceDefinitionSpec{
			Group: "example.com",
			Names: apiextensionsv1.CustomResourceDefinitionNames{
				Plural: "widgets",
				Kind:   "Widget",
			},
			Scope: apiextensionsv1.NamespaceScoped,
			Versions: []apiextensionsv1.CustomResourceDefinitionVersion{
				{Name: "v1", Served: true, Storage: true},
			},
		},
	}
	apiextClient := apiextensionsfake.NewSimpleClientset(crd)
	crdListCalls := 0
	apiextClient.Fake.PrependReactor("list", "customresourcedefinitions", func(action cgotesting.Action) (bool, runtime.Object, error) {
		crdListCalls++
		return false, nil, nil
	})

	app := NewApp()
	app.Ctx = context.Background()
	app.clusterClients = map[string]*clusterClients{
		clusterID: {
			meta:                ClusterMeta{ID: clusterID, Name: "CRD"},
			kubeconfigPath:      "/path",
			kubeconfigContext:   "ctx",
			client:              client,
			apiextensionsClient: apiextClient,
		},
	}

	queries := []capabilities.PermissionQuery{
		{ID: "widget-get", ClusterId: clusterID, Group: "example.com", Version: "v1", ResourceKind: "Widget", Verb: "get", Namespace: "default"},
		{ID: "widget-delete", ClusterId: clusterID, Group: "example.com", Version: "v1", ResourceKind: "Widget", Verb: "delete", Namespace: "default"},
	}

	resp, err := app.QueryPermissions(queries)
	if err != nil {
		t.Fatalf("QueryPermissions returned error: %v", err)
	}
	if crdListCalls != 1 {
		t.Fatalf("expected CRD resolution to list CRDs once, got %d calls", crdListCalls)
	}
	for _, result := range resp.Results {
		if result.Source == "error" {
			t.Fatalf("CRD query %q unexpectedly errored: %s", result.ID, result.Error)
		}
		if !result.Allowed {
			t.Fatalf("CRD query %q expected allowed, got source=%s reason=%s", result.ID, result.Source, result.Reason)
		}
	}
}
