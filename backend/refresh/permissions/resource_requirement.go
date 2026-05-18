package permissions

import (
	"fmt"
	"strings"
)

// ResourceRequirement describes one Kubernetes RBAC resource check.
type ResourceRequirement struct {
	Group    string
	Resource string
	Verb     string
}

// ListRequirement creates a list permission requirement.
func ListRequirement(group, resource string) ResourceRequirement {
	return ResourceRequirement{
		Group:    strings.TrimSpace(group),
		Resource: strings.TrimSpace(resource),
		Verb:     "list",
	}
}

// WatchRequirement creates a watch permission requirement.
func WatchRequirement(group, resource string) ResourceRequirement {
	return ResourceRequirement{
		Group:    strings.TrimSpace(group),
		Resource: strings.TrimSpace(resource),
		Verb:     "watch",
	}
}

// ResourceKey returns the canonical group/resource key used by partial-data
// registrations and parity tests.
func ResourceKey(group, resource string) string {
	group = strings.TrimSpace(group)
	if group == "" {
		group = "core"
	}
	return fmt.Sprintf("%s/%s", group, strings.TrimSpace(resource))
}

// RequirementKey returns the canonical group/resource/verb key.
func RequirementKey(req ResourceRequirement) string {
	return fmt.Sprintf("%s/%s", ResourceKey(req.Group, req.Resource), strings.TrimSpace(req.Verb))
}
