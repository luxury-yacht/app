package ingest

import (
	"net/http/httptest"
	"sync"
	"testing"
	"time"
)

// managerCallbackBundleSink mirrors the pods live-stream notify sink
// (resourcestream.podNotifyBundleSink): during delivery — which the store performs
// while holding its write lock — it calls back into the MANAGER to read another
// kind's rows (lookupWorkloadRef → IngestManager.Rows). The Sink/BundleSink contract
// only forbids calling back into the same store, so this callback is legal and the
// manager lock must never be held while acquiring a store lock.
type managerCallbackBundleSink struct {
	entered chan struct{}
	release chan struct{}
	rows    func()
	once    sync.Once
}

func (s *managerCallbackBundleSink) UpsertBundle(Bundle) {
	s.once.Do(func() {
		close(s.entered)
		<-s.release
		s.rows()
	})
}

func (s *managerCallbackBundleSink) DeleteBundle(Bundle) {}

type noopTableSink struct{}

func (noopTableSink) Upsert(interface{}) {}
func (noopTableSink) Delete(interface{}) {}

type noopBundleSink struct{}

func (noopBundleSink) UpsertBundle(Bundle) {}
func (noopBundleSink) DeleteBundle(Bundle) {}

// TestSinkRegistrationDoesNotDeadlockWithSinkManagerCallback is the regression for the
// production wedge captured in goroutines-20260701-152259.862: the pods reflector's
// initial Replace held the store write lock while its bundle sink called back into the
// manager (wants m.mu), while the catalog's registerIngestCatalogSinks held m.mu inside
// IngestManager.AddCatalogSink waiting for that same store lock — an ABBA deadlock that
// froze the namespace domain, every cut-kind table, and the catalog resync loop
// ("cluster never loads"). Each Add*Sink wrapper must resolve the entry under the
// manager lock but call the store OUTSIDE it.
func TestSinkRegistrationDoesNotDeadlockWithSinkManagerCallback(t *testing.T) {
	cases := []struct {
		name     string
		register func(m *IngestManager) bool
	}{
		{"AddSink", func(m *IngestManager) bool { return m.AddSink(configMapGVR, noopTableSink{}) }},
		{"AddBundleSink", func(m *IngestManager) bool { return m.AddBundleSink(configMapGVR, noopBundleSink{}) }},
		{"AddCatalogSink", func(m *IngestManager) bool { return m.AddCatalogSink(configMapGVR, noopTableSink{}) }},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			server := newTrackerAPIServer(t)
			httpSrv := httptest.NewServer(server)
			defer httpSrv.Close()
			kube := newKubeClientFor(t, httpSrv)

			// No Start: entries + stores exist from construction, no reflectors run,
			// so the test drives the store's Replace deterministically.
			mgr := NewIngestManager(testMeta, kube, nil, nil)
			store := mgr.StoreFor(configMapGVR)
			if store == nil {
				t.Fatal("no store for configmaps")
			}

			entered := make(chan struct{})
			release := make(chan struct{})
			parked := &managerCallbackBundleSink{
				entered: entered,
				release: release,
				rows:    func() { mgr.Rows(roleGVR) },
			}
			if !mgr.AddBundleSink(configMapGVR, parked) {
				t.Fatal("registering the callback bundle sink")
			}

			replaceDone := make(chan struct{})
			go func() {
				defer close(replaceDone)
				// Replace delivers to bundle sinks under the store write lock,
				// exactly as the reflector's initial relist does.
				if err := store.Replace([]interface{}{newCM("default", "cm-a")}, "1"); err != nil {
					t.Errorf("Replace: %v", err)
				}
			}()

			// Replace now holds the store write lock, parked inside the sink.
			<-entered

			registerDone := make(chan struct{})
			go func() {
				defer close(registerDone)
				if !tc.register(mgr) {
					t.Errorf("%s reported no entry for configmaps", tc.name)
				}
			}()

			// Let the registration commit to the store lock while (with the bug)
			// holding the manager lock; the fixed code passes regardless of timing.
			time.Sleep(100 * time.Millisecond)
			close(release)

			for name, ch := range map[string]chan struct{}{
				"Replace":           replaceDone,
				"sink registration": registerDone,
			} {
				select {
				case <-ch:
				case <-time.After(5 * time.Second):
					t.Fatalf("%s did not complete: ABBA deadlock between the manager lock and the store lock", name)
				}
			}
		})
	}
}
