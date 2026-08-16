package backend

import "sync/atomic"

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
	p.limit.Store(int64(clampObjPanelLogsTargetPerScopeLimit(limit)))
}

func (p *ContainerLogsSelectionPolicy) Limit() int {
	if p == nil || p.limit.Load() <= 0 {
		return defaultObjPanelLogsTargetPerScopeLimit
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
	p.concurrency.Store(int64(clampPermissionSSRRFetchConcurrency(concurrency)))
}

func (p *PermissionFetchPolicy) Concurrency() int {
	if p == nil || p.concurrency.Load() <= 0 {
		return defaultPermissionSSRRFetchConcurrency
	}
	return int(p.concurrency.Load())
}
