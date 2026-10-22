/*
 * backend/objectcatalog/watch_test.go
 *
 * Verifies the catalog notifier's lifecycle and test fixtures shared by the
 * catalog tests.
 */

package objectcatalog

import (
	"context"
	"testing"
	"time"
)

type recordingWatchLogger struct {
	warnings []string
}

func (l *recordingWatchLogger) Debug(string, ...string) {}
func (l *recordingWatchLogger) Info(string, ...string)  {}
func (l *recordingWatchLogger) Error(string, ...string) {}

func (l *recordingWatchLogger) Warn(msg string, _ ...string) {
	l.warnings = append(l.warnings, msg)
}

func newTestWatchService() *Service {
	return &Service{
		now:               time.Now,
		catalogIndex:      newCatalogIndex(),
		streamSubscribers: make(map[int]chan StreamingUpdate),
		health:            healthStatus{State: HealthStateUnknown},
		doneCh:            make(chan struct{}),
		clusterID:         "test-cluster",
	}
}

func testDeploymentDescriptor() Descriptor {
	return Descriptor{

		Namespaced: true,
		Kind:       "Deployment",
		Group:      "apps",
		Version:    "v1",
		Resource:   "deployments",
		Scope:      ScopeNamespace,
	}
}

func registerDesc(svc *Service, desc Descriptor) {
	svc.resources[desc.GVR().String()] = desc
}

func TestWatchNotifierStopsOnContextCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	notifier := newWatchNotifier(newTestWatchService())

	done := make(chan struct{})
	go func() { notifier.run(ctx); close(done) }()

	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("run() did not exit")
	}
}

func TestReactiveUpdatesDisabledByFlag(t *testing.T) {
	svc := NewService(Dependencies{Now: time.Now}, &Options{EnableReactiveUpdates: false})
	if svc.opts.EnableReactiveUpdates {
		t.Fatal("expected false when explicitly disabled")
	}
	svc2 := NewService(Dependencies{Now: time.Now}, nil)
	if !svc2.opts.EnableReactiveUpdates {
		t.Fatal("expected true by default")
	}
}
