package objectcatalog

import (
	"context"
	"fmt"
	"testing"

	"github.com/luxury-yacht/app/backend/resources/common"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	fakediscovery "k8s.io/client-go/discovery/fake"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	kubernetesfake "k8s.io/client-go/kubernetes/fake"
)

func BenchmarkServiceSyncLargeCluster(b *testing.B) {
	scheme := runtime.NewScheme()
	workloadGVK := schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "Deployment"}
	scheme.AddKnownTypeWithName(workloadGVK, &unstructured.Unstructured{})
	scheme.AddKnownTypeWithName(workloadGVK.GroupVersion().WithKind("DeploymentList"), &unstructured.UnstructuredList{})

	listKinds := map[schema.GroupVersionResource]string{
		{Group: "apps", Version: "v1", Resource: "deployments"}: "DeploymentList",
	}

	seedObjects := make([]runtime.Object, 0, 1000)
	for nsIdx := 0; nsIdx < 50; nsIdx++ {
		namespace := fmt.Sprintf("team-%03d", nsIdx)
		for objIdx := 0; objIdx < 200; objIdx++ {
			obj := &unstructured.Unstructured{}
			obj.SetGroupVersionKind(workloadGVK)
			obj.SetNamespace(namespace)
			obj.SetName(fmt.Sprintf("deploy-%03d", objIdx))
			seedObjects = append(seedObjects, obj)
		}
	}

	dyn := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(scheme, listKinds, seedObjects...)

	client := kubernetesfake.NewClientset()
	discovery := client.Discovery().(*fakediscovery.FakeDiscovery)
	discovery.Resources = []*metav1.APIResourceList{
		{
			GroupVersion: "apps/v1",
			APIResources: []metav1.APIResource{
				{Name: "deployments", Namespaced: true, Kind: "Deployment", Verbs: []string{"list"}},
			},
		},
	}

	deps := Dependencies{
		Common: common.Dependencies{
			KubernetesClient: client,
			DynamicClient:    dyn,
		},
	}

	svc := NewService(deps, &Options{PageSize: 200, ListWorkers: 16, NamespaceWorkers: 16})

	if err := svc.sync(context.Background()); err != nil {
		b.Fatalf("warmup sync failed: %v", err)
	}
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		if err := svc.sync(context.Background()); err != nil {
			b.Fatalf("sync failed: %v", err)
		}
	}
}
