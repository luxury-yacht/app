package containerlogsstream

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
		limit = config.ContainerLogsStreamGlobalTargetLimit
	}
	return &GlobalTargetLimiter{
		total:    limit,
		sessions: make(map[*TargetSession]struct{}),
	}
}

func (l *GlobalTargetLimiter) SetLimit(limit int) {
	if l == nil {
		return
	}
	if limit <= 0 {
		limit = config.ContainerLogsStreamGlobalTargetLimit
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.total == limit {
		return
	}
	l.total = limit
	l.recomputeLocked()
}

func (l *GlobalTargetLimiter) limit() int {
	if l == nil {
		return config.ContainerLogsStreamGlobalTargetLimit
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.total
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
	demand := collectTargetDemand(l.sessions)
	if len(demand.clusterIDs) == 0 {
		return allocations
	}
	clusterBudgets := make(map[string]int, len(demand.clusterIDs))
	distributeTargetBudget(clusterBudgets, demand.clusterIDs, func(clusterID string) int {
		return demand.clusterDemand[clusterID]
	}, l.total)
	for _, clusterID := range demand.clusterIDs {
		sessions := sortedTargetSessions(demand.clusterSessions[clusterID])
		distributeTargetBudget(allocations, sessions, func(session *TargetSession) int {
			return len(session.desiredKeys)
		}, clusterBudgets[clusterID])
	}
	return allocations
}

type targetDemand struct {
	clusterSessions map[string][]*TargetSession
	clusterDemand   map[string]int
	clusterIDs      []string
}

func collectTargetDemand(sessions map[*TargetSession]struct{}) targetDemand {
	demand := targetDemand{
		clusterSessions: make(map[string][]*TargetSession),
		clusterDemand:   make(map[string]int),
		clusterIDs:      make([]string, 0, len(sessions)),
	}
	seenClusters := make(map[string]struct{})
	for session := range sessions {
		if len(session.desiredKeys) == 0 {
			continue
		}
		clusterID := targetSessionClusterID(session)
		if _, ok := seenClusters[clusterID]; !ok {
			seenClusters[clusterID] = struct{}{}
			demand.clusterIDs = append(demand.clusterIDs, clusterID)
		}
		demand.clusterSessions[clusterID] = append(demand.clusterSessions[clusterID], session)
		demand.clusterDemand[clusterID] += len(session.desiredKeys)
	}
	sort.Strings(demand.clusterIDs)
	return demand
}

func targetSessionClusterID(session *TargetSession) string {
	if session.clusterID == "" {
		return "__default__"
	}
	return session.clusterID
}

// distributeTargetBudget applies the same ordered round-robin policy to clusters
// and to sessions within each cluster. Unused capacity goes to remaining demand.
func distributeTargetBudget[K comparable](allocations map[K]int, keys []K, demand func(K) int, budget int) {
	remaining := budget
	for remaining > 0 {
		if !allocateTargetBudgetRound(allocations, keys, demand, &remaining) {
			return
		}
	}
}

func allocateTargetBudgetRound[K comparable](allocations map[K]int, keys []K, demand func(K) int, remaining *int) bool {
	progressed := false
	for _, key := range keys {
		if allocations[key] >= demand(key) {
			continue
		}
		allocations[key]++
		*remaining--
		progressed = true
		if *remaining == 0 {
			break
		}
	}
	return progressed
}

func sortedTargetSessions(sessions []*TargetSession) []*TargetSession {
	sort.Slice(sessions, func(i, j int) bool {
		if sessions[i].scope != sessions[j].scope {
			return sessions[i].scope < sessions[j].scope
		}
		return sessions[i].id < sessions[j].id
	})
	return sessions
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

func buildGlobalTargetLimitWarnings(selectedCount, totalCount, limit int) []string {
	if totalCount <= selectedCount || selectedCount < 0 {
		return nil
	}
	hiddenCount := totalCount - selectedCount
	return []string{
		fmt.Sprintf(
			"Logs are hidden for %d containers because the global limit of %d was reached. Using filters to reduce the number of containers may clear this message.",
			hiddenCount,
			limit,
		),
	}
}
