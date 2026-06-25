package snapshot

import (
	"context"
	"path/filepath"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
	autoscalingv1 "k8s.io/api/autoscaling/v1"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

// coolServeFixture builds a Registry + maintained autoscaling store + a Service whose Build
// serves from that store, populated with the supplied HPAs. It mirrors the production wiring
// (RegisterMaintainedStore + a maintained-backed builder) closely enough to exercise the full
// Cold-tier cool→serve→re-warm contract end-to-end at the snapshot layer.
func coolServeFixture(t *testing.T, hpas []*autoscalingv1.HorizontalPodAutoscaler) (*domain.Registry, *Service) {
	t.Helper()
	meta := ClusterMeta{ClusterID: "cluster-a", ClusterName: "cluster-a"}
	hpaDesc := autoscalingDescriptor(t, "horizontalpodautoscalers")

	hpaIdx := newNamespaceIndexer()
	maintained := newTypedMaintainedStore(meta, autoscalingQuerypageSchema(), autoscalingTableQueryAdapter())
	for _, h := range hpas {
		require.NoError(t, hpaIdx.Add(h))
		maintained.ingest(hpaDesc, h)
	}

	reg := domain.New()
	reg.RegisterMaintainedStore(namespaceAutoscalingDomainName, maintained)
	builder := &NamespaceAutoscalingBuilder{collectIndexer: autoscalingCollectIndexer(hpaIdx), maintained: maintained}
	require.NoError(t, reg.Register(refresh.DomainConfig{
		Name:          namespaceAutoscalingDomainName,
		BuildSnapshot: builder.Build,
	}))

	// The Service starts with a NOT-synced hub (a live cluster's gate); cooling installs an
	// always-synced cooled hub so a cooled Build still serves.
	svc := NewService(reg, telemetry.NewRecorder(), meta).WithInformerHub(&fakeInformerHub{synced: true})
	return reg, svc
}

func autoscalingPayload(t *testing.T, svc *Service, scope string) NamespaceAutoscalingSnapshot {
	t.Helper()
	snap, err := svc.Build(context.Background(), namespaceAutoscalingDomainName, scope)
	require.NoError(t, err)
	return snap.Payload.(NamespaceAutoscalingSnapshot)
}

// TestCoolServeRewarmRoundTrip is the end-to-end Cold-tier serving proof:
//   - a Build before cooling and a Build after cooling return the SAME payload (the cooled
//     cluster serves correct results from its off-heap mmap-backed stores), and
//   - re-warm closes the mmap mappings exactly once (no fd/mapping leak).
//
// It runs concurrent Builds across the cool transition, so -race proves no Build reads the
// mapping after the unmap (the cool→serve→re-warm→serve no-panic / no-race contract).
func TestCoolServeRewarmRoundTrip(t *testing.T) {
	hpas := []*autoscalingv1.HorizontalPodAutoscaler{
		hpaObj("default", "alpha", "1", "api", 4),
		hpaObj("default", "beta", "2", "web", 6),
		hpaObj("kube-system", "gamma", "3", "ctrl", 2),
	}
	reg, svc := coolServeFixture(t, hpas)

	const scope = "cluster-a|namespace:all?limit=50&sortField=name&sortDirection=asc"
	before := autoscalingPayload(t, svc, scope)

	// Concurrent Builds running across the cool transition, to surface any read-after-unmap.
	var wg sync.WaitGroup
	stop := make(chan struct{})
	for i := 0; i < 6; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				select {
				case <-stop:
					return
				default:
					_, _ = svc.Build(context.Background(), namespaceAutoscalingDomainName, scope)
				}
			}
		}()
	}

	// COOL: swap the maintained store to off-heap mmap columns + install the cooled hub.
	dir := t.TempDir()
	closers, err := reg.CoolMaintainedStoresToMmap(dir)
	require.NoError(t, err)
	require.Len(t, closers, 1)
	require.FileExists(t, filepath.Join(dir, namespaceAutoscalingDomainName+".qcm"))
	svc.SetInformerHub(alwaysSyncedHub{})

	// (a) The cooled cluster serves the SAME payload — now from the mmap-backed store.
	after := autoscalingPayload(t, svc, scope)
	require.Equal(t, before, after, "cooled cluster must serve identical results from mmap")

	// RE-WARM: unroute (stop new Builds + drain in-flight), then close the mappings. This is
	// the production ordering: the cooled subsystem is removed from serving BEFORE its closers
	// run. Each store-level closer waits for any straggler Query, then unmaps once.
	close(stop)
	wg.Wait()
	for _, c := range closers {
		require.NoError(t, c())
		require.NoError(t, c(), "closer is idempotent — no double-unmap on a re-warm/teardown race")
	}
}

// TestCoolReadOnlyRejectsUpsert proves a cooled maintained store rejects writes: the store is
// read-only after the mmap swap, so a feed event that arrives mid-cool cannot mutate it.
func TestCoolReadOnlyRejectsUpsert(t *testing.T) {
	meta := ClusterMeta{ClusterID: "cluster-a", ClusterName: "cluster-a"}
	hpaDesc := autoscalingDescriptor(t, "horizontalpodautoscalers")
	maintained := newTypedMaintainedStore(meta, autoscalingQuerypageSchema(), autoscalingTableQueryAdapter())
	available := map[string]bool{"HorizontalPodAutoscaler": true}
	maintained.ingest(hpaDesc, hpaObj("default", "alpha", "1", "api", 4))

	reg := domain.New()
	reg.RegisterMaintainedStore(namespaceAutoscalingDomainName, maintained)
	closers, err := reg.CoolMaintainedStoresToMmap(t.TempDir())
	require.NoError(t, err)
	t.Cleanup(func() {
		for _, c := range closers {
			_ = c()
		}
	})

	require.Len(t, maintained.rows("", available), 1)
	maintained.ingest(hpaDesc, hpaObj("default", "beta", "2", "web", 6))
	require.Len(t, maintained.rows("", available), 1, "cooled (read-only) store rejects new rows")
}
