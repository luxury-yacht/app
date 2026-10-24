package gatewayapi

import (
	"context"
	"errors"
	"strings"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/discovery"
)

const Group = "gateway.networking.k8s.io"

var supportedKinds = map[string]struct{}{
	"GatewayClass":     {},
	"Gateway":          {},
	"ListenerSet":      {},
	"HTTPRoute":        {},
	"GRPCRoute":        {},
	"TLSRoute":         {},
	"BackendTLSPolicy": {},
	"ReferenceGrant":   {},
}

type Presence struct {
	kinds map[string]struct{}
	// complete is set when discovery listed the Gateway API group in full, so a
	// kind missing from kinds is confirmed not served.
	complete bool
}

func EmptyPresence() *Presence {
	return &Presence{kinds: map[string]struct{}{}}
}

func (p *Presence) AnyPresent() bool {
	return p != nil && len(p.kinds) > 0
}

func (p *Presence) Has(kind string) bool {
	if p == nil {
		return false
	}
	_, ok := p.kinds[strings.TrimSpace(kind)]
	return ok
}

// Absent reports whether discovery confirmed the cluster does not serve kind:
// the Gateway API group was discovered in full and did not list it.
func (p *Presence) Absent(kind string) bool {
	return p != nil && p.complete && !p.Has(kind)
}

func DiscoverViaDiscovery(ctx context.Context, discoveryClient discovery.DiscoveryInterface) (*Presence, error) {
	if err := ctx.Err(); err != nil {
		return EmptyPresence(), err
	}
	if discoveryClient == nil {
		return EmptyPresence(), nil
	}

	_, resources, err := discovery.ToDiscoveryInterfaceWithContext(discoveryClient).ServerGroupsAndResourcesWithContext(ctx)
	presence := EmptyPresence()
	for _, list := range resources {
		recordGatewayAPIResources(presence, list)
	}
	presence.complete = gatewayGroupDiscovered(err)
	return presence, err
}

// gatewayGroupDiscovered reports whether a discovery that returned err still
// listed the Gateway API group in full: no error, or a per-group failure that
// does not name the group. Any other error leaves the group unknown.
func gatewayGroupDiscovered(err error) bool {
	if err == nil {
		return true
	}
	var failed *discovery.ErrGroupDiscoveryFailed
	if !errors.As(err, &failed) {
		return false
	}
	for groupVersion := range failed.Groups {
		if groupVersion.Group == Group {
			return false
		}
	}
	return true
}

func recordGatewayAPIResources(presence *Presence, list *metav1.APIResourceList) {
	if list == nil {
		return
	}
	group, version := splitGroupVersion(strings.TrimSpace(list.GroupVersion))
	if group != Group || version == "" {
		return
	}
	for _, resource := range list.APIResources {
		if strings.Contains(resource.Name, "/") {
			continue
		}
		if _, ok := supportedKinds[resource.Kind]; !ok {
			continue
		}
		presence.kinds[resource.Kind] = struct{}{}
	}
}

func splitGroupVersion(groupVersion string) (string, string) {
	parts := strings.Split(groupVersion, "/")
	if len(parts) == 1 {
		return "", parts[0]
	}
	if len(parts) == 2 {
		return parts[0], parts[1]
	}
	return "", ""
}
