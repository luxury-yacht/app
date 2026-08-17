package backend

import (
	"sync"

	"github.com/luxury-yacht/app/backend/refresh/snapshot"
)

type attentionIgnoreRulesSetter interface {
	SetIgnoreRules(snapshot.AttentionIgnoreRules)
}

type clusterAttentionRepository interface {
	readAttentionRules(string) (snapshot.AttentionIgnoreRules, error)
	updateClusterAttentionRules(string, func(*settingsClusterAttentionRules)) (snapshot.AttentionIgnoreRules, error)
	updateGlobalAttentionRules(string, []string, func(*settingsGlobalAttentionRules)) (snapshot.AttentionIgnoreRules, map[string]snapshot.AttentionIgnoreRules, error)
}

type ClusterAttentionService struct {
	mu          sync.Mutex
	preferences clusterAttentionRepository
	logger      *Logger
	targets     map[string]attentionIgnoreRulesSetter
}

func NewClusterAttentionService(preferences clusterAttentionRepository, logger *Logger) *ClusterAttentionService {
	return &ClusterAttentionService{
		preferences: preferences,
		logger:      logger,
		targets:     make(map[string]attentionIgnoreRulesSetter),
	}
}

func (s *ClusterAttentionService) RegisterTarget(clusterID string, target attentionIgnoreRulesSetter) {
	if s == nil || clusterID == "" || target == nil {
		return
	}
	s.mu.Lock()
	s.targets[clusterID] = target
	s.syncTarget(clusterID, target)
	s.mu.Unlock()
}

func (s *ClusterAttentionService) UnregisterTarget(clusterID string, target attentionIgnoreRulesSetter) {
	if s == nil || clusterID == "" {
		return
	}
	s.mu.Lock()
	if current := s.targets[clusterID]; target == nil || current == target {
		delete(s.targets, clusterID)
	}
	s.mu.Unlock()
}

func (s *ClusterAttentionService) ResetProjection() {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, target := range s.targets {
		if target != nil {
			target.SetIgnoreRules(snapshot.AttentionIgnoreRules{})
		}
	}
}
