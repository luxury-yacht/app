package resourcestream

import (
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
)

// streamDomains are the domains that accept resource-stream subscriptions:
// the streamed tables plus the signal-only doorbells.
var streamDomains = map[string]struct{}{
	domainNodes:                {},
	domainClusterRBAC:          {},
	domainClusterStorage:       {},
	domainClusterConfig:        {},
	domainClusterCRDs:          {},
	domainCatalog:              {},
	domainClusterEvents:        {},
	domainNamespaces:           {},
	domainNamespaceMetrics:     {},
	domainClusterOverview:      {},
	domainClusterAttention:     {},
	domainClusterIdentities:    {},
	domainPods:                 {},
	domainObjectEvents:         {},
	domainObjectDetails:        {},
	domainWorkloads:            {},
	domainNamespaceConfig:      {},
	domainNamespaceNetwork:     {},
	domainNamespaceRBAC:        {},
	domainNamespaceHelm:        {},
	domainNamespaceAutoscaling: {},
	domainNamespaceQuotas:      {},
	domainNamespaceStorage:     {},
	domainNamespaceEvents:      {},
}

// StreamSelector is the typed subscription identity for a resource stream: one
// cluster, one domain, and the domain's scope selector (never a query; queries
// are one-shot snapshot reads).
type StreamSelector struct {
	ClusterID string
	Domain    string
	Selector  refresh.ScopeSelector
}

func (s StreamSelector) Cluster() string {
	return s.ClusterID
}

func (s StreamSelector) DomainName() string {
	return s.Domain
}

// CanonicalScope is the subscription key: the selector's canonical tail, the
// same encoding every broadcaster rings.
func (s StreamSelector) CanonicalScope() string {
	return s.Selector.String()
}

// ParseStreamSelector decodes the scope tail of a stream subscription (the
// stream mux strips the cluster prefix) against the domain's authored scope
// grammar. Only canonical encodings decode.
func ParseStreamSelector(clusterID, domainName, scope string) (StreamSelector, error) {
	clusterID = strings.TrimSpace(clusterID)
	if clusterID == "" {
		return StreamSelector{}, fmt.Errorf("cluster id is required")
	}
	if _, ok := streamDomains[domainName]; !ok {
		return StreamSelector{}, fmt.Errorf("unsupported resource stream domain %q", domainName)
	}
	selector, err := domain.ParseDomainSelector(domainName, strings.TrimSpace(scope))
	if err != nil {
		return StreamSelector{}, err
	}
	return StreamSelector{ClusterID: clusterID, Domain: domainName, Selector: selector}, nil
}
