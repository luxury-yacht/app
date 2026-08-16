package backend

import (
	"sync"

	"github.com/luxury-yacht/app/backend/refresh/snapshot"
)

type attentionIndexTarget interface {
	SetIgnoreRules(snapshot.AttentionIgnoreRules)
}

type ClusterAttentionService struct {
	mu          sync.Mutex
	preferences *PreferencesService
	logger      *Logger
	targets     map[string]attentionIndexTarget
}

func NewClusterAttentionService(preferences *PreferencesService, logger *Logger) *ClusterAttentionService {
	return &ClusterAttentionService{
		preferences: preferences,
		logger:      logger,
		targets:     make(map[string]attentionIndexTarget),
	}
}

func (s *ClusterAttentionService) RegisterTarget(clusterID string, target attentionIndexTarget) {
	if s == nil || clusterID == "" || target == nil {
		return
	}
	s.mu.Lock()
	s.targets[clusterID] = target
	s.syncTarget(clusterID, target)
	s.mu.Unlock()
}

func (s *ClusterAttentionService) UnregisterTarget(clusterID string, target attentionIndexTarget) {
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
