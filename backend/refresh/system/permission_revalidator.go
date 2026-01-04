package system

import (
	"context"
	"strings"
	"time"

	"k8s.io/klog/v2"

	"github.com/luxury-yacht/app/backend/internal/config"
)

// StartPermissionRevalidation periodically rechecks cached permission grants and shuts down
// the subsystem when previously allowed access is revoked.
func (s *Subsystem) StartPermissionRevalidation(ctx context.Context) {
	if s == nil || s.RuntimePerms == nil || s.InformerFactory == nil || s.Manager == nil {
		return
	}
	interval := config.PermissionCacheTTL
	if interval <= 0 {
		return
	}
	go s.runPermissionRevalidation(ctx, interval)
}

func (s *Subsystem) runPermissionRevalidation(ctx context.Context, interval time.Duration) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}

		if s.permissionRevoked(ctx) {
			s.stopForPermissionRevocation()
			return
		}
	}
}

// permissionRevoked returns true when a previously allowed permission is now denied.
func (s *Subsystem) permissionRevoked(ctx context.Context) bool {
	keys := s.InformerFactory.PermissionAllowedSnapshot()
	if len(keys) == 0 {
		return false
	}

	for _, key := range keys {
		group, resource, verb, ok := parsePermissionKey(key)
		if !ok {
			continue
		}
		decision, err := s.RuntimePerms.Can(ctx, group, resource, verb)
		if err != nil {
			continue
		}
		if !decision.Allowed {
			klog.V(1).Infof("Permission revoked for %s/%s verb %s; stopping refresh subsystem", group, resource, verb)
			return true
		}
	}
	return false
}

// stopForPermissionRevocation shuts down refresh services that rely on informers/streams.
func (s *Subsystem) stopForPermissionRevocation() {
	if s.ResourceStream != nil {
		s.ResourceStream.Stop()
	}
	ctx, cancel := context.WithTimeout(context.Background(), config.PermissionCheckTimeout)
	defer cancel()
	if err := s.Manager.Shutdown(ctx); err != nil {
		klog.V(1).Infof("Permission revocation shutdown failed: %v", err)
	}
}

// parsePermissionKey splits informer permission cache keys (group/resource/verb).
func parsePermissionKey(key string) (string, string, string, bool) {
	parts := strings.Split(key, "/")
	if len(parts) != 3 {
		return "", "", "", false
	}
	return parts[0], parts[1], parts[2], true
}
