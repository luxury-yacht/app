/*
 * backend/resources/endpointslice/dto.go
 *
 * EndpointSlice detail DTO (the frontend wire shape) + its kind-specific
 * address/port sub-types, co-located with the model and detail builder.
 */

package endpointslice

import "github.com/luxury-yacht/app/backend/resourcemodel"

type EndpointSliceDetails struct {
	Kind              string                 `json:"kind"`
	Name              string                 `json:"name"`
	Namespace         string                 `json:"namespace"`
	Details           string                 `json:"details"`
	AddressType       string                 `json:"addressType"`
	ReadyAddresses    []EndpointSliceAddress `json:"readyAddresses,omitempty"`
	NotReadyAddresses []EndpointSliceAddress `json:"notReadyAddresses,omitempty"`
	Ports             []EndpointSlicePort    `json:"ports,omitempty"`
	Labels            map[string]string      `json:"labels,omitempty"`
	Annotations       map[string]string      `json:"annotations,omitempty"`
}

type EndpointSliceAddress struct {
	IP        string                      `json:"ip"`
	Hostname  string                      `json:"hostname,omitempty"`
	NodeName  string                      `json:"nodeName,omitempty"`
	TargetRef *resourcemodel.ResourceLink `json:"targetRef,omitempty"`
}

type EndpointSlicePort struct {
	Name        string `json:"name,omitempty"`
	Port        int32  `json:"port"`
	Protocol    string `json:"protocol"`
	AppProtocol string `json:"appProtocol,omitempty"`
}
