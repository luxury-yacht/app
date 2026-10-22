package system

import (
	"context"
	"slices"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"

	"github.com/luxury-yacht/app/backend/refresh/permissions"
	"github.com/luxury-yacht/app/backend/refresh/resourcestream"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
)

var namespaceGVR = corev1.SchemeGroupVersion.WithResource("namespaces")

func namespaceObject(name, rv string) *corev1.Namespace {
	return &corev1.Namespace{ObjectMeta: metav1.ObjectMeta{Name: name, ResourceVersion: rv, UID: types.UID("uid-" + name)}}
}

// namespaceNames reads the namespaces domain's rows.
func namespaceNames(t *testing.T, h *ingestHarness) []string {
	t.Helper()
	snap, err := h.subsystem.SnapshotService.Build(context.Background(), "namespaces", "c1|")
	require.NoError(t, err)
	payload, ok := snap.Payload.(snapshot.NamespaceSnapshot)
	require.True(t, ok, "payload %T", snap.Payload)
	names := make([]string, 0, len(payload.Namespaces))
	for _, row := range payload.Namespaces {
		names = append(names, row.Ref.Name)
	}
	slices.Sort(names)
	return names
}

// awaitNamespaces reads the namespaces domain after each ring until a read
// serves want.
func awaitNamespaces(t *testing.T, h *ingestHarness, sub *resourcestream.Subscription, want []string) {
	t.Helper()
	deadline := time.After(10 * time.Second)
	var last []string
	for {
		select {
		case <-sub.Updates:
			last = namespaceNames(t, h)
			if slices.Equal(last, want) {
				return
			}
		case <-deadline:
			t.Fatalf("namespaces: no ring was followed by a read serving %v (last read %v)", want, last)
		}
	}
}

// A namespace written to its ingest store rings the namespaces domain, and the
// read the ring triggers shows the namespace; so does its deletion.
func TestNamespaceIngestRingsTheNamespacesDomain(t *testing.T) {
	h := newIngestHarness(t)
	store := h.store(t, namespaceGVR)
	sub := h.subscribe(t, "namespaces", "")

	require.NoError(t, store.Add(namespaceObject("team-a", "1")))
	awaitNamespaces(t, h, sub, []string{"team-a"})

	require.NoError(t, store.Delete(namespaceObject("team-a", "1")))
	awaitNamespaces(t, h, sub, []string{})
}

// The namespaces and cluster-overview domains gate on core/namespaces, which
// is served by the owned namespace reflector.
func TestNamespaceReadinessRoutesToIngest(t *testing.T) {
	h := newIngestHarness(t)
	key := permissions.ResourceKey("", "namespaces")
	hub := newIngestHub(h.subsystem.IngestManager)
	require.Contains(t, hub.ownedResources, key)
	readiness := domainReadinessResources(domainRegistrations(context.Background(), registrationDeps{cfg: Config{}}))
	require.Contains(t, readiness["namespaces"], key)
	require.Contains(t, readiness["cluster-overview"], key)
}

// The namespace reflector feeds the namespaces domain from the API.
func TestNamespaceReflectorFeedsTheNamespacesDomain(t *testing.T) {
	server := newReflectorAPIServer(t)
	h := newReflectorHarness(t, server, "")
	sub := h.subscribe(t, "namespaces", "")

	server.Create(t, namespaceObject("team-a", ""))
	awaitNamespaces(t, h.ingestHarness(), sub, []string{"team-a"})
}

// A re-warm resumes the namespace watch with no changes and serves the
// restored namespaces.
func TestNamespacesSurviveARewarmWithoutNamespaceChanges(t *testing.T) {
	server := newReflectorAPIServer(t)
	server.Create(t, namespaceObject("team-a", ""))
	before := newReflectorHarness(t, server, "")
	require.Eventually(t, func() bool { return len(namespaceNames(t, before.ingestHarness())) == 1 }, 5*time.Second, 10*time.Millisecond)
	spill := t.TempDir()
	require.NoError(t, before.subsystem.IngestManager.SpillStores(spill))
	before.stop()

	after := newReflectorHarness(t, server, spill)
	require.Equal(t, []string{"team-a"}, namespaceNames(t, after.ingestHarness()))
}
