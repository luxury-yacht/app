/*
 * backend/refresh/snapshot/stream_collectors.go
 *
 * Shared registry-driven availability for the typed-table snapshot domains. A
 * domain names no kind: it supplies its domain name and a kindAvailability
 * function, and collectDescriptorSources loops the stream descriptor registry
 * (kindregistry.StreamDescriptorsForDomain) to publish each kind's source state.
 * Production builds the function from the ingest stores (ingestAvailability).
 */

package snapshot

import (
	"context"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	"github.com/luxury-yacht/app/backend/refresh/domainpermissions"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// kindAvailability reports a kind's registration-time source state: available
// when the identity was permitted to read it and its owned reflector exists,
// not served when discovery confirmed the cluster lacks the kind, and
// unavailable otherwise.
type kindAvailability func(streamspec.Descriptor) typedTableResourceState

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
// ingest store as available, each kind the cluster does not serve as not
// served, and every other kind as unavailable.
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
	states := map[string]typedTableResourceState{}
	for _, d := range kindregistry.StreamDescriptorsForDomain(domainName) {
		switch {
		case ingestManager != nil && ingestManager.NotServed(schema.GroupVersionKind{Group: d.Group, Version: d.Version, Kind: d.Kind}):
			states[d.Group+"/"+d.Resource] = typedTableResourceNotServed
		case permitted(d) && ingestStorePresent(ingestManager, d):
			states[d.Group+"/"+d.Resource] = typedTableResourceAvailable
		}
	}
	return func(d streamspec.Descriptor) typedTableResourceState {
		if state, ok := states[d.Group+"/"+d.Resource]; ok {
			return state
		}
		return typedTableResourceUnavailable
	}
}

// collectDescriptorSources reports per-descriptor availability for the domain — the
// source list the table envelope publishes. A kind is available only when it was
// available at registration (permitted and served) and this request's runtime
// permission and readiness allow it; a kind the cluster does not serve stays not
// served.
func collectDescriptorSources(
	ctx context.Context,
	domainName string,
	available kindAvailability,
) []typedTableResourceSource {
	descriptors := kindregistry.StreamDescriptorsForDomain(domainName)
	sources := make([]typedTableResourceSource, 0, len(descriptors))
	for _, d := range descriptors {
		state := typedTableResourceUnavailable
		if available != nil {
			state = available(d)
		}
		sources = append(sources, typedTableResourceSource{
			Kind:     d.Kind,
			Group:    d.Group,
			Resource: d.Resource,
			State:    state,
		})
	}
	return withTypedTableResourceReadiness(ctx, domainName, sources)
}
