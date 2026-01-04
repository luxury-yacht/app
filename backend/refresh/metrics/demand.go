package metrics

import (
	"context"
	"sync"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
)

type pollerControl interface {
	Start(ctx context.Context) error
	Stop(ctx context.Context) error
}

// DemandPoller starts metrics polling on demand and stops after an idle window.
type DemandPoller struct {
	poller      pollerControl
	provider    Provider
	idleTimeout time.Duration
	now         func() time.Time

	mu         sync.Mutex
	active     bool
	running    bool
	baseCtx    context.Context
	runCancel  context.CancelFunc
	idleTimer  *time.Timer
	lastDemand time.Time
	runToken   uint64
}

// NewDemandPoller wraps a poller/provider pair and enables demand-driven polling.
func NewDemandPoller(poller pollerControl, provider Provider, idleTimeout time.Duration) *DemandPoller {
	if idleTimeout <= 0 {
		idleTimeout = config.RefreshMetricsInterval * 3
	}
	return &DemandPoller{
		poller:      poller,
		provider:    provider,
		idleTimeout: idleTimeout,
		now:         time.Now,
	}
}

// Start stores the base context used for on-demand polling.
func (d *DemandPoller) Start(ctx context.Context) error {
	if d == nil {
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	d.mu.Lock()
	if d.baseCtx == nil {
		d.baseCtx = ctx
	}
	shouldStart := d.active
	if shouldStart {
		d.startLocked()
	}
	d.mu.Unlock()
	return nil
}

// Stop cancels any active polling loop and clears demand state.
func (d *DemandPoller) Stop(ctx context.Context) error {
	if d == nil {
		return nil
	}
	d.mu.Lock()
	d.active = false
	d.baseCtx = nil
	cancel, stopped := d.stopLocked()
	poller := d.poller
	d.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	if stopped && poller != nil {
		return poller.Stop(ctx)
	}
	return nil
}

// SetActive enables or disables metrics polling demand.
func (d *DemandPoller) SetActive(active bool) {
	if d == nil {
		return
	}
	d.mu.Lock()
	d.active = active
	if active {
		d.stopIdleTimerLocked()
		d.startLocked()
	} else {
		d.scheduleIdleStopLocked()
	}
	d.mu.Unlock()
}

// LatestNodeUsage returns cached node metrics and records demand.
func (d *DemandPoller) LatestNodeUsage() map[string]NodeUsage {
	if d == nil || d.provider == nil {
		return map[string]NodeUsage{}
	}
	d.touch()
	return d.provider.LatestNodeUsage()
}

// LatestPodUsage returns cached pod metrics and records demand.
func (d *DemandPoller) LatestPodUsage() map[string]PodUsage {
	if d == nil || d.provider == nil {
		return map[string]PodUsage{}
	}
	d.touch()
	return d.provider.LatestPodUsage()
}

// Metadata returns the poller metadata and records demand.
func (d *DemandPoller) Metadata() Metadata {
	if d == nil || d.provider == nil {
		return Metadata{}
	}
	d.touch()
	return d.provider.Metadata()
}

func (d *DemandPoller) touch() {
	d.mu.Lock()
	d.lastDemand = d.now()
	d.startLocked()
	if !d.active {
		d.scheduleIdleStopLocked()
	}
	d.mu.Unlock()
}

func (d *DemandPoller) startLocked() {
	if d.running || d.poller == nil {
		return
	}
	baseCtx := d.baseCtx
	if baseCtx == nil {
		baseCtx = context.Background()
		d.baseCtx = baseCtx
	}
	if baseCtx.Err() != nil {
		return
	}
	runCtx, cancel := context.WithCancel(baseCtx)
	d.runToken++
	token := d.runToken
	d.running = true
	d.runCancel = cancel
	go d.runPoller(runCtx, token)
}

func (d *DemandPoller) runPoller(runCtx context.Context, token uint64) {
	_ = d.poller.Start(runCtx)
	d.mu.Lock()
	if token != d.runToken {
		d.mu.Unlock()
		return
	}
	d.running = false
	d.runCancel = nil
	d.mu.Unlock()
}

func (d *DemandPoller) scheduleIdleStopLocked() {
	if d.idleTimeout <= 0 {
		cancel, _ := d.stopLocked()
		if cancel != nil {
			cancel()
		}
		return
	}
	if d.idleTimer == nil {
		d.idleTimer = time.AfterFunc(d.idleTimeout, d.handleIdleTimeout)
		return
	}
	d.idleTimer.Stop()
	d.idleTimer.Reset(d.idleTimeout)
}

func (d *DemandPoller) handleIdleTimeout() {
	now := d.now()
	d.mu.Lock()
	if d.active || !d.running {
		d.mu.Unlock()
		return
	}
	if now.Sub(d.lastDemand) < d.idleTimeout {
		d.scheduleIdleStopLocked()
		d.mu.Unlock()
		return
	}
	cancel, stopped := d.stopLocked()
	poller := d.poller
	d.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	if stopped && poller != nil {
		_ = poller.Stop(context.Background())
	}
}

func (d *DemandPoller) stopLocked() (context.CancelFunc, bool) {
	if !d.running {
		d.stopIdleTimerLocked()
		return nil, false
	}
	cancel := d.runCancel
	d.running = false
	d.runCancel = nil
	d.stopIdleTimerLocked()
	return cancel, true
}

func (d *DemandPoller) stopIdleTimerLocked() {
	if d.idleTimer == nil {
		return
	}
	d.idleTimer.Stop()
	d.idleTimer = nil
}
