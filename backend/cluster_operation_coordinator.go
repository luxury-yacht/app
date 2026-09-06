package backend

import (
	"context"
	"errors"
	"sync"

	"github.com/luxury-yacht/app/backend/internal/config"
)

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

// run gives foreground operations priority over older work for the same cluster.
func (c *clusterOperationCoordinator) run(parent context.Context, clusterID string, fn func(context.Context) error) error {
	return c.runWithAdmission(parent, clusterID, fn, true)
}

// runWhenIdle skips a busy cluster. The periodic caller retains retry ownership.
func (c *clusterOperationCoordinator) runWhenIdle(parent context.Context, clusterID string, fn func(context.Context) error) error {
	return c.runWithAdmission(parent, clusterID, fn, false)
}

func (c *clusterOperationCoordinator) runWithAdmission(parent context.Context, clusterID string, fn func(context.Context) error, supersede bool) error {
	if fn == nil {
		return nil
	}
	if clusterID == "" {
		return fn(parent)
	}
	if parent == nil {
		parent = context.Background()
	}

	slot, token, opCtx, cancel := c.begin(parent, clusterID, supersede)
	if slot == nil {
		return nil
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
	supersede bool,
) (*clusterOperationSlot, uint64, context.Context, context.CancelFunc) {
	c.mu.Lock()
	defer c.mu.Unlock()

	slot := c.slots[clusterID]
	if slot == nil {
		slot = &clusterOperationSlot{}
		c.slots[clusterID] = slot
	}

	if slot.cancel != nil {
		if !supersede {
			return nil, 0, nil, nil
		}
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

	if c.slots[clusterID] != slot {
		return
	}
	if slot.token != token {
		return
	}
	slot.cancel = nil
}

func (m *ClusterRuntimeManager) runClusterOperation(ctx context.Context, clusterID string, fn func(context.Context) error) error {
	return m.runClusterOperationWithAdmission(ctx, clusterID, fn, true)
}

func (m *ClusterRuntimeManager) runBackgroundClusterOperation(ctx context.Context, clusterID string, fn func(context.Context) error) error {
	return m.runClusterOperationWithAdmission(ctx, clusterID, fn, false)
}

func (m *ClusterRuntimeManager) runClusterOperationWithAdmission(ctx context.Context, clusterID string, fn func(context.Context) error, supersede bool) error {
	if fn == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	opCtx, cancel := context.WithTimeout(ctx, config.ClusterOperationTimeout)
	defer cancel()

	if m == nil || m.clusterOps == nil {
		err := fn(opCtx)
		if errors.Is(err, context.Canceled) {
			return nil
		}
		return err
	}
	var err error
	if supersede {
		err = m.clusterOps.run(opCtx, clusterID, fn)
	} else {
		err = m.clusterOps.runWhenIdle(opCtx, clusterID, fn)
	}
	if errors.Is(err, context.Canceled) {
		return nil
	}
	return err
}
