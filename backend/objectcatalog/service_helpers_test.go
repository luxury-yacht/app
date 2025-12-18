package objectcatalog

import (
	"context"
	"reflect"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/internal/timeutil"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

func TestCollectFromNamespacedLister(t *testing.T) {
	svc := &Service{now: time.Now}
	desc := resourceDescriptor{
		GVR:        schema.GroupVersionResource{Group: "", Version: "v1", Resource: "configmaps"},
		Namespaced: true,
		Kind:       "ConfigMap",
		Group:      "",
		Version:    "v1",
		Resource:   "configmaps",
		Scope:      ScopeNamespace,
	}

	var calls []string
	list := func(ns string) ([]metav1.Object, error) {
		calls = append(calls, ns)
		obj := &corev1.ConfigMap{ObjectMeta: metav1.ObjectMeta{Name: "cm-" + ns, Namespace: ns, ResourceVersion: "1"}}
		return []metav1.Object{obj}, nil
	}

	summaries, err := svc.collectFromNamespacedLister(desc, []string{"b", "a", "Cluster", "a"}, list)
	if err != nil {
		t.Fatalf("collectFromNamespacedLister returned error: %v", err)
	}

	expectedCalls := []string{"a", "b"}
	if !reflect.DeepEqual(calls, expectedCalls) {
		t.Fatalf("expected calls %v, got %v", expectedCalls, calls)
	}

	if len(summaries) != 2 || summaries[0].Name != "cm-a" || summaries[1].Name != "cm-b" {
		t.Fatalf("unexpected summaries: %+v", summaries)
	}
}

func TestListTargets(t *testing.T) {
	namespaced := listTargets(resourceDescriptor{Namespaced: true}, []string{})
	if !reflect.DeepEqual(namespaced, []string{metav1.NamespaceAll}) {
		t.Fatalf("expected NamespaceAll target, got %v", namespaced)
	}

	cluster := listTargets(resourceDescriptor{Namespaced: false}, []string{"ignored"})
	if !reflect.DeepEqual(cluster, []string{""}) {
		t.Fatalf("expected cluster target, got %v", cluster)
	}
}

func TestSummariesFromObjects(t *testing.T) {
	svc := &Service{now: time.Now}
	desc := resourceDescriptor{
		Kind:       "ConfigMap",
		Group:      "",
		Version:    "v1",
		Resource:   "configmaps",
		Scope:      ScopeNamespace,
		Namespaced: true,
	}
	creation := metav1.NewTime(time.Date(2024, 6, 1, 12, 0, 0, 0, time.UTC))
	objs := []metav1.Object{
		&corev1.ConfigMap{
			ObjectMeta: metav1.ObjectMeta{
				Name:              "cm",
				Namespace:         "ns",
				UID:               "uid-1",
				ResourceVersion:   "42",
				CreationTimestamp: creation,
				Labels:            map[string]string{"key": "val"},
			},
		},
		nil,
	}

	summaries := svc.summariesFromObjects(desc, objs)
	if len(summaries) != 1 {
		t.Fatalf("expected 1 summary, got %d", len(summaries))
	}

	summary := summaries[0]
	if summary.Name != "cm" || summary.Namespace != "ns" || summary.CreationTimestamp != creation.UTC().Format(time.RFC3339) || summary.LabelsDigest == "" {
		t.Fatalf("unexpected summary: %+v", summary)
	}
}

func TestToMetaObjects(t *testing.T) {
	items := []*corev1.Secret{
		{ObjectMeta: metav1.ObjectMeta{Name: "a", Namespace: "ns"}},
		{ObjectMeta: metav1.ObjectMeta{Name: "b", Namespace: "ns"}},
	}

	objs := toMetaObjects(items)
	if len(objs) != 2 || objs[0].GetName() != "a" || objs[1].GetName() != "b" {
		t.Fatalf("unexpected meta objects: %+v", objs)
	}
}

func TestFirstBatchLatencyAccessors(t *testing.T) {
	svc := &Service{}
	svc.setFirstBatchLatency(125 * time.Millisecond)
	if got := svc.FirstBatchLatency(); got != 125*time.Millisecond {
		t.Fatalf("expected latency 125ms, got %v", got)
	}
}

func TestSleepWithContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := timeutil.SleepWithContext(ctx, 10*time.Millisecond); err != context.Canceled {
		t.Fatalf("expected context cancellation, got %v", err)
	}

	if err := timeutil.SleepWithContext(context.Background(), 1*time.Millisecond); err != nil {
		t.Fatalf("expected nil error, got %v", err)
	}
}

func TestListRetryBackoff(t *testing.T) {
	if backoff := listRetryBackoff(0); backoff != listRetryInitialBackoff {
		t.Fatalf("expected initial backoff, got %v", backoff)
	}
	if backoff := listRetryBackoff(2); backoff != listRetryInitialBackoff*4 {
		t.Fatalf("unexpected backoff for attempt 2: %v", backoff)
	}
}
