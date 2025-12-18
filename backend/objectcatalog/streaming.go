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
	service      *Service
	mu           sync.Mutex
	chunks       []*summaryChunk
	kindSet      map[string]struct{}
	namespaceSet map[string]struct{}
	start        time.Time
	firstFlush   time.Time
}

func newStreamingAggregator(s *Service) *streamingAggregator {
	return &streamingAggregator{
		service:      s,
		chunks:       make([]*summaryChunk, 0),
		kindSet:      make(map[string]struct{}),
		namespaceSet: make(map[string]struct{}),
		start:        s.now(),
	}
}

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
			a.kindSet[summary.Kind] = struct{}{}
		}
		if summary.Namespace != "" {
			a.namespaceSet[summary.Namespace] = struct{}{}
		}
	}
	chunksSnapshot := a.cloneChunksLocked()
	kindSnapshot := cloneSet(a.kindSet)
	namespaceSnapshot := cloneSet(a.namespaceSet)
	if a.firstFlush.IsZero() {
		a.firstFlush = a.service.now()
	}
	a.mu.Unlock()

	a.service.publishStreamingState(chunksSnapshot, kindSnapshot, namespaceSnapshot, nil, false)
	if a.service != nil {
		a.service.broadcastStreaming(false)
	}
}

func (a *streamingAggregator) complete(_ int) {
	if a == nil {
		return
	}
}

func (a *streamingAggregator) cloneChunksLocked() []*summaryChunk {
	if len(a.chunks) == 0 {
		return nil
	}
	result := make([]*summaryChunk, len(a.chunks))
	for i, chunk := range a.chunks {
		items := make([]Summary, len(chunk.items))
		copy(items, chunk.items)
		result[i] = &summaryChunk{items: items}
	}
	return result
}

func (a *streamingAggregator) firstFlushLatency() time.Duration {
	if a == nil || a.firstFlush.IsZero() || a.start.IsZero() {
		return 0
	}
	return a.firstFlush.Sub(a.start)
}

func (a *streamingAggregator) finalize(descriptors []Descriptor, ready bool) {
	if a == nil {
		return
	}
	a.mu.Lock()
	chunks := a.cloneChunksLocked()
	kindSnapshot := cloneSet(a.kindSet)
	namespaceSnapshot := cloneSet(a.namespaceSet)
	a.mu.Unlock()
	a.service.publishStreamingState(chunks, kindSnapshot, namespaceSnapshot, descriptors, ready)
	if a.service != nil {
		a.service.broadcastStreaming(ready)
	}
}

func emitSummaries(index int, agg *streamingAggregator, summaries []Summary, err error, handled bool) ([]Summary, bool, error) {
	if handled && agg != nil && err == nil {
		if len(summaries) > 0 {
			agg.emit(index, summaries)
		} else {
			agg.complete(index)
		}
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

	go func() {
		ready := s.CachesReady()
		select {
		case ch <- StreamingUpdate{Ready: ready}:
		default:
		}
	}()

	return ch, unsubscribe
}

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
	return s.cachesReady
}

func (s *Service) publishStreamingState(
	chunks []*summaryChunk,
	kindSet map[string]struct{},
	namespaceSet map[string]struct{},
	descriptors []Descriptor,
	ready bool,
) {
	chunkSnapshot := make([]*summaryChunk, len(chunks))
	copy(chunkSnapshot, chunks)

	kindSnapshot := snapshotSortedKeys(kindSet)
	namespaceSnapshot := snapshotSortedKeys(namespaceSet)

	s.mu.Lock()
	s.sortedChunks = chunkSnapshot
	s.cachedKinds = kindSnapshot
	s.cachedNamespaces = namespaceSnapshot
	if descriptors != nil {
		s.cachedDescriptors = append([]Descriptor(nil), descriptors...)
	}
	s.cachesReady = ready
	s.mu.Unlock()
}

func (s *Service) setFirstBatchLatency(latency time.Duration) {
	s.mu.Lock()
	s.lastFirstBatchLatency = latency
	s.mu.Unlock()
}

// FirstBatchLatency returns the most recent time-to-first-batch measurement.
func (s *Service) FirstBatchLatency() time.Duration {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.lastFirstBatchLatency
}
