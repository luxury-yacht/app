package backend

import (
	"context"
	"errors"
	"sync"

	"github.com/luxury-yacht/app/backend/internal/config"
)

// clusterOperationCoordinator enforces one in-flight operation per cluster ID.
// Foreground operations cancel older work; queued callbacks preserve their producer.
type clusterOperationCoordinator struct {
	mu    sync.Mutex
	slots map[string]*clusterOperationSlot
}

type clusterOperationSlot struct {
	mu      sync.Mutex
	cancels map[uint64]context.CancelFunc
	token   uint64
}

type clusterOperationAdmission uint8

const (
	clusterOperationSupersede clusterOperationAdmission = iota
	clusterOperationSkipBusy
	clusterOperationQueue
)

func newClusterOperationCoordinator() *clusterOperationCoordinator {
	return &clusterOperationCoordinator{
		slots: make(map[string]*clusterOperationSlot),
	}
}

// run gives foreground operations priority over older work for the same cluster.
func (c *clusterOperationCoordinator) run(parent context.Context, clusterID string, fn func(context.Context) error) error {
	return c.runWithAdmission(parent, clusterID, fn, clusterOperationSupersede)
}

// runWhenIdle skips a busy cluster. The periodic caller retains retry ownership.
func (c *clusterOperationCoordinator) runWhenIdle(parent context.Context, clusterID string, fn func(context.Context) error) error {
	return c.runWithAdmission(parent, clusterID, fn, clusterOperationSkipBusy)
}

func (c *clusterOperationCoordinator) runWithAdmission(parent context.Context, clusterID string, fn func(context.Context) error, admission clusterOperationAdmission) error {
	if fn == nil {
		return nil
	}
	if clusterID == "" {
		return fn(parent)
	}
	if parent == nil {
		parent = context.Background()
	}

	slot, token, opCtx, cancel := c.begin(parent, clusterID, admission)
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
	admission clusterOperationAdmission,
) (*clusterOperationSlot, uint64, context.Context, context.CancelFunc) {
	c.mu.Lock()
	defer c.mu.Unlock()

	slot := c.slots[clusterID]
	if slot == nil {
		slot = &clusterOperationSlot{cancels: make(map[uint64]context.CancelFunc)}
		c.slots[clusterID] = slot
	}

	if len(slot.cancels) > 0 && admission == clusterOperationSkipBusy {
		return nil, 0, nil, nil
	}
	if admission == clusterOperationSupersede {
		for _, cancel := range slot.cancels {
			cancel()
		}
	}

	slot.token++
	token := slot.token
	opCtx, cancel := context.WithCancel(parent)
	slot.cancels[token] = cancel
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
	delete(slot.cancels, token)
}

func (m *ClusterRuntimeManager) runClusterOperation(ctx context.Context, clusterID string, fn func(context.Context) error) error {
	return m.runClusterOperationWithAdmission(ctx, clusterID, fn, clusterOperationSupersede)
}

func (m *ClusterRuntimeManager) runBackgroundClusterOperation(ctx context.Context, clusterID string, fn func(context.Context) error) error {
	return m.runClusterOperationWithAdmission(ctx, clusterID, fn, clusterOperationSkipBusy)
}

// Auth callbacks originate inside client construction. Queue their dependent
// work until that client is installed instead of cancelling its producer.
func (m *ClusterRuntimeManager) runQueuedClusterOperation(ctx context.Context, clusterID string, fn func(context.Context) error) error {
	return m.runClusterOperationWithAdmission(ctx, clusterID, fn, clusterOperationQueue)
}

func (m *ClusterRuntimeManager) runClusterOperationWithAdmission(ctx context.Context, clusterID string, fn func(context.Context) error, admission clusterOperationAdmission) error {
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
	err := m.clusterOps.runWithAdmission(opCtx, clusterID, fn, admission)
	if errors.Is(err, context.Canceled) {
		return nil
	}
	return err
}
