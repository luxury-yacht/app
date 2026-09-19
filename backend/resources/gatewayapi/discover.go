package gatewayapi

import (
	"context"
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

func DiscoverViaDiscovery(ctx context.Context, discoveryClient discovery.DiscoveryInterface) (*Presence, error) {
	if err := ctx.Err(); err != nil {
		return EmptyPresence(), err
	}
	if discoveryClient == nil {
		return EmptyPresence(), nil
	}

	_, resources, err := discoveryClient.ServerGroupsAndResources()
	presence := EmptyPresence()
	for _, list := range resources {
		recordGatewayAPIResources(presence, list)
	}
	return presence, err
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
