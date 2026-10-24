package backend

import (
	"sync/atomic"

	"github.com/luxury-yacht/app/backend/internal/preferenceschema"
)

type ContainerLogsSelectionPolicy struct {
	limit atomic.Int64
}

func NewContainerLogsSelectionPolicy(limit int) *ContainerLogsSelectionPolicy {
	p := &ContainerLogsSelectionPolicy{}
	p.SetContainerLogsPerScopeLimit(limit)
	return p
}

func (p *ContainerLogsSelectionPolicy) SetContainerLogsPerScopeLimit(limit int) {
	if p == nil {
		return
	}
	p.limit.Store(int64(repairIntPreference(preferenceschema.KeyObjPanelLogsTargetPerScopeLimit, limit)))
}

func (p *ContainerLogsSelectionPolicy) Limit() int {
	if p == nil || p.limit.Load() <= 0 {
		return preferenceschema.DefaultObjPanelLogsTargetPerScopeLimit
	}
	return int(p.limit.Load())
}

type PermissionFetchPolicy struct {
	concurrency atomic.Int64
}

func NewPermissionFetchPolicy(concurrency int) *PermissionFetchPolicy {
	p := &PermissionFetchPolicy{}
	p.SetPermissionFetchConcurrency(concurrency)
	return p
}

func (p *PermissionFetchPolicy) SetPermissionFetchConcurrency(concurrency int) {
	if p == nil {
		return
	}
	p.concurrency.Store(int64(repairIntPreference(preferenceschema.KeyPermissionSSRRFetchConcurrency, concurrency)))
}

func (p *PermissionFetchPolicy) Concurrency() int {
	if p == nil || p.concurrency.Load() <= 0 {
		return preferenceschema.DefaultPermissionSSRRFetchConcurrency
	}
	return int(p.concurrency.Load())
}
