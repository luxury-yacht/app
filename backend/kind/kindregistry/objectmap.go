package kindregistry

import "github.com/luxury-yacht/app/backend/resourcekind"

// ObjectMapIdentities returns the identity of every kind the object map
// collects as a graph node, from its shared-informer or Gateway-API collector,
// in registry order. A collector's identity is the version the map reads,
// which can differ from the descriptor's own identity.
func ObjectMapIdentities() []resourcekind.Identity {
	out := make([]resourcekind.Identity, 0, len(All))
	for _, d := range All {
		switch {
		case d.Collector != nil:
			out = append(out, d.Collector.Identity)
		case d.GatewayCollector != nil:
			out = append(out, d.GatewayCollector.Identity)
		}
	}
	return out
}
