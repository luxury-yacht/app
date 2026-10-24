package snapshot

import (
	"errors"
	"fmt"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
)

// NamespaceSnapshotScope is the parsed identity for namespace-scoped snapshot
// builders. Namespace is empty only when AllNamespaces is true.
type NamespaceSnapshotScope struct {
	ClusterID      string
	Namespace      string
	AllNamespaces  bool
	CanonicalScope string
}

// parseNamespaceSnapshotScope decodes a namespace table's base scope (its
// selector, without the query) with the scope codec.
func parseNamespaceSnapshotScope(domainName, clusterID, baseScope, requiredMessage string) (NamespaceSnapshotScope, error) {
	if baseScope == "" {
		return NamespaceSnapshotScope{}, errors.New(requiredMessage)
	}
	selector, err := domain.ParseDomainSelector(domainName, baseScope)
	if err != nil {
		return NamespaceSnapshotScope{}, err
	}
	parsed := NamespaceSnapshotScope{
		ClusterID:      clusterID,
		CanonicalScope: refresh.JoinClusterScope(clusterID, selector.String()),
	}
	switch selector.Kind {
	case refresh.ScopeSelectorAllNamespaces:
		parsed.AllNamespaces = true
	case refresh.ScopeSelectorNamespace:
		parsed.Namespace = selector.Namespace
	default:
		return NamespaceSnapshotScope{}, fmt.Errorf("%s scope %q does not name a namespace", domainName, baseScope)
	}
	return parsed, nil
}
