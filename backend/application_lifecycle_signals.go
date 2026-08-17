package backend

import (
	"context"
	"sync/atomic"

	"github.com/luxury-yacht/app/backend/internal/lifecycle"
)

type applicationRuntimeSignals struct {
	appDone      atomic.Pointer[applicationDoneSignal]
	runtimeReady atomic.Bool
	eventEmitter func(context.Context, string, ...interface{})
}

type applicationDoneSignal struct {
	done <-chan struct{}
}

func newApplicationRuntimeSignals(
	eventEmitter func(context.Context, string, ...interface{}),
) *applicationRuntimeSignals {
	return &applicationRuntimeSignals{eventEmitter: eventEmitter}
}

// setApplicationContext retains only the cancellation signal supplied by the
// desktop application lifecycle. It deliberately does not make UI operations
// available; one peer window must complete its runtime-ready transition first.
func (s *applicationRuntimeSignals) setApplicationContext(ctx context.Context) {
	if s == nil {
		return
	}
	s.runtimeReady.Store(false)
	s.appDone.Store(&applicationDoneSignal{done: ctx.Done()})
}

func (s *applicationRuntimeSignals) clearApplicationContext() {
	if s == nil {
		return
	}
	s.runtimeReady.Store(false)
	s.appDone.Store(nil)
}

// markRuntimeReady enables desktop operations exactly once for the current
// application lifecycle.
func (s *applicationRuntimeSignals) markRuntimeReady() bool {
	return s != nil && s.runtimeReady.CompareAndSwap(false, true)
}

func (s *applicationRuntimeSignals) runtimeAvailable() bool {
	return s != nil && s.runtimeReady.Load()
}

// CtxOrBackground returns a context derived only from the application
// cancellation signal, so framework-owned context values do not leak into
// backend operations.
func (s *applicationRuntimeSignals) CtxOrBackground() context.Context {
	if s == nil {
		return context.Background()
	}
	done := s.appDone.Load()
	if done == nil {
		return context.Background()
	}
	return lifecycle.Context(done.done)
}

func (s *applicationRuntimeSignals) emitEvent(name string, args ...interface{}) {
	if s == nil || s.eventEmitter == nil || !s.runtimeAvailable() {
		return
	}
	s.eventEmitter(s.CtxOrBackground(), name, args...)
}

func (a *ApplicationLifecycle) signalState() *applicationRuntimeSignals {
	if a == nil {
		return nil
	}
	if a.signals == nil {
		a.signals = newApplicationRuntimeSignals(nil)
	}
	return a.signals
}

func (a *ApplicationLifecycle) setApplicationContext(ctx context.Context) {
	a.signalState().setApplicationContext(ctx)
}

func (a *ApplicationLifecycle) clearApplicationContext() {
	a.signalState().clearApplicationContext()
}

func (a *ApplicationLifecycle) markRuntimeReady() bool {
	return a.signalState().markRuntimeReady()
}

func (a *ApplicationLifecycle) runtimeAvailable() bool {
	return a.signalState().runtimeAvailable()
}

func (a *ApplicationLifecycle) CtxOrBackground() context.Context {
	return a.signalState().CtxOrBackground()
}

func (a *ApplicationLifecycle) emitEvent(name string, args ...interface{}) {
	a.signalState().emitEvent(name, args...)
}
