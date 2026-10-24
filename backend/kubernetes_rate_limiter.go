package backend

import (
	"context"
	"sync"

	"k8s.io/client-go/util/flowcontrol"

	"github.com/luxury-yacht/app/backend/internal/preferenceschema"
)

type mutableKubernetesRateLimiter struct {
	mu      sync.RWMutex
	limiter flowcontrol.RateLimiter
	qps     int
	burst   int
}

func newMutableKubernetesRateLimiter(qps, burst int) *mutableKubernetesRateLimiter {
	limiter := &mutableKubernetesRateLimiter{}
	limiter.Set(qps, burst)
	return limiter
}

func (l *mutableKubernetesRateLimiter) Set(qps, burst int) {
	if qps < preferenceschema.MinKubernetesClientQPS {
		qps = preferenceschema.MinKubernetesClientQPS
	}
	if burst < preferenceschema.MinKubernetesClientBurst {
		burst = preferenceschema.MinKubernetesClientBurst
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	l.qps = qps
	l.burst = burst
	l.limiter = flowcontrol.NewTokenBucketRateLimiter(float32(qps), burst)
}

func (l *mutableKubernetesRateLimiter) Limits() (qps int, burst int) {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.qps, l.burst
}

func (l *mutableKubernetesRateLimiter) TryAccept() bool {
	limiter := l.current()
	return limiter != nil && limiter.TryAccept()
}

func (l *mutableKubernetesRateLimiter) Stop() {
	limiter := l.current()
	if limiter != nil {
		limiter.Stop()
	}
}

func (l *mutableKubernetesRateLimiter) QPS() float32 {
	l.mu.RLock()
	defer l.mu.RUnlock()
	if l.limiter == nil {
		return 0
	}
	return l.limiter.QPS()
}

func (l *mutableKubernetesRateLimiter) Accept() {
	limiter := l.current()
	if limiter != nil {
		limiter.Accept()
	}
}

func (l *mutableKubernetesRateLimiter) Wait(ctx context.Context) error {
	limiter := l.current()
	if limiter == nil {
		return nil
	}
	return limiter.Wait(ctx)
}

func (l *mutableKubernetesRateLimiter) current() flowcontrol.RateLimiter {
	l.mu.RLock()
	defer l.mu.RUnlock()
	return l.limiter
}
