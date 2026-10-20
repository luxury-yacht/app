package snapshot

import (
	"sync"
	"time"

	"github.com/luxury-yacht/app/backend/refresh/doorbell"
)

// recordingBell is a real generation that records each change it rings, so
// producer tests observe what a producer rang and when.
type recordingBell struct {
	doorbell.Generation
	mu      sync.Mutex
	changes []doorbell.Change
	rung    chan doorbell.Change
}

func newRecordingBell() *recordingBell {
	return &recordingBell{rung: make(chan doorbell.Change, 256)}
}

func (b *recordingBell) Ring(change doorbell.Change) {
	b.Run(func() {
		b.mu.Lock()
		b.changes = append(b.changes, change)
		b.mu.Unlock()
		select {
		case b.rung <- change:
		default:
		}
	})
}

func (b *recordingBell) Changes() []doorbell.Change {
	b.mu.Lock()
	defer b.mu.Unlock()
	return append([]doorbell.Change(nil), b.changes...)
}

func newTestAttentionIndex(meta ClusterMeta, now func() time.Time) *clusterAttentionIndex {
	return newClusterAttentionIndex(meta, now, newRecordingBell())
}

// stopForTest stops the index's test generation, cancelling its timers.
func (i *clusterAttentionIndex) stopForTest() {
	if bell, ok := i.bell.(*recordingBell); ok {
		bell.Stop()
	}
}

// unpublishedSink feeds a maintained store from one source with no doorbell,
// for store-maintenance tests that only check rows.
func unpublishedSink[T any](m *typedMaintainedStore[T], kind string) *maintainedStoreSink[T] {
	return m.sinkFor(kind, rowPublication[T]{})
}
