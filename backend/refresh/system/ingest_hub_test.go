package system

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
)

// Starting the hub launches the owned reflectors and returns without waiting
// for them: domains wait on the resources they declare.
func TestIngestHubStartLaunchesTheReflectorsWithoutWaiting(t *testing.T) {
	manager := &recordingHubManager{started: make(chan struct{})}
	hub := newIngestHub(manager)

	require.NoError(t, hub.Start(context.Background()))
	select {
	case <-manager.started:
	case <-time.After(time.Second):
		t.Fatal("hub Start did not launch the reflectors")
	}
	require.NoError(t, hub.Shutdown())
}

// The health endpoint reports the owned reflectors: not synced until every
// tracked store has settled.
func TestIngestHubHealthTracksTheOwnedReflectors(t *testing.T) {
	manager := &recordingHubManager{started: make(chan struct{})}
	hub := newIngestHub(manager)
	require.False(t, hub.HasSynced(context.Background()))

	manager.hasSynced = true
	require.True(t, hub.HasSynced(context.Background()))
	require.False(t, newIngestHub(nil).HasSynced(context.Background()), "no reflectors means no data")
}

func TestIngestHubRoutesPerResourceDataReadiness(t *testing.T) {
	const configMapsKey = "core/configmaps"
	manager := &recordingHubManager{
		started:   make(chan struct{}),
		readiness: refresh.ResourceReadinessDegraded,
	}
	hub := newIngestHub(manager)

	require.Equal(t, refresh.ResourceReadinessDegraded, hub.ResourceReadiness([]string{configMapsKey})[configMapsKey])
	require.Equal(t, refresh.ResourceReadinessUnavailable, newIngestHub(nil).ResourceReadiness([]string{configMapsKey})[configMapsKey])
	require.Equal(t, refresh.ResourceReadinessUnknown, hub.ResourceReadiness([]string{"unknown.example.com/unknowns"})["unknown.example.com/unknowns"],
		"no owned reflector feeds the key, so the hub has no readiness detail")
}

func TestIngestHubRoutesSettlementAndReadinessByResourceIdentity(t *testing.T) {
	configMaps := schema.GroupVersionResource{Version: "v1", Resource: "configmaps"}
	deployments := schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"}
	manager := &recordingHubManager{
		stores: map[schema.GroupVersionResource]*ingest.ProjectingStore{
			configMaps: {}, deployments: {},
		},
		synced: map[schema.GroupVersionResource]bool{configMaps: true},
		readinessByGVR: map[schema.GroupVersionResource]refresh.ResourceReadiness{
			configMaps:  refresh.ResourceReadinessReady,
			deployments: refresh.ResourceReadinessPending,
		},
	}
	hub := newIngestHub(manager)
	for _, tc := range []struct {
		name    string
		keys    []string
		settled bool
	}{
		{name: "empty request", settled: true},
		{name: "synced owned resource", keys: []string{"core/configmaps"}, settled: true},
		{name: "warming owned resource", keys: []string{"core/configmaps", "apps/deployments"}},
		{name: "skipped owned resource", keys: []string{"core/secrets"}, settled: true},
		{name: "unknown resource", keys: []string{"example.com/widgets"}, settled: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			require.Equal(t, tc.settled, hub.ResourcesSettled(tc.keys))
		})
	}
	require.Equal(t, map[string]refresh.ResourceReadiness{
		"core/configmaps":  refresh.ResourceReadinessReady,
		"apps/deployments": refresh.ResourceReadinessPending,
	}, hub.ResourceReadiness([]string{"core/configmaps", "apps/deployments"}))
}

type recordingHubManager struct {
	started        chan struct{}
	hasSynced      bool
	readiness      refresh.ResourceReadiness
	stores         map[schema.GroupVersionResource]*ingest.ProjectingStore
	synced         map[schema.GroupVersionResource]bool
	readinessByGVR map[schema.GroupVersionResource]refresh.ResourceReadiness
}

func (m *recordingHubManager) Start(context.Context) { close(m.started) }

func (m *recordingHubManager) Stop() {}

func (m *recordingHubManager) HasSynced() bool { return m.hasSynced }

func (m *recordingHubManager) StoreFor(gvr schema.GroupVersionResource) *ingest.ProjectingStore {
	return m.stores[gvr]
}

func (m *recordingHubManager) HasSyncedFor(gvr schema.GroupVersionResource) bool {
	return m.synced[gvr]
}

func (m *recordingHubManager) ResourceReadinessFor(gvr schema.GroupVersionResource) refresh.ResourceReadiness {
	if readiness, ok := m.readinessByGVR[gvr]; ok {
		return readiness
	}
	return m.readiness
}
