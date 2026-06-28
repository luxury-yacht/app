/*
 * backend/objectcatalog/streaming.go
 *
 * Catalog streaming implementation.
 */

package objectcatalog

import (
	"sync"
	"time"
)

// StreamingUpdate represents a catalog streaming signal.
type StreamingUpdate struct {
	Ready bool
}

type streamingAggregator struct {
	service      *Service            // service is the catalog service associated with this aggregator.
	mu           sync.Mutex          // mu protects access to the aggregator's state.
	chunks       []*summaryChunk     // chunks holds the summary chunks collected by the aggregator.
	kindSet      map[string]bool     // kindSet tracks the kinds present in the aggregator (value = namespaced).
	namespaceSet map[string]struct{} // namespaceSet tracks the namespaces present in the aggregator.
	start        time.Time           // start is the time when the aggregator was created.
	firstFlush   time.Time           // firstFlush is the time when the first flush occurred.
}

func newStreamingAggregator(s *Service) *streamingAggregator {
	return &streamingAggregator{
		service:      s,                         // service is the catalog service associated with this aggregator.
		chunks:       make([]*summaryChunk, 0),  // chunks holds the summary chunks collected by the aggregator.
		kindSet:      make(map[string]bool),     // kindSet tracks the kinds present in the aggregator (value = namespaced).
		namespaceSet: make(map[string]struct{}), // namespaceSet tracks the namespaces present in the aggregator.
		start:        s.now(),                   // start is the time when the aggregator was created.
	}
}

// emit adds a batch of summaries to the aggregator.
func (a *streamingAggregator) emit(_ int, items []Summary) {
	if a == nil || len(items) == 0 {
		return
	}
	chunkCopy := make([]Summary, len(items))
	copy(chunkCopy, items)
	sortSummaries(chunkCopy)

	a.mu.Lock()
	chunk := &summaryChunk{items: make([]Summary, len(chunkCopy))}
	copy(chunk.items, chunkCopy)
	a.chunks = append(a.chunks, chunk)
	for _, summary := range chunkCopy {
		if summary.Kind != "" {
			// Track whether the kind is namespaced (Scope == ScopeNamespace)
			a.kindSet[summary.Kind] = summary.Scope == ScopeNamespace
		}
		if summary.Namespace != "" {
			a.namespaceSet[summary.Namespace] = struct{}{}
		}
	}
	kindSnapshot := cloneKindSet(a.kindSet)
	namespaceSnapshot := cloneSet(a.namespaceSet)
	if a.firstFlush.IsZero() {
		a.firstFlush = a.service.now()
	}
	a.mu.Unlock()

	// Publish only this chunk's items, upserting them into the maintained store, rather than
	// rebuilding the store from every chunk emitted so far. Concurrent collectors each emit
	// here; the incremental upsert is order-independent, and the sync resets the store once at
	// start (Service.sync) so the streaming view holds only the in-progress sync's data.
	a.service.streamChunk(chunkCopy, kindSnapshot, namespaceSnapshot)
	if a.service != nil {
		a.service.broadcastStreaming(false)
	}
}

// cloneChunksLocked snapshots the aggregator's chunk list. Chunks are
// immutable once appended (their items are never mutated after creation), so
// only the pointer slice is copied — deep-copying every item made each emit
// cost O(total items), quadratic across an initial sync.
func (a *streamingAggregator) cloneChunksLocked() []*summaryChunk {
	if len(a.chunks) == 0 {
		return nil
	}
	result := make([]*summaryChunk, len(a.chunks))
	copy(result, a.chunks)
	return result
}

// firstFlushLatency returns the duration between the aggregator's creation and its first flush.
func (a *streamingAggregator) firstFlushLatency() time.Duration {
	if a == nil || a.firstFlush.IsZero() || a.start.IsZero() {
		return 0
	}
	return a.firstFlush.Sub(a.start)
}

// finalize publishes the final state of the aggregator.
func (a *streamingAggregator) finalize(descriptors []Descriptor, ready bool) {
	if a == nil {
		return
	}
	a.mu.Lock()
	chunks := a.cloneChunksLocked()
	kindSnapshot := cloneKindSet(a.kindSet)
	namespaceSnapshot := cloneSet(a.namespaceSet)
	a.mu.Unlock()
	a.service.publishStreamingState(chunks, kindSnapshot, namespaceSnapshot, descriptors, ready)
	if a.service != nil {
		a.service.broadcastStreaming(ready)
	}
}

// emitSummaries adds a batch of summaries to the aggregator.
func emitSummaries(index int, agg *streamingAggregator, summaries []Summary, err error, handled bool) ([]Summary, bool, error) {
	if handled && agg != nil && err == nil && len(summaries) > 0 {
		agg.emit(index, summaries)
	}
	return summaries, handled, err
}

// SubscribeStreaming registers for catalog streaming updates.
func (s *Service) SubscribeStreaming() (<-chan StreamingUpdate, func()) {
	ch := make(chan StreamingUpdate, 16)
	s.streamSubMu.Lock()
	id := s.nextStreamSubID
	s.nextStreamSubID++
	if s.streamSubscribers == nil {
		s.streamSubscribers = make(map[int]chan StreamingUpdate)
	}
	s.streamSubscribers[id] = ch
	s.streamSubMu.Unlock()

	unsubscribe := func() {
		s.streamSubMu.Lock()
		if subscriber, ok := s.streamSubscribers[id]; ok {
			delete(s.streamSubscribers, id)
			close(subscriber)
		}
		s.streamSubMu.Unlock()
	}

	ready := s.CachesReady()
	select {
	case ch <- StreamingUpdate{Ready: ready}:
	default:
	}

	return ch, unsubscribe
}

// broadcastStreaming sends a streaming update to all subscribers.
func (s *Service) broadcastStreaming(ready bool) {
	s.streamSubMu.Lock()
	defer s.streamSubMu.Unlock()
	for _, ch := range s.streamSubscribers {
		update := StreamingUpdate{Ready: ready}
		if ready {
			// Clear any buffered signals so the readiness update is delivered.
			for {
				select {
				case <-ch:
					continue
				default:
				}
				break
			}
			select {
			case ch <- update:
			default:
				// Fallback: drop stale update and retry once.
				select {
				case <-ch:
				default:
				}
				select {
				case ch <- update:
				default:
					// Give up if subscriber is no longer consuming.
				}
			}
			continue
		}
		select {
		case ch <- update:
		default:
			// Drop update for slow subscriber.
		}
	}
}

// CachesReady reports whether the streaming caches are fully synchronised.
func (s *Service) CachesReady() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.catalogIndex.cachesAreReady()
}

// streamChunk publishes one streaming chunk incrementally: it upserts the chunk's items into
// the maintained query store under the service write lock and refreshes the kind/namespace
// facet snapshots. It is O(chunk) per call — see catalogIndex.appendStreamingChunk for why the
// previous per-emit wholesale rebuild was O(N²) across a sync.
func (s *Service) streamChunk(items []Summary, kindSet map[string]bool, namespaceSet map[string]struct{}) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.catalogIndex.appendStreamingChunk(items, kindSet, namespaceSet)
}

// publishStreamingState updates the streaming state in the service.
func (s *Service) publishStreamingState(
	chunks []*summaryChunk,
	kindSet map[string]bool,
	namespaceSet map[string]struct{},
	descriptors []Descriptor,
	ready bool,
) {
	chunkSnapshot := make([]*summaryChunk, len(chunks))
	copy(chunkSnapshot, chunks)

	s.mu.Lock()
	s.catalogIndex.publishStreamingState(chunkSnapshot, kindSet, namespaceSet, descriptors, ready)
	s.mu.Unlock()
}

// setFirstBatchLatency records the time-to-first-batch measurement.
func (s *Service) setFirstBatchLatency(latency time.Duration) {
	s.mu.Lock()
	s.catalogIndex.setFirstBatchLatency(latency)
	s.mu.Unlock()
}

// FirstBatchLatency returns the most recent time-to-first-batch measurement.
func (s *Service) FirstBatchLatency() time.Duration {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.catalogIndex.firstBatchLatency()
}
