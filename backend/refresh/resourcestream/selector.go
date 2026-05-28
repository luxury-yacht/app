package resourcestream

import (
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/backend/resourcemodel"
)

// StreamScopeKind enumerates the typed selector shapes that resource
// streams accept. Scope strings are a transport-only encoding; parse
// them to StreamSelector before canonicalizing the subscription key so
// loose `namespace/kind/name` triples cannot leak across module
// boundaries.
type StreamScopeKind string

const (
	StreamScopeCluster      StreamScopeKind = "cluster"
	StreamScopeNamespace    StreamScopeKind = "namespace"
	StreamScopeAllNamespace StreamScopeKind = "namespace-all"
	StreamScopeNode         StreamScopeKind = "node"
	StreamScopeWorkload     StreamScopeKind = "workload"
)

// StreamSelector is the typed subscription identity for a resource stream.
// It always carries a cluster ID and the domain it targets, and the
// scope-kind specific fields are non-empty only for that scope kind.
//
// Workload is non-nil only when ScopeKind == StreamScopeWorkload. It is
// the only selector that pins a single Kubernetes object identity; the
// other scopes name a collection (a namespace, a node, a cluster).
//
// A selector becomes a concrete row identity (resourcemodel.ResourceRef)
// only through one of the helper constructors in update_helpers.go and
// stream_registration_helpers.go. The plan calls this out explicitly:
// stream selectors are not concrete ResourceRef values because they may
// not name one object.
type StreamSelector struct {
	ClusterID string
	Domain    string
	ScopeKind StreamScopeKind
	Namespace string
	Node      string
	Workload  *WorkloadSelector
}

func (s StreamSelector) Cluster() string {
	return s.ClusterID
}

func (s StreamSelector) DomainName() string {
	return s.Domain
}

func (s StreamSelector) CanonicalScope() string {
	return s.String()
}

// WorkloadSelector identifies a single workload referenced by a
// `workload:` scope. The full GVK is required because kind/name alone
// can collide across CRDs.
type WorkloadSelector struct {
	Namespace string
	Group     string
	Version   string
	Kind      string
	Name      string
}

// AsResourceRef converts the WorkloadSelector to a concrete ResourceRef.
// The resource (plural) is supplied separately because workload
// selectors carry GVK but not the discovered GVR plural.
func (w WorkloadSelector) AsResourceRef(clusterID, resource string) resourcemodel.ResourceRef {
	return resourcemodel.NewResourceRef(clusterID, w.Group, w.Version, w.Kind, resource, w.Namespace, w.Name, "")
}

// ParseStreamSelector parses the transport scope string for a domain
// into a typed StreamSelector. The wire format remains the existing
// `namespace:X`, `node:X`, `workload:ns:group:version:kind:name`, and
// empty-string (cluster) encodings. This parser is the single place
// where transport strings should be decoded.
func ParseStreamSelector(clusterID, domain, scope string) (StreamSelector, error) {
	scope = strings.TrimSpace(scope)
	selector := StreamSelector{
		ClusterID: strings.TrimSpace(clusterID),
		Domain:    domain,
	}

	switch domain {
	case domainNodes,
		domainClusterRBAC,
		domainClusterStorage,
		domainClusterConfig,
		domainClusterCRDs,
		domainClusterCustom:
		if scope != "" && !strings.EqualFold(strings.TrimSuffix(scope, ":"), "cluster") {
			return StreamSelector{}, fmt.Errorf("%s stream does not accept scope %q", domain, scope)
		}
		selector.ScopeKind = StreamScopeCluster
		return selector, nil

	case domainPods:
		return parsePodSelector(selector, scope)

	case domainWorkloads,
		domainNamespaceConfig,
		domainNamespaceNetwork,
		domainNamespaceRBAC,
		domainNamespaceCustom,
		domainNamespaceHelm,
		domainNamespaceAutoscaling,
		domainNamespaceQuotas,
		domainNamespaceStorage:
		return parseNamespaceSelector(selector, scope)

	default:
		return StreamSelector{}, fmt.Errorf("unsupported resource stream domain %q", domain)
	}
}

// String reverses ParseStreamSelector: it produces the canonical
// transport scope encoding for this selector. ParseStreamSelector(s,
// d, sel.String()) must return sel.
func (s StreamSelector) String() string {
	switch s.ScopeKind {
	case StreamScopeCluster:
		return ""
	case StreamScopeAllNamespace:
		return "namespace:all"
	case StreamScopeNamespace:
		return "namespace:" + s.Namespace
	case StreamScopeNode:
		return "node:" + s.Node
	case StreamScopeWorkload:
		if s.Workload == nil {
			return "workload:"
		}
		return fmt.Sprintf(
			"workload:%s:%s:%s:%s:%s",
			s.Workload.Namespace,
			s.Workload.Group,
			s.Workload.Version,
			s.Workload.Kind,
			s.Workload.Name,
		)
	}
	return ""
}

func parsePodSelector(selector StreamSelector, scope string) (StreamSelector, error) {
	if scope == "" {
		return StreamSelector{}, fmt.Errorf("pods scope is required")
	}
	switch {
	case strings.HasPrefix(scope, "namespace:"):
		value := strings.TrimSpace(strings.TrimLeft(strings.TrimPrefix(scope, "namespace:"), ":"))
		if value == "" {
			return StreamSelector{}, fmt.Errorf("pods namespace scope is required")
		}
		if isAllNamespace(value) {
			selector.ScopeKind = StreamScopeAllNamespace
			return selector, nil
		}
		selector.ScopeKind = StreamScopeNamespace
		selector.Namespace = value
		return selector, nil

	case strings.HasPrefix(scope, "node:"):
		value := strings.TrimSpace(strings.TrimLeft(strings.TrimPrefix(scope, "node:"), ":"))
		if value == "" {
			return StreamSelector{}, fmt.Errorf("pods node scope is required")
		}
		selector.ScopeKind = StreamScopeNode
		selector.Node = value
		return selector, nil

	case strings.HasPrefix(scope, "workload:"):
		value := strings.TrimSpace(strings.TrimLeft(strings.TrimPrefix(scope, "workload:"), ":"))
		parts := strings.Split(value, ":")
		if len(parts) != 5 {
			return StreamSelector{}, fmt.Errorf("pods workload scope requires namespace:group:version:kind:name")
		}
		namespace := strings.TrimSpace(parts[0])
		group := strings.TrimSpace(parts[1])
		version := strings.TrimSpace(parts[2])
		kind := strings.TrimSpace(parts[3])
		name := strings.TrimSpace(parts[4])
		if namespace == "" || version == "" || kind == "" || name == "" {
			return StreamSelector{}, fmt.Errorf("pods workload scope requires namespace:group:version:kind:name")
		}
		selector.ScopeKind = StreamScopeWorkload
		selector.Workload = &WorkloadSelector{
			Namespace: namespace,
			Group:     group,
			Version:   version,
			Kind:      kind,
			Name:      name,
		}
		return selector, nil
	}
	return StreamSelector{}, fmt.Errorf("unsupported pods scope %q", scope)
}

func parseNamespaceSelector(selector StreamSelector, scope string) (StreamSelector, error) {
	value := strings.TrimSpace(scope)
	if value == "" {
		return StreamSelector{}, fmt.Errorf("%s scope is required", selector.Domain)
	}
	if strings.HasPrefix(value, "namespace:") {
		value = strings.TrimSpace(strings.TrimLeft(strings.TrimPrefix(value, "namespace:"), ":"))
	}
	if value == "" {
		return StreamSelector{}, fmt.Errorf("%s scope is required", selector.Domain)
	}
	if isAllNamespace(value) {
		selector.ScopeKind = StreamScopeAllNamespace
		return selector, nil
	}
	selector.ScopeKind = StreamScopeNamespace
	selector.Namespace = value
	return selector, nil
}

func isAllNamespace(value string) bool {
	normalized := strings.ToLower(strings.TrimSpace(value))
	return normalized == "all" || normalized == "*"
}
