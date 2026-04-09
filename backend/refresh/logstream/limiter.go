package logstream

import (
	"fmt"
	"sort"
	"sync"

	"github.com/luxury-yacht/app/backend/internal/config"
)

type GlobalTargetLimiter struct {
	mu       sync.Mutex
	total    int
	nextID   uint64
	sessions map[*TargetSession]struct{}
}

type TargetSession struct {
	limiter      *GlobalTargetLimiter
	id           uint64
	clusterID    string
	scope        string
	desiredKeys  []string
	allowedCount int
	notify       chan struct{}
}

func NewGlobalTargetLimiter(limit int) *GlobalTargetLimiter {
	if limit <= 0 {
		limit = config.LogStreamGlobalTargetLimit
	}
	return &GlobalTargetLimiter{
		total:    limit,
		sessions: make(map[*TargetSession]struct{}),
	}
}

func (l *GlobalTargetLimiter) StartSession(clusterID, scope string) *TargetSession {
	if l == nil {
		return nil
	}
	l.mu.Lock()
	defer l.mu.Unlock()

	l.nextID++
	session := &TargetSession{
		limiter:   l,
		id:        l.nextID,
		clusterID: clusterID,
		scope:     scope,
		notify:    make(chan struct{}, 1),
	}
	l.sessions[session] = struct{}{}
	return session
}

func (s *TargetSession) Notify() <-chan struct{} {
	if s == nil {
		return nil
	}
	return s.notify
}

func (s *TargetSession) Release() {
	if s == nil || s.limiter == nil {
		return
	}
	s.limiter.mu.Lock()
	defer s.limiter.mu.Unlock()

	delete(s.limiter.sessions, s)
	s.desiredKeys = nil
	s.allowedCount = 0
	s.limiter.recomputeLocked()
}

func (s *TargetSession) UpdateDesired(keys []string) (map[string]struct{}, int) {
	if s == nil || s.limiter == nil {
		return keysToSet(keys), 0
	}
	s.limiter.mu.Lock()
	defer s.limiter.mu.Unlock()

	nextKeys := append([]string(nil), keys...)
	s.desiredKeys = nextKeys
	s.limiter.recomputeLocked()

	allowedCount := min(len(nextKeys), s.allowedCount)
	return keysToSet(nextKeys[:allowedCount]), len(nextKeys) - allowedCount
}

func (l *GlobalTargetLimiter) recomputeLocked() {
	if l == nil {
		return
	}

	allocations := l.allocateLocked()
	for session := range l.sessions {
		nextAllowed := allocations[session]
		if session.allowedCount != nextAllowed {
			session.allowedCount = nextAllowed
			select {
			case session.notify <- struct{}{}:
			default:
			}
		}
	}
}

func (l *GlobalTargetLimiter) allocateLocked() map[*TargetSession]int {
	if l == nil {
		return nil
	}
	allocations := make(map[*TargetSession]int, len(l.sessions))
	if l.total <= 0 || len(l.sessions) == 0 {
		return allocations
	}

	clusterSessions := make(map[string][]*TargetSession)
	clusterDemand := make(map[string]int)
	clusterIDs := make([]string, 0, len(l.sessions))
	seenClusters := make(map[string]struct{})
	for session := range l.sessions {
		if len(session.desiredKeys) == 0 {
			continue
		}
		clusterID := session.clusterID
		if clusterID == "" {
			clusterID = "__default__"
		}
		if _, ok := seenClusters[clusterID]; !ok {
			seenClusters[clusterID] = struct{}{}
			clusterIDs = append(clusterIDs, clusterID)
		}
		clusterSessions[clusterID] = append(clusterSessions[clusterID], session)
		clusterDemand[clusterID] += len(session.desiredKeys)
	}
	if len(clusterIDs) == 0 {
		return allocations
	}

	sort.Strings(clusterIDs)
	clusterBudget := make(map[string]int, len(clusterIDs))
	remaining := l.total
	for remaining > 0 {
		progressed := false
		for _, clusterID := range clusterIDs {
			if clusterBudget[clusterID] >= clusterDemand[clusterID] {
				continue
			}
			clusterBudget[clusterID]++
			remaining--
			progressed = true
			if remaining == 0 {
				break
			}
		}
		if !progressed {
			break
		}
	}

	for _, clusterID := range clusterIDs {
		sessions := clusterSessions[clusterID]
		sort.Slice(sessions, func(i, j int) bool {
			if sessions[i].scope != sessions[j].scope {
				return sessions[i].scope < sessions[j].scope
			}
			return sessions[i].id < sessions[j].id
		})
		remainingCluster := clusterBudget[clusterID]
		for remainingCluster > 0 {
			progressed := false
			for _, session := range sessions {
				if allocations[session] >= len(session.desiredKeys) {
					continue
				}
				allocations[session]++
				remainingCluster--
				progressed = true
				if remainingCluster == 0 {
					break
				}
			}
			if !progressed {
				break
			}
		}
	}

	return allocations
}

func keysToSet(keys []string) map[string]struct{} {
	if len(keys) == 0 {
		return nil
	}
	out := make(map[string]struct{}, len(keys))
	for _, key := range keys {
		out[key] = struct{}{}
	}
	return out
}

func buildGlobalTargetLimitWarnings(selectedCount, totalCount int) []string {
	if totalCount <= selectedCount || selectedCount < 0 {
		return nil
	}
	return []string{
		fmt.Sprintf(
			"Showing logs for %d of %d selected pod/container targets due to the global log stream cap.",
			selectedCount,
			totalCount,
		),
	}
}
