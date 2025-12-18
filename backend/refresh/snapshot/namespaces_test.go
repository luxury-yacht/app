package snapshot

import (
	"context"
	"testing"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/testsupport"
)

func TestNamespaceBuilderSortsByName(t *testing.T) {
	nsB := &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "beta", ResourceVersion: "2"}}
	nsA := &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "alpha", ResourceVersion: "1"}}

	builder := &NamespaceBuilder{namespaces: testsupport.NewNamespaceLister(t, nsB, nsA)}

	snap, err := builder.Build(context.Background(), "")
	if err != nil {
		t.Fatalf("build failed: %v", err)
	}

	payload, ok := snap.Payload.(NamespaceSnapshot)
	if !ok {
		t.Fatalf("unexpected payload type: %T", snap.Payload)
	}

	if len(payload.Namespaces) != 2 {
		t.Fatalf("expected 2 namespaces, got %d", len(payload.Namespaces))
	}

	if payload.Namespaces[0].Name != "alpha" || payload.Namespaces[1].Name != "beta" {
		t.Fatalf("expected namespaces sorted by name, got %v", []string{payload.Namespaces[0].Name, payload.Namespaces[1].Name})
	}

	for _, ns := range payload.Namespaces {
		if ns.WorkloadsUnknown {
			t.Fatalf("expected workloads unknown to be false for namespace %s", ns.Name)
		}
	}
}

func TestNamespaceBuilderUsesTrackerWhenKnown(t *testing.T) {
	tracker := newNamespaceWorkloadTracker()
	tracker.synced.Store(true)

	tracker.handleAdd(&appsv1.Deployment{ObjectMeta: metav1.ObjectMeta{Namespace: "alpha", Name: "web"}}, resourceDeployment)

	ns := &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "alpha", ResourceVersion: "100"}}

	builder := &NamespaceBuilder{
		namespaces: testsupport.NewNamespaceLister(t, ns),
		tracker:    tracker,
	}

	snap, err := builder.Build(context.Background(), "")
	if err != nil {
		t.Fatalf("build failed: %v", err)
	}

	payload, ok := snap.Payload.(NamespaceSnapshot)
	if !ok {
		t.Fatalf("unexpected payload type: %T", snap.Payload)
	}
	if len(payload.Namespaces) != 1 {
		t.Fatalf("expected one namespace, got %d", len(payload.Namespaces))
	}

	summary := payload.Namespaces[0]
	if !summary.HasWorkloads {
		t.Fatalf("expected HasWorkloads true from tracker")
	}
	if summary.WorkloadsUnknown {
		t.Fatalf("expected WorkloadsUnknown false when tracker has data")
	}
}

func TestNamespaceBuilderFallsBackWhenTrackerUnknown(t *testing.T) {
	tracker := newNamespaceWorkloadTracker()
	tracker.synced.Store(true)
	tracker.MarkUnknown("alpha")

	ns := &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: "alpha", ResourceVersion: "1", CreationTimestamp: metav1.NewTime(time.Unix(0, 0))}}
	deployment := &appsv1.Deployment{ObjectMeta: metav1.ObjectMeta{Namespace: "alpha", Name: "web"}}

	builder := &NamespaceBuilder{
		namespaces:  testsupport.NewNamespaceLister(t, ns),
		deployments: testsupport.NewDeploymentLister(t, deployment),
		tracker:     tracker,
	}

	snap, err := builder.Build(context.Background(), "")
	if err != nil {
		t.Fatalf("build failed: %v", err)
	}

	payload, ok := snap.Payload.(NamespaceSnapshot)
	if !ok {
		t.Fatalf("unexpected payload type: %T", snap.Payload)
	}
	if len(payload.Namespaces) != 1 {
		t.Fatalf("expected one namespace, got %d", len(payload.Namespaces))
	}

	summary := payload.Namespaces[0]
	if !summary.HasWorkloads {
		t.Fatalf("expected HasWorkloads true from legacy fallback")
	}
	if !summary.WorkloadsUnknown {
		t.Fatalf("expected WorkloadsUnknown true when fallback used")
	}
}
