package refresh

import (
	"fmt"
	"strings"

	"k8s.io/apimachinery/pkg/util/validation"
)

// ScopeSelectorKind names one selector shape in the refresh scope contract.
// A domain's scopeContract.selectors in refresh-domain-contract.json lists the
// kinds it accepts; the generated domain policy carries them as a ScopeGrammar.
type ScopeSelectorKind string

const (
	// ScopeSelectorCluster encodes as the empty tail.
	ScopeSelectorCluster ScopeSelectorKind = "cluster"
	// ScopeSelectorNamespace encodes as "namespace:<namespace>".
	ScopeSelectorNamespace ScopeSelectorKind = "namespace"
	// ScopeSelectorAllNamespaces encodes as "namespace:all".
	ScopeSelectorAllNamespaces ScopeSelectorKind = "all-namespaces"
	// ScopeSelectorNode encodes as "node:<name>".
	ScopeSelectorNode ScopeSelectorKind = "node"
	// ScopeSelectorWorkload encodes as "workload:<namespace>:<group>:<version>:<kind>:<name>".
	ScopeSelectorWorkload ScopeSelectorKind = "workload"
	// ScopeSelectorObject encodes as "<namespace>:<group>/<version>:<kind>:<name>",
	// with ObjectClusterScopeToken in place of the namespace for cluster-scoped objects.
	ScopeSelectorObject ScopeSelectorKind = "object"
	// ScopeSelectorHelmRelease encodes as "<namespace>:<name>", with
	// ObjectClusterScopeToken in place of an empty namespace.
	ScopeSelectorHelmRelease ScopeSelectorKind = "helm-release"
)

// ScopeQueryMode says whether, and how, a domain's scope carries query
// parameters after its selector.
type ScopeQueryMode string

const (
	// ScopeQueryNone accepts the selector alone.
	ScopeQueryNone ScopeQueryMode = "none"
	// ScopeQueryTypedTable accepts "<selector>?<typed table query>".
	ScopeQueryTypedTable ScopeQueryMode = "typed-table"
	// ScopeQueryObjectMap accepts "<selector>?maxNodes=<n>".
	ScopeQueryObjectMap ScopeQueryMode = "object-map"
	// ScopeQueryCatalog makes the whole tail a catalog query; the selector is
	// always the cluster.
	ScopeQueryCatalog ScopeQueryMode = "catalog"
)

// ScopeGrammar is one domain's accepted scope language.
type ScopeGrammar struct {
	Selectors []ScopeSelectorKind
	Query     ScopeQueryMode
}

const (
	namespaceSelectorPrefix = "namespace:"
	allNamespacesSelector   = namespaceSelectorPrefix + "all"
	nodeSelectorPrefix      = "node:"
	workloadSelectorPrefix  = "workload:"
	scopeQueryDelimiter     = "?"
)

// ScopeSelector is the typed identity encoded in a refresh scope tail. Only the
// fields of its Kind are set; build values with the selector constructors.
type ScopeSelector struct {
	Kind ScopeSelectorKind
	// Namespace is the namespace selector's namespace, or the helm release's
	// namespace ("" for a cluster-scoped release).
	Namespace string
	// Node is the node selector's node name.
	Node string
	// Object is the workload or object selector's identity.
	Object ObjectScopeIdentity
	// Name is the helm release name.
	Name string
}

// ClusterSelector selects the whole cluster.
func ClusterSelector() ScopeSelector { return ScopeSelector{Kind: ScopeSelectorCluster} }

// NamespaceSelector selects one namespace.
func NamespaceSelector(namespace string) ScopeSelector {
	return ScopeSelector{Kind: ScopeSelectorNamespace, Namespace: namespace}
}

// AllNamespacesSelector selects every namespace.
func AllNamespacesSelector() ScopeSelector { return ScopeSelector{Kind: ScopeSelectorAllNamespaces} }

// NodeSelector selects the objects bound to one node.
func NodeSelector(node string) ScopeSelector {
	return ScopeSelector{Kind: ScopeSelectorNode, Node: node}
}

// WorkloadSelector selects the objects owned by one namespaced workload.
func WorkloadSelector(workload ObjectScopeIdentity) ScopeSelector {
	return ScopeSelector{Kind: ScopeSelectorWorkload, Object: workload}
}

// ObjectSelector pins one Kubernetes object; an empty namespace is cluster-scoped.
func ObjectSelector(object ObjectScopeIdentity) ScopeSelector {
	return ScopeSelector{Kind: ScopeSelectorObject, Object: object}
}

// HelmReleaseSelector pins one Helm release; an empty namespace is cluster-scoped.
func HelmReleaseSelector(namespace, name string) ScopeSelector {
	return ScopeSelector{Kind: ScopeSelectorHelmRelease, Namespace: namespace, Name: name}
}

// String returns the selector's canonical scope tail.
func (s ScopeSelector) String() string {
	switch s.Kind {
	case ScopeSelectorNamespace:
		return namespaceSelectorPrefix + s.Namespace
	case ScopeSelectorAllNamespaces:
		return allNamespacesSelector
	case ScopeSelectorNode:
		return nodeSelectorPrefix + s.Node
	case ScopeSelectorWorkload:
		gvk := s.Object.GVK
		return workloadSelectorPrefix + strings.Join([]string{s.Object.Namespace, gvk.Group, gvk.Version, gvk.Kind, s.Object.Name}, ":")
	case ScopeSelectorObject:
		gvk := s.Object.GVK
		return fmt.Sprintf("%s:%s/%s:%s:%s", scopeNamespaceToken(s.Object.Namespace), gvk.Group, gvk.Version, gvk.Kind, escapeObjectScopeName(s.Object.Name))
	case ScopeSelectorHelmRelease:
		return scopeNamespaceToken(s.Namespace) + ":" + s.Name
	default:
		return ""
	}
}

// Scope is a decoded single-cluster refresh scope.
type Scope struct {
	ClusterID string
	Selector  ScopeSelector
	// Query is the raw query after the selector (or the whole catalog tail);
	// empty when the scope carries none.
	Query     string
	QueryMode ScopeQueryMode
}

// String returns the canonical "<clusterId>|<tail>" encoding.
func (s Scope) String() string {
	tail := s.Selector.String()
	switch {
	case s.QueryMode == ScopeQueryCatalog:
		tail = s.Query
	case s.Query != "":
		tail += scopeQueryDelimiter + s.Query
	}
	return JoinClusterScope(s.ClusterID, tail)
}

// ParseScope decodes a complete single-cluster refresh scope against a domain's
// grammar. Only canonical encodings decode.
func ParseScope(raw string, grammar ScopeGrammar) (Scope, error) {
	clusterID, tail := SplitClusterScope(raw)
	if clusterID == "" {
		return Scope{}, fmt.Errorf("refresh scope %q has no cluster prefix", raw)
	}
	selector, query, err := ParseScopeTail(tail, grammar)
	if err != nil {
		return Scope{}, err
	}
	return Scope{ClusterID: clusterID, Selector: selector, Query: query, QueryMode: grammar.Query}, nil
}

// ParseScopeTail decodes the part of a refresh scope after "<clusterId>|" and
// returns its selector and raw query.
func ParseScopeTail(tail string, grammar ScopeGrammar) (ScopeSelector, string, error) {
	selectorTail, query, err := splitScopeQuery(tail, grammar.Query)
	if err != nil {
		return ScopeSelector{}, "", err
	}
	for _, kind := range grammar.Selectors {
		if selector, ok := parseSelector(kind, selectorTail); ok {
			return selector, query, nil
		}
	}
	return ScopeSelector{}, "", fmt.Errorf("scope %q matches none of the accepted selectors %v", tail, grammar.Selectors)
}

func splitScopeQuery(tail string, mode ScopeQueryMode) (string, string, error) {
	switch mode {
	case ScopeQueryCatalog:
		// The catalog tail is the query itself; a leading "?" would be read as
		// part of the first parameter name.
		if strings.HasPrefix(tail, scopeQueryDelimiter) {
			return "", "", fmt.Errorf("catalog scope %q must not start with %q", tail, scopeQueryDelimiter)
		}
		return "", tail, nil
	case ScopeQueryTypedTable, ScopeQueryObjectMap:
		selector, query, found := strings.Cut(tail, scopeQueryDelimiter)
		if found && query == "" {
			return "", "", fmt.Errorf("scope %q has an empty query", tail)
		}
		return selector, query, nil
	default:
		if strings.Contains(tail, scopeQueryDelimiter) {
			return "", "", fmt.Errorf("scope %q does not accept a query", tail)
		}
		return tail, "", nil
	}
}

// parseSelector reports whether value is the canonical encoding of kind. The
// encodings are disjoint: namespace and node names never contain ":", so a tail
// such as "namespace:apps/v1:Deployment:web" can only be an object.
func parseSelector(kind ScopeSelectorKind, value string) (ScopeSelector, bool) {
	switch kind {
	case ScopeSelectorCluster:
		return ClusterSelector(), value == ""
	case ScopeSelectorAllNamespaces:
		return AllNamespacesSelector(), value == allNamespacesSelector
	case ScopeSelectorNamespace:
		// Namespace names are DNS-1123 labels, which also rules out the retired
		// "*" and "ALL" all-namespaces aliases.
		namespace, ok := strings.CutPrefix(value, namespaceSelectorPrefix)
		return NamespaceSelector(namespace), ok && value != allNamespacesSelector && len(validation.IsDNS1123Label(namespace)) == 0
	case ScopeSelectorNode:
		node, ok := singleSegmentAfter(value, nodeSelectorPrefix)
		return NodeSelector(node), ok
	case ScopeSelectorWorkload:
		return parseWorkloadSelector(value)
	case ScopeSelectorObject:
		return parseObjectSelector(value)
	case ScopeSelectorHelmRelease:
		return parseHelmReleaseSelector(value)
	default:
		return ScopeSelector{}, false
	}
}

func singleSegmentAfter(value, prefix string) (string, bool) {
	segment, ok := strings.CutPrefix(value, prefix)
	return segment, ok && segment != "" && !strings.Contains(segment, ":")
}

func parseWorkloadSelector(value string) (ScopeSelector, bool) {
	rest, ok := strings.CutPrefix(value, workloadSelectorPrefix)
	if !ok {
		return ScopeSelector{}, false
	}
	parts := strings.Split(rest, ":")
	if len(parts) != 5 {
		return ScopeSelector{}, false
	}
	for _, part := range parts {
		if part == "" {
			return ScopeSelector{}, false
		}
	}
	workload := ObjectScopeIdentity{Namespace: parts[0], Name: parts[4]}
	workload.GVK.Group, workload.GVK.Version, workload.GVK.Kind = parts[1], parts[2], parts[3]
	return WorkloadSelector(workload), true
}

func parseObjectSelector(value string) (ScopeSelector, bool) {
	// ParseObjectScope treats an empty namespace segment as cluster-scoped; the
	// canonical encoding spells that ObjectClusterScopeToken instead.
	if strings.HasPrefix(value, ":") {
		return ScopeSelector{}, false
	}
	object, err := ParseObjectScope(value)
	if err != nil {
		return ScopeSelector{}, false
	}
	return ObjectSelector(object), true
}

func parseHelmReleaseSelector(value string) (ScopeSelector, bool) {
	namespace, name, ok := strings.Cut(value, ":")
	if !ok || namespace == "" || name == "" {
		return ScopeSelector{}, false
	}
	if namespace == ObjectClusterScopeToken {
		namespace = ""
	}
	return HelmReleaseSelector(namespace, name), true
}

func scopeNamespaceToken(namespace string) string {
	if namespace == "" {
		return ObjectClusterScopeToken
	}
	return namespace
}
