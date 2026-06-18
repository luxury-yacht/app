/*
 * backend/resources/endpointslice/facts.go
 *
 * Canonical EndpointSlice facts — the single typed extraction of an
 * EndpointSlice's intrinsic fields, with its kind-specific address/port sub-types.
 */

package endpointslice

import "github.com/luxury-yacht/app/backend/resourcemodel"

// Facts is the canonical EndpointSlice model facts.
type Facts struct {
	AddressType       string                      `json:"addressType,omitempty"`
	ReadyAddresses    []EndpointAddressFacts      `json:"readyAddresses,omitempty"`
	NotReadyAddresses []EndpointAddressFacts      `json:"notReadyAddresses,omitempty"`
	Ports             []EndpointPortFacts         `json:"ports,omitempty"`
	Service           *resourcemodel.ResourceLink `json:"service,omitempty"`
}

type EndpointAddressFacts struct {
	IP        string                      `json:"ip,omitempty"`
	Hostname  string                      `json:"hostname,omitempty"`
	NodeName  string                      `json:"nodeName,omitempty"`
	TargetRef *resourcemodel.ResourceLink `json:"targetRef,omitempty"`
}

type EndpointPortFacts struct {
	Name        string `json:"name,omitempty"`
	Port        int32  `json:"port"`
	Protocol    string `json:"protocol,omitempty"`
	AppProtocol string `json:"appProtocol,omitempty"`
}
