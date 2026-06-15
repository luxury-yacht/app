// Package ringbuffer provides a fixed-capacity ring buffer of sequence-numbered
// items with replay-after-sequence. It is the shared implementation behind the
// event/update stream resume buffers, which previously each hand-rolled the same
// ring + replay logic for their own element type.
package ringbuffer

// Buffer is a fixed-capacity ring buffer. seqOf extracts an item's monotonically
// increasing sequence number, which Since uses to replay newer items. The
// closure lets each caller keep its own (possibly unexported) sequence field.
type Buffer[T any] struct {
	items []T
	start int
	count int
	max   int
	seqOf func(T) uint64
}

// New allocates a buffer capped at max items.
func New[T any](max int, seqOf func(T) uint64) *Buffer[T] {
	return &Buffer[T]{
		items: make([]T, max),
		max:   max,
		seqOf: seqOf,
	}
}

// Add inserts an item, evicting the oldest when the buffer is full. A zero-capacity
// buffer drops everything.
func (b *Buffer[T]) Add(item T) {
	if b.max == 0 {
		return
	}
	if b.count < b.max {
		index := (b.start + b.count) % b.max
		b.items[index] = item
		b.count++
		return
	}
	b.items[b.start] = item
	b.start = (b.start + 1) % b.max
}

// All returns the buffered items in insertion order (oldest first) as a snapshot
// copy; mutating the result does not affect the buffer.
func (b *Buffer[T]) All() []T {
	out := make([]T, 0, b.count)
	for i := 0; i < b.count; i++ {
		out = append(out, b.items[(b.start+i)%b.max])
	}
	return out
}

// Since returns the items newer than sequence. ok is false when the buffer cannot
// satisfy the resume token (it is empty, or sequence predates the oldest retained
// item). An empty, non-nil slice with ok=true means the caller is already current.
func (b *Buffer[T]) Since(sequence uint64) ([]T, bool) {
	if b.count == 0 {
		return nil, false
	}
	oldest := b.seqOf(b.items[b.start])
	latestIndex := (b.start + b.count - 1) % b.max
	latest := b.seqOf(b.items[latestIndex])
	if sequence < oldest {
		return nil, false
	}
	if sequence >= latest {
		return []T{}, true
	}
	out := make([]T, 0, b.count)
	for i := 0; i < b.count; i++ {
		index := (b.start + i) % b.max
		item := b.items[index]
		if b.seqOf(item) > sequence {
			out = append(out, item)
		}
	}
	return out, true
}
