package domain

import (
	"context"
	"errors"
	"sort"
	"sync"

	"github.com/luxury-yacht/app/backend/refresh"
)

// Registry maintains a catalogue of domains available for snapshotting.
type Registry struct {
	mu      sync.RWMutex
	domains map[string]refresh.DomainConfig
}

// New creates an empty Registry instance.
func New() *Registry {
	return &Registry{domains: make(map[string]refresh.DomainConfig)}
}

// Register adds a domain configuration. Duplicate registrations are rejected.
func (r *Registry) Register(config refresh.DomainConfig) error {
	if config.Name == "" {
		return errors.New("domain name is required")
	}
	if config.BuildSnapshot == nil {
		return errors.New("domain build function is required")
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	if _, exists := r.domains[config.Name]; exists {
		return errors.New("domain already registered")
	}
	r.domains[config.Name] = config
	return nil
}

// Get returns the domain config and indicates if it exists.
func (r *Registry) Get(name string) (refresh.DomainConfig, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	cfg, ok := r.domains[name]
	return cfg, ok
}

// List returns domain configs sorted by name for deterministic iteration.
func (r *Registry) List() []refresh.DomainConfig {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make([]refresh.DomainConfig, 0, len(r.domains))
	for _, cfg := range r.domains {
		result = append(result, cfg)
	}
	sort.Slice(result, func(i, j int) bool {
		return result[i].Name < result[j].Name
	})
	return result
}

// IsPermissionDenied reports whether a domain was registered as a permission-denied placeholder.
func (r *Registry) IsPermissionDenied(name string) bool {
	cfg, ok := r.Get(name)
	if !ok {
		return false
	}
	return cfg.PermissionDenied
}

// Build invokes the domain-specific builder.
func (r *Registry) Build(ctx context.Context, domain, scope string) (*refresh.Snapshot, error) {
	cfg, ok := r.Get(domain)
	if !ok {
		return nil, errors.New("unknown domain")
	}
	return cfg.BuildSnapshot(ctx, scope)
}

// ManualRefresh proxies to the domain-specific manual refresh handler when present.
func (r *Registry) ManualRefresh(ctx context.Context, domain, scope string) (*refresh.ManualRefreshResult, error) {
	cfg, ok := r.Get(domain)
	if !ok {
		return nil, errors.New("unknown domain")
	}
	if cfg.ManualRefresh == nil {
		return &refresh.ManualRefreshResult{}, nil
	}
	return cfg.ManualRefresh(ctx, scope)
}
