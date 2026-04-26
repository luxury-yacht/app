package gatewayapi

import (
	"context"
	"strings"

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
	versionsByKind map[string]string
}

func EmptyPresence() *Presence {
	return &Presence{versionsByKind: map[string]string{}}
}

func (p *Presence) AnyPresent() bool {
	return p != nil && len(p.versionsByKind) > 0
}

func (p *Presence) Has(kind string) bool {
	if p == nil {
		return false
	}
	_, ok := p.versionsByKind[strings.TrimSpace(kind)]
	return ok
}

func (p *Presence) PreferredVersion(group, kind string) string {
	if group != Group || p == nil {
		return ""
	}
	return p.versionsByKind[strings.TrimSpace(kind)]
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
		if list == nil {
			continue
		}
		groupVersion := strings.TrimSpace(list.GroupVersion)
		group, version := splitGroupVersion(groupVersion)
		if group != Group || version == "" {
			continue
		}
		for _, resource := range list.APIResources {
			if strings.Contains(resource.Name, "/") {
				continue
			}
			if _, ok := supportedKinds[resource.Kind]; !ok {
				continue
			}
			if existing := presence.versionsByKind[resource.Kind]; existing == "" || version == "v1" {
				presence.versionsByKind[resource.Kind] = version
			}
		}
	}
	return presence, err
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
