/*
 * backend/resources/service/dto.go
 *
 * Service detail DTOs (the frontend wire shape), co-located with its model and
 * detail builder. Embeds the shared StatusProjection base (wails flattens it).
 */

package service

import restypes "github.com/luxury-yacht/app/backend/resources/types"

type ServiceDetails struct {
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Age       string `json:"age"`
	Details   string `json:"details"`
	restypes.StatusProjection
	ServiceType            string               `json:"serviceType"`
	ClusterIP              string               `json:"clusterIP"`
	ClusterIPs             []string             `json:"clusterIPs,omitempty"`
	ExternalIPs            []string             `json:"externalIPs,omitempty"`
	LoadBalancerIP         string               `json:"loadBalancerIP,omitempty"`
	LoadBalancerStatus     string               `json:"loadBalancerStatus,omitempty"`
	ExternalName           string               `json:"externalName,omitempty"`
	Ports                  []ServicePortDetails `json:"ports"`
	SessionAffinity        string               `json:"sessionAffinity"`
	SessionAffinityTimeout int32                `json:"sessionAffinityTimeout,omitempty"`
	Selector               map[string]string    `json:"selector,omitempty"`
	Endpoints              []string             `json:"endpoints,omitempty"`
	EndpointCount          int                  `json:"endpointCount"`
	Labels                 map[string]string    `json:"labels,omitempty"`
	Annotations            map[string]string    `json:"annotations,omitempty"`
	HealthStatus           string               `json:"healthStatus"`
}

type ServicePortDetails struct {
	Name       string `json:"name,omitempty"`
	Protocol   string `json:"protocol"`
	Port       int32  `json:"port"`
	TargetPort string `json:"targetPort"`
	NodePort   int32  `json:"nodePort,omitempty"`
}
