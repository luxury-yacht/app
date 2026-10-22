/*
 * backend/refresh/snapshot/stream_collectors.go
 *
 * Shared registry-driven availability for the typed-table snapshot domains. A
 * domain names no kind: it supplies its domain name and a kindAvailability
 * predicate, and collectDescriptorSources loops the stream descriptor registry
 * (kindregistry.StreamDescriptorsForDomain) to publish each kind's source state.
 * Production builds the predicate from the ingest stores (ingestAvailability).
 */

package snapshot

import (
	"context"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	"github.com/luxury-yacht/app/backend/refresh/domainpermissions"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
)

// kindAvailability reports whether a domain may serve a kind's rows: the
// identity was permitted to read it at registration and its owned reflector
// exists (the cluster serves the kind).
type kindAvailability func(streamspec.Descriptor) bool

// ingestStorePresent reports whether the ingest manager owns a populated-or-pending
// reflector store for the descriptor's GVR. It is the registration-time presence
// signal the availability gate combines with the domain's permission gate. A nil
// ingest manager (a unit test) reports false.
func ingestStorePresent(ingestManager *ingest.IngestManager, d streamspec.Descriptor) bool {
	if ingestManager == nil {
		return false
	}
	return ingestManager.StoreFor(d.GVR()) != nil
}

// ingestAvailability reports each of the domain's permitted kinds that has an
// ingest store as available, and every other kind as unavailable (the user may
// not access it, or the cluster does not serve it).
func ingestAvailability(
	allowed domainpermissions.AllowedResources,
	domainName string,
	ingestManager *ingest.IngestManager,
) kindAvailability {
	return ingestKindAvailability(domainName, ingestManager, func(d streamspec.Descriptor) bool {
		return allowed.Allows(d.Group, d.Resource)
	})
}

// unconditionalIngestAvailability is ingestAvailability for single-kind
// typed-table domains that gate access at the domain level, so there is no
// per-kind allowed set to filter on. The runtime permission gate in
// collectDescriptorSources still applies per request.
func unconditionalIngestAvailability(
	domainName string,
	ingestManager *ingest.IngestManager,
) kindAvailability {
	return ingestKindAvailability(domainName, ingestManager, func(streamspec.Descriptor) bool { return true })
}

func ingestKindAvailability(
	domainName string,
	ingestManager *ingest.IngestManager,
	permitted func(streamspec.Descriptor) bool,
) kindAvailability {
	registered := map[string]bool{}
	for _, d := range kindregistry.StreamDescriptorsForDomain(domainName) {
		if permitted(d) && ingestStorePresent(ingestManager, d) {
			registered[d.Group+"/"+d.Resource] = true
		}
	}
	return func(d streamspec.Descriptor) bool {
		return registered[d.Group+"/"+d.Resource]
	}
}

// collectDescriptorSources reports per-descriptor availability for the domain — the
// source list the table envelope publishes. A kind is available only when it was
// available at registration (permitted and served) and this request's runtime
// permission and readiness allow it.
func collectDescriptorSources(
	ctx context.Context,
	domainName string,
	available kindAvailability,
) []typedTableResourceSource {
	descriptors := kindregistry.StreamDescriptorsForDomain(domainName)
	sources := make([]typedTableResourceSource, 0, len(descriptors))
	for _, d := range descriptors {
		sources = append(sources, typedTableResourceSource{
			Kind:     d.Kind,
			Group:    d.Group,
			Resource: d.Resource,
			State:    typedTableSourceState(available != nil && available(d)),
		})
	}
	return withTypedTableResourceReadiness(ctx, domainName, sources)
}
