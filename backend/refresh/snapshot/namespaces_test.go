package snapshot

import (
	"context"
	"testing"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"

	"github.com/luxury-yacht/app/backend/testsupport"
	"github.com/stretchr/testify/require"
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
		if ns.StatusState == "" || ns.StatusPresentation == "" {
			t.Fatalf("expected namespace status projection for %s, got state=%q presentation=%q", ns.Name, ns.StatusState, ns.StatusPresentation)
		}
	}
}

func TestNamespaceBuilderScopePayloadIdentityAndCatalogProjectionContract(t *testing.T) {
	created := time.Unix(1700000000, 0).UTC()
	nsAlpha := &corev1.Namespace{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "alpha",
			UID:               types.UID("namespace-alpha"),
			ResourceVersion:   "42",
			CreationTimestamp: metav1.NewTime(created),
		},
		Status: corev1.NamespaceStatus{Phase: corev1.NamespaceActive},
	}
	nsBeta := &corev1.Namespace{
		ObjectMeta: metav1.ObjectMeta{Name: "beta", ResourceVersion: "43"},
	}
	builder := &NamespaceBuilder{namespaces: testsupport.NewNamespaceLister(t, nsAlpha, nsBeta)}
	ctx := WithClusterMeta(context.Background(), ClusterMeta{
		ClusterID:   "cluster-a",
		ClusterName: "prod",
	})

	snap, err := builder.Build(ctx, "cluster-a|alpha")
	require.NoError(t, err)
	require.Equal(t, "namespaces", snap.Domain)
	require.Equal(t, "cluster-a|alpha", snap.Scope)
	require.Equal(t, uint64(42), snap.Version)
	require.Equal(t, 1, snap.Stats.ItemCount)

	payload, ok := snap.Payload.(NamespaceSnapshot)
	require.True(t, ok)
	require.Equal(t, "cluster-a", payload.ClusterID)
	require.Equal(t, "prod", payload.ClusterName)
	require.Len(t, payload.Namespaces, 1)

	summary := payload.Namespaces[0]
	require.Equal(t, "cluster-a", summary.ClusterID)
	require.Equal(t, "prod", summary.ClusterName)
	require.Equal(t, "alpha", summary.Name)
	require.Equal(t, "Active", summary.Phase)
	require.Equal(t, "42", summary.ResourceVersion)
	require.Equal(t, created.Unix(), summary.CreationUnix)
	require.Equal(t, "ready", summary.StatusPresentation)

	require.Equal(t, "cluster-a", summary.Ref.ClusterID)
	require.Equal(t, "", summary.Ref.Group)
	require.Equal(t, "v1", summary.Ref.Version)
	require.Equal(t, "Namespace", summary.Ref.Kind)
	require.Equal(t, "namespaces", summary.Ref.Resource)
	require.Equal(t, "", summary.Ref.Namespace)
	require.Equal(t, "alpha", summary.Ref.Name)
	require.Equal(t, "namespace-alpha", summary.Ref.UID)
}

func TestNamespaceBuilderUsesTrackerWhenKnown(t *testing.T) {
	tracker := newNamespaceWorkloadTracker()
	tracker.synced.Store(true)

	tracker.handleAdd(&appsv1.Deployment{ObjectMeta: metav1.ObjectMeta{Namespace: "alpha", Name: "web"}}, resourceDeployment)

	ns := &corev1.Namespace{
		ObjectMeta: metav1.ObjectMeta{Name: "alpha", ResourceVersion: "100"},
		Status:     corev1.NamespaceStatus{Phase: corev1.NamespaceActive},
	}

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
	if summary.Status != "Active" || summary.StatusState != "Active" || summary.StatusPresentation != "ready" {
		t.Fatalf("expected shared namespace status projection, got %#v", summary)
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
