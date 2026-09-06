package system

import (
	"context"
	"time"

	"k8s.io/klog/v2"

	"github.com/luxury-yacht/app/backend/internal/config"
)

// StartPermissionRevalidation delegates permission changes to the generation owner.
// The owner publishes replacement routing before retiring this subsystem.
func (s *Subsystem) StartPermissionRevalidation(ctx context.Context, onChanged func(context.Context)) {
	if s == nil || s.RuntimePerms == nil || s.InformerFactory == nil || s.Manager == nil || onChanged == nil {
		return
	}
	interval := config.PermissionCacheTTL
	if interval <= 0 {
		return
	}
	go s.runPermissionRevalidation(ctx, interval, onChanged)
}

func (s *Subsystem) runPermissionRevalidation(ctx context.Context, interval time.Duration, onChanged func(context.Context)) {
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}

		if s.permissionsChanged(ctx) {
			onChanged(ctx)
		}
	}
}

// permissionsChanged compares access with the decisions used to build this generation.
func (s *Subsystem) permissionsChanged(ctx context.Context) bool {
	grants := s.InformerFactory.PermissionSnapshot()
	if len(grants) == 0 {
		return false
	}

	for grant, wasAllowed := range grants {
		decision, err := grant.Revalidate(ctx, s.RuntimePerms)
		if err != nil {
			continue
		}
		if decision.Allowed != wasAllowed {
			group, resource, verb := grant.Identity()
			klog.V(1).Infof("Permission changed for %s/%s verb %s; requesting refresh replacement", group, resource, verb)
			return true
		}
	}
	return false
}
