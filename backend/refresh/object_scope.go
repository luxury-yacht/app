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

// ParseObjectScope parses a refresh-domain scope string into a complete object
// identity. Object scopes must use "namespace:group/version:kind:name"; core
// resources encode the empty group as "/v1".
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

	if len(peek) != 4 || !strings.Contains(peek[1], "/") {
		return ObjectScopeIdentity{}, fmt.Errorf("object scope %q must include apiVersion", trimmed)
	}

	namespace = peek[0]
	groupVersion := peek[1]
	gv, err := schema.ParseGroupVersion(groupVersion)
	if err != nil {
		return ObjectScopeIdentity{}, fmt.Errorf("invalid group/version %q in scope %q: %w", groupVersion, scope, err)
	}
	gvk = gv.WithKind(strings.TrimSpace(peek[2]))
	name = peek[3]

	if namespace == ObjectClusterScopeToken {
		namespace = ""
	}
	if gvk.Version == "" {
		return ObjectScopeIdentity{}, fmt.Errorf("object apiVersion missing in scope %q", scope)
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
