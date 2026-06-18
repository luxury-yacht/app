/*
 * backend/refresh/snapshot/stream_collectors.go
 *
 * Shared registry-driven dispatch for the typed-table snapshot domains. A domain
 * builder names no kind: it supplies its domain name and an indexerFor closure,
 * then loops the stream descriptor registry (kindregistry.StreamDescriptorsForDomain) via
 * collectDescriptorTableRows — gating each descriptor on the request's runtime
 * permission, listing the kind's cached objects from its informer indexer, and
 * projecting each into the domain's Row type via the descriptor's StreamRow
 * closure. Production wires indexerFor from the shared/Gateway-API factory
 * (factoryIndexers); tests inject their own. The per-kind row construction lives
 * in the kind packages; this file owns only the shared loop, permission gating,
 * and source list.
 */

package snapshot

import (
	"context"
	"fmt"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	"github.com/luxury-yacht/app/backend/refresh/domainpermissions"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"
	gatewayinformers "sigs.k8s.io/gateway-api/pkg/client/informers/externalversions"
)

// factoryIndexers registers each permitted descriptor's informer from whichever
// factory it uses (shared or Gateway-API) and returns an indexerFor that resolves
// a descriptor to its registered indexer (nil for kinds the user may not access or
// whose factory is unavailable). It is the production indexer source every typed-
// table domain passes to collectDescriptorTableRows; tests inject their own.
func factoryIndexers(
	shared informers.SharedInformerFactory,
	gateway gatewayinformers.SharedInformerFactory,
	allowed domainpermissions.AllowedResources,
	domainName string,
) func(streamspec.Descriptor) cache.Indexer {
	registered := map[string]cache.Indexer{}
	for _, d := range kindregistry.StreamDescriptorsForDomain(domainName) {
		if !allowed.Allows(d.Group, d.Resource) {
			continue
		}
		switch {
		case d.Informer != nil && shared != nil:
			registered[d.Group+"/"+d.Resource] = d.Informer(shared).GetIndexer()
		case d.GatewayInformer != nil && gateway != nil:
			registered[d.Group+"/"+d.Resource] = d.GatewayInformer(gateway).GetIndexer()
		}
	}
	return func(d streamspec.Descriptor) cache.Indexer {
		return registered[d.Group+"/"+d.Resource]
	}
}

// sharedFactoryIndexers is factoryIndexers for domains served only by the shared
// informer factory.
func sharedFactoryIndexers(
	factory informers.SharedInformerFactory,
	allowed domainpermissions.AllowedResources,
	domainName string,
) func(streamspec.Descriptor) cache.Indexer {
	return factoryIndexers(factory, nil, allowed, domainName)
}

// unconditionalSharedIndexers registers every shared-factory descriptor for a
// domain UNCONDITIONALLY and returns the indexerFor. It is the production indexer
// source for single-kind typed-table domains that register their informer
// unconditionally (directRegistration / listWatchRegistration) and gate access at
// the domain level — there is no per-kind allowed set to filter on. The runtime
// permission gate in collectDescriptorTableRows still applies per request.
func unconditionalSharedIndexers(
	factory informers.SharedInformerFactory,
	domainName string,
) func(streamspec.Descriptor) cache.Indexer {
	registered := map[string]cache.Indexer{}
	for _, d := range kindregistry.StreamDescriptorsForDomain(domainName) {
		if d.Informer != nil && factory != nil {
			registered[d.Group+"/"+d.Resource] = d.Informer(factory).GetIndexer()
		}
	}
	return func(d streamspec.Descriptor) cache.Indexer {
		return registered[d.Group+"/"+d.Resource]
	}
}

// collectDescriptorTableRows drives a typed-table snapshot domain entirely from
// the shared stream descriptor registry: it loops every descriptor registered for
// the domain, gates each on the request's runtime permission, lists the kind's
// cached objects from its indexer, and projects each into the domain's Row type
// via the descriptor's StreamRow closure. The domain builder names no kind — it
// supplies its domain name and an indexerFor that resolves a descriptor to its
// permitted informer indexer (nil when the kind was not registered). Cluster-scoped
// kinds (namespace "") list the whole indexer; namespaced scopes use the namespace
// index.
func collectDescriptorTableRows[Row any](
	ctx context.Context,
	domainName string,
	indexerFor func(streamspec.Descriptor) cache.Indexer,
	meta ClusterMeta,
	namespace string,
) ([]Row, []typedTableResourceSource, uint64, error) {
	rows := make([]Row, 0)
	descriptors := kindregistry.StreamDescriptorsForDomain(domainName)
	sources := make([]typedTableResourceSource, 0, len(descriptors))
	var version uint64
	for _, d := range descriptors {
		// A kind is available only when we both hold permission AND have an
		// indexer to list it from. A nil indexer means the kind was not
		// registered (denied at registration, or its factory is absent — e.g.
		// the Gateway API is not installed), so its data is genuinely
		// unavailable regardless of the runtime permission check.
		indexer := indexerFor(d)
		available := indexer != nil && runtimeResourceAllowed(ctx, domainName, d.Group, d.Resource)
		sources = append(sources, typedTableResourceSource{
			Kind:      d.Kind,
			Group:     d.Group,
			Resource:  d.Resource,
			Available: available,
		})
		if !available {
			continue
		}
		var objs []interface{}
		if namespace == "" {
			objs = indexer.List()
		} else {
			byNamespace, err := indexer.ByIndex(cache.NamespaceIndex, namespace)
			if err != nil {
				return nil, nil, 0, fmt.Errorf("%s: failed to list %s: %w", domainName, d.Resource, err)
			}
			objs = byNamespace
		}
		for _, obj := range objs {
			item, ok := obj.(metav1.Object)
			if !ok {
				continue
			}
			row, ok := d.StreamRow(meta, item).(Row)
			if !ok {
				continue
			}
			rows = append(rows, row)
			if v := resourceVersionOrTimestamp(item); v > version {
				version = v
			}
		}
	}
	return rows, sources, version, nil
}
