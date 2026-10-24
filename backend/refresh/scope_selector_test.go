package refresh

import (
	"testing"

	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

var podScopeGrammar = ScopeGrammar{
	Selectors: []ScopeSelectorKind{ScopeSelectorNamespace, ScopeSelectorAllNamespaces, ScopeSelectorNode, ScopeSelectorWorkload},
	Query:     ScopeQueryTypedTable,
}

func TestParseScopeDecodesSelectorIdentity(t *testing.T) {
	deployment := ObjectScopeIdentity{Namespace: "prod", GVK: schema.GroupVersionKind{Group: "apps", Version: "v1", Kind: "Deployment"}, Name: "web"}
	node := ObjectScopeIdentity{GVK: schema.GroupVersionKind{Version: "v1", Kind: "Node"}, Name: "worker-1"}
	clusterRole := ObjectScopeIdentity{GVK: schema.GroupVersionKind{Group: "rbac.authorization.k8s.io", Version: "v1", Kind: "ClusterRole"}, Name: "system:node"}
	// RBAC names only forbid "/" and "%", so "?" is a legal name character.
	role := ObjectScopeIdentity{Namespace: "team-a", GVK: schema.GroupVersionKind{Group: "rbac.authorization.k8s.io", Version: "v1", Kind: "Role"}, Name: "reader?team"}
	objectMapGrammar := ScopeGrammar{Selectors: []ScopeSelectorKind{ScopeSelectorObject, ScopeSelectorNamespace}, Query: ScopeQueryObjectMap}

	tests := []struct {
		name    string
		raw     string
		grammar ScopeGrammar
		want    Scope
	}{
		{"cluster", "c1|", ScopeGrammar{Selectors: []ScopeSelectorKind{ScopeSelectorCluster}, Query: ScopeQueryNone}, Scope{ClusterID: "c1", Selector: ClusterSelector(), QueryMode: ScopeQueryNone}},
		{"namespace", "c1|namespace:prod", podScopeGrammar, Scope{ClusterID: "c1", Selector: NamespaceSelector("prod"), QueryMode: ScopeQueryTypedTable}},
		{"all namespaces with query", "c1|namespace:all?limit=50", podScopeGrammar, Scope{ClusterID: "c1", Selector: AllNamespacesSelector(), Query: "limit=50", QueryMode: ScopeQueryTypedTable}},
		{"node", "c1|node:worker-1", podScopeGrammar, Scope{ClusterID: "c1", Selector: NodeSelector("worker-1"), QueryMode: ScopeQueryTypedTable}},
		{"workload", "c1|workload:prod:apps:v1:Deployment:web", podScopeGrammar, Scope{ClusterID: "c1", Selector: WorkloadSelector(deployment), QueryMode: ScopeQueryTypedTable}},
		{"namespaced object", "c1|prod:apps/v1:Deployment:web", ScopeGrammar{Selectors: []ScopeSelectorKind{ScopeSelectorObject}, Query: ScopeQueryNone}, Scope{ClusterID: "c1", Selector: ObjectSelector(deployment), QueryMode: ScopeQueryNone}},
		{"core cluster object", "c1|__cluster__:/v1:Node:worker-1", ScopeGrammar{Selectors: []ScopeSelectorKind{ScopeSelectorObject}, Query: ScopeQueryNone}, Scope{ClusterID: "c1", Selector: ObjectSelector(node), QueryMode: ScopeQueryNone}},
		{"object name with colons", "c1|__cluster__:rbac.authorization.k8s.io/v1:ClusterRole:system:node", ScopeGrammar{Selectors: []ScopeSelectorKind{ScopeSelectorObject}, Query: ScopeQueryNone}, Scope{ClusterID: "c1", Selector: ObjectSelector(clusterRole), QueryMode: ScopeQueryNone}},
		{"object name with a query delimiter", "c1|team-a:rbac.authorization.k8s.io/v1:Role:reader%3Fteam", ScopeGrammar{Selectors: []ScopeSelectorKind{ScopeSelectorObject}, Query: ScopeQueryNone}, Scope{ClusterID: "c1", Selector: ObjectSelector(role), QueryMode: ScopeQueryNone}},
		{"object map query after an escaped name", "c1|team-a:rbac.authorization.k8s.io/v1:Role:reader%3Fteam?maxNodes=5", objectMapGrammar, Scope{ClusterID: "c1", Selector: ObjectSelector(role), Query: "maxNodes=5", QueryMode: ScopeQueryObjectMap}},
		{"object name with the escape character", "c1|team-a:rbac.authorization.k8s.io/v1:Role:50%25off", ScopeGrammar{Selectors: []ScopeSelectorKind{ScopeSelectorObject}, Query: ScopeQueryNone}, Scope{ClusterID: "c1", Selector: ObjectSelector(ObjectScopeIdentity{Namespace: "team-a", GVK: role.GVK, Name: "50%off"}), QueryMode: ScopeQueryNone}},
		{"helm release", "c1|prod:web", ScopeGrammar{Selectors: []ScopeSelectorKind{ScopeSelectorHelmRelease}, Query: ScopeQueryNone}, Scope{ClusterID: "c1", Selector: HelmReleaseSelector("prod", "web"), QueryMode: ScopeQueryNone}},
		{"catalog query", "c1|limit=50&kinds=Pod", ScopeGrammar{Selectors: []ScopeSelectorKind{ScopeSelectorCluster}, Query: ScopeQueryCatalog}, Scope{ClusterID: "c1", Selector: ClusterSelector(), Query: "limit=50&kinds=Pod", QueryMode: ScopeQueryCatalog}},
		// A namespace literally named "namespace" holds objects whose tail starts with
		// "namespace:"; the namespace selector never contains a colon, so it cannot match.
		{"object in a namespace named namespace", "c1|namespace:apps/v1:Deployment:web", ScopeGrammar{Selectors: []ScopeSelectorKind{ScopeSelectorObject, ScopeSelectorNamespace}, Query: ScopeQueryObjectMap}, Scope{ClusterID: "c1", Selector: ObjectSelector(ObjectScopeIdentity{Namespace: "namespace", GVK: deployment.GVK, Name: "web"}), QueryMode: ScopeQueryObjectMap}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := ParseScope(test.raw, test.grammar)
			require.NoError(t, err)
			require.Equal(t, test.want, got)
			require.Equal(t, test.raw, got.String())
		})
	}
}

// Cluster IDs are "<kubeconfig file>:<context>" and either part may contain a
// comma, so the scope prefix is one opaque cluster ID, never a list.
func TestParseScopeKeepsCommasInClusterID(t *testing.T) {
	got, err := ParseScope("prod,eu.yaml:ctx|namespace:prod", podScopeGrammar)
	require.NoError(t, err)
	require.Equal(t, "prod,eu.yaml:ctx", got.ClusterID)
	require.Equal(t, NamespaceSelector("prod"), got.Selector)
}

func TestParseScopeRejectsScopesOutsideTheGrammar(t *testing.T) {
	objectGrammar := ScopeGrammar{Selectors: []ScopeSelectorKind{ScopeSelectorObject}, Query: ScopeQueryNone}
	tests := []struct {
		name    string
		raw     string
		grammar ScopeGrammar
	}{
		{"missing cluster", "namespace:prod", podScopeGrammar},
		{"selector the domain does not accept", "c1|prod:apps/v1:Deployment:web", podScopeGrammar},
		{"bare namespace", "c1|prod", podScopeGrammar},
		{"wildcard namespace", "c1|namespace:*", podScopeGrammar},
		{"empty node", "c1|node:", podScopeGrammar},
		{"core-group workload", "c1|workload:prod::v1:ReplicationController:legacy", podScopeGrammar},
		{"empty query", "c1|namespace:prod?", podScopeGrammar},
		{"query on a query-less domain", "c1|prod:apps/v1:Deployment:web?maxNodes=5", objectGrammar},
		{"object without apiVersion", "c1|prod:Deployment:web", objectGrammar},
		{"object without namespace token", "c1|:apps/v1:Deployment:web", objectGrammar},
		{"unescaped percent in an object name", "c1|team-a:rbac.authorization.k8s.io/v1:Role:reader%team", objectGrammar},
		{"lowercase escape in an object name", "c1|team-a:rbac.authorization.k8s.io/v1:Role:reader%3fteam", objectGrammar},
		{"catalog query with a selector delimiter", "c1|?limit=50", ScopeGrammar{Selectors: []ScopeSelectorKind{ScopeSelectorCluster}, Query: ScopeQueryCatalog}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := ParseScope(test.raw, test.grammar)
			require.Error(t, err)
		})
	}
}
