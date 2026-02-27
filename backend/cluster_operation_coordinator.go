package backend

import (
	"context"
	"errors"
	"sync"
	"time"
)

const defaultClusterOperationTimeout = 90 * time.Second

// clusterOperationCoordinator enforces one in-flight operation per cluster ID.
// Starting a new operation for the same cluster cancels the previous operation context.
type clusterOperationCoordinator struct {
	mu    sync.Mutex
	slots map[string]*clusterOperationSlot
}

type clusterOperationSlot struct {
	mu     sync.Mutex
	cancel context.CancelFunc
	token  uint64
}

func newClusterOperationCoordinator() *clusterOperationCoordinator {
	return &clusterOperationCoordinator{
		slots: make(map[string]*clusterOperationSlot),
	}
}

// run executes fn under per-cluster singleflight semantics.
func (c *clusterOperationCoordinator) run(
	parent context.Context,
	clusterID string,
	fn func(context.Context) error,
) error {
	if fn == nil {
		return nil
	}
	if clusterID == "" {
		return fn(parent)
	}
	if parent == nil {
		parent = context.Background()
	}

	slot, token, opCtx, cancel := c.begin(parent, clusterID)
	if slot == nil {
		return fn(opCtx)
	}
	defer c.end(clusterID, slot, token, cancel)

	slot.mu.Lock()
	defer slot.mu.Unlock()

	if opCtx.Err() != nil {
		return opCtx.Err()
	}
	return fn(opCtx)
}

func (c *clusterOperationCoordinator) begin(
	parent context.Context,
	clusterID string,
) (*clusterOperationSlot, uint64, context.Context, context.CancelFunc) {
	c.mu.Lock()
	defer c.mu.Unlock()

	slot := c.slots[clusterID]
	if slot == nil {
		slot = &clusterOperationSlot{}
		c.slots[clusterID] = slot
	}

	if slot.cancel != nil {
		slot.cancel()
	}

	slot.token++
	token := slot.token
	opCtx, cancel := context.WithCancel(parent)
	slot.cancel = cancel
	return slot, token, opCtx, cancel
}

func (c *clusterOperationCoordinator) end(
	clusterID string,
	slot *clusterOperationSlot,
	token uint64,
	cancel context.CancelFunc,
) {
	cancel()

	c.mu.Lock()
	defer c.mu.Unlock()

	if current := c.slots[clusterID]; current != slot {
		return
	}
	if slot.token != token {
		return
	}
	slot.cancel = nil
}

func (a *App) runClusterOperation(
	ctx context.Context,
	clusterID string,
	fn func(context.Context) error,
) error {
	if fn == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	opCtx, cancel := context.WithTimeout(ctx, defaultClusterOperationTimeout)
	defer cancel()

	if a == nil || a.clusterOps == nil {
		err := fn(opCtx)
		if errors.Is(err, context.Canceled) {
			return nil
		}
		return err
	}
	err := a.clusterOps.run(opCtx, clusterID, fn)
	if errors.Is(err, context.Canceled) {
		return nil
	}
	return err
}
