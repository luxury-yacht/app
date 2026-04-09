package refresh

import (
	"fmt"
	"strings"

	"k8s.io/apimachinery/pkg/runtime/schema"
)

const ObjectClusterScopeToken = "__cluster__"

// ObjectScopeIdentity is the parsed identity encoded in an object-scoped refresh key.
type ObjectScopeIdentity struct {
	Namespace string
	GVK       schema.GroupVersionKind
	Name      string
}

// ParseObjectScope parses a refresh-domain scope string into an object identity.
// It accepts both legacy "namespace:kind:name" scopes and the newer
// "namespace:group/version:kind:name" form.
func ParseObjectScope(scope string) (ObjectScopeIdentity, error) {
	if strings.TrimSpace(scope) == "" {
		return ObjectScopeIdentity{}, fmt.Errorf("object scope is required")
	}

	_, trimmed := SplitClusterScope(scope)

	peek := strings.SplitN(trimmed, ":", 4)
	if len(peek) < 3 {
		return ObjectScopeIdentity{}, fmt.Errorf("invalid object scope %q", trimmed)
	}

	var (
		namespace string
		gvk       schema.GroupVersionKind
		name      string
	)

	if len(peek) == 4 && strings.Contains(peek[1], "/") {
		namespace = peek[0]
		groupVersion := peek[1]
		gv, err := schema.ParseGroupVersion(groupVersion)
		if err != nil {
			return ObjectScopeIdentity{}, fmt.Errorf("invalid group/version %q in scope %q: %w", groupVersion, scope, err)
		}
		gvk = gv.WithKind(strings.TrimSpace(peek[2]))
		name = peek[3]
	} else {
		parts := strings.SplitN(trimmed, ":", 3)
		if len(parts) != 3 {
			return ObjectScopeIdentity{}, fmt.Errorf("invalid object scope %q", trimmed)
		}
		namespace = parts[0]
		gvk = schema.GroupVersionKind{Kind: strings.TrimSpace(parts[1])}
		name = parts[2]
	}

	if namespace == ObjectClusterScopeToken {
		namespace = ""
	}
	if gvk.Kind == "" {
		return ObjectScopeIdentity{}, fmt.Errorf("object kind missing in scope %q", scope)
	}
	if name == "" {
		return ObjectScopeIdentity{}, fmt.Errorf("object name missing in scope %q", scope)
	}

	return ObjectScopeIdentity{
		Namespace: namespace,
		GVK:       gvk,
		Name:      name,
	}, nil
}
