package objectcatalog

import (
	"testing"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

func TestLabelsDigestAndContainsVerb(t *testing.T) {
	if digest := labelsDigest(nil); digest != "" {
		t.Fatalf("expected empty digest for nil labels")
	}
	digest := labelsDigest(map[string]string{"b": "2", "a": "1"})
	if digest == "" {
		t.Fatalf("expected digest for labels")
	}

	if containsVerb([]string{"get", "list"}, "delete") {
		t.Fatalf("expected delete not to be contained")
	}
	if !containsVerb([]string{"get", "list"}, "GET") {
		t.Fatalf("expected case-insensitive match for get")
	}
}

func TestCatalogKey(t *testing.T) {
	descNamespaced := resourceDescriptor{GVR: schema.GroupVersionResource{Group: "g", Version: "v1", Resource: "rs"}, Namespaced: true}
	descCluster := resourceDescriptor{GVR: schema.GroupVersionResource{Group: "g", Version: "v1", Resource: "rs"}, Namespaced: false}

	if got := catalogKey(descNamespaced, "ns", "name"); got != "g/v1, Resource=rs/ns/name" {
		t.Fatalf("unexpected namespaced key: %s", got)
	}
	if got := catalogKey(descCluster, "ns", "name"); got != "g/v1, Resource=rs//name" {
		t.Fatalf("unexpected cluster key: %s", got)
	}
}

func TestDescriptorStreamingPriority(t *testing.T) {
	desc := resourceDescriptor{Resource: "pods", Scope: ScopeNamespace}
	if got := descriptorStreamingPriority(desc); got != 800+len("pods") {
		t.Fatalf("unexpected priority for namespace pods: %d", got)
	}

	clusterDesc := resourceDescriptor{Resource: "pods", Scope: ScopeCluster}
	if got := descriptorStreamingPriority(clusterDesc); got != 700+len("pods") {
		t.Fatalf("unexpected priority for cluster pods: %d", got)
	}

	unknownDesc := resourceDescriptor{Resource: "widgets", Scope: ScopeCluster}
	if got := descriptorStreamingPriority(unknownDesc); got != 900+len("widgets") {
		t.Fatalf("expected default priority baseline, got %d", got)
	}
}

func TestBuildSummaryAndSort(t *testing.T) {
	desc := resourceDescriptor{
		Kind:       "Pod",
		Group:      "",
		Version:    "v1",
		Resource:   "pods",
		Scope:      ScopeNamespace,
		Namespaced: true,
	}
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "demo",
			Namespace:         "ns",
			UID:               "uid",
			ResourceVersion:   "rv",
			CreationTimestamp: metav1.NewTime(time.Unix(1, 0)),
			Labels:            map[string]string{"app": "demo"},
		},
	}
	svc := &Service{}
	summary := svc.buildSummary(desc, pod)
	if summary.Name != "demo" || summary.Namespace != "ns" || summary.Kind != "Pod" {
		t.Fatalf("unexpected summary: %#v", summary)
	}
	if summary.LabelsDigest == "" {
		t.Fatalf("expected labels digest to be set")
	}

	items := []Summary{
		{Kind: "B", Namespace: "ns2", Name: "b"},
		{Kind: "A", Namespace: "ns1", Name: "a"},
	}
	sortSummaries(items)
	if items[0].Kind != "A" || items[0].Namespace != "ns1" {
		t.Fatalf("expected sorted summaries, got %#v", items)
	}
}

func TestSnapshotSortedKeys(t *testing.T) {
	if snapshotSortedKeys(nil) != nil {
		t.Fatalf("expected nil from nil input")
	}
	input := map[string]struct{}{"b": {}, "a": {}}
	out := snapshotSortedKeys(input)
	if len(out) != 2 || out[0] != "a" || out[1] != "b" {
		t.Fatalf("expected sorted keys, got %v", out)
	}
}

func TestBroadcastStreamingSendsReady(t *testing.T) {
	ch := make(chan StreamingUpdate, 2)
	ch <- StreamingUpdate{Ready: false} // stale signal to drain

	svc := &Service{
		streamSubscribers: map[int]chan StreamingUpdate{1: ch},
	}

	svc.broadcastStreaming(true)

	select {
	case update := <-ch:
		if !update.Ready {
			t.Fatalf("expected ready update, got %v", update)
		}
	default:
		t.Fatalf("expected update to be sent")
	}
}
