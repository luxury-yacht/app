/*
 * backend/resources/ingress/model.go
 *
 * Ingress resource model: the single definition of an Ingress's intrinsic fields
 * + status presentation. Detail/object-map/streaming projections derive from it.
 * Shared model helpers are reused from resourcemodel (exported network base).
 */

package ingress

import (
	"fmt"
	"sort"
	"strconv"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	networkingv1 "k8s.io/api/networking/v1"
)

// BuildResourceModel builds the Ingress resource model. Facts are owned by this
// package (ingress.Facts); the shared ResourceModel carries identity + status,
// and callers needing facts use BuildFacts.
func BuildResourceModel(clusterID string, ingress *networkingv1.Ingress) resourcemodel.ResourceModel {
	facts := BuildFacts(clusterID, ingress)
	status := statusPresentation(ingress, facts)
	return resourcemodel.NetworkResourceModel(clusterID, "networking.k8s.io", "v1", "Ingress", "ingresses", resourcemodel.ResourceScopeNamespaced, ingress.ObjectMeta, status, resourcemodel.ResourceFacts{})
}

// BuildFacts extracts the Ingress facts from the raw object.
func BuildFacts(clusterID string, ingress *networkingv1.Ingress) Facts {
	facts := Facts{
		Addresses: loadBalancerAddresses(ingress.Status.LoadBalancer.Ingress),
	}
	if ingress.Spec.IngressClassName != nil {
		facts.ClassName = *ingress.Spec.IngressClassName
		if facts.ClassName != "" {
			link := resourcemodel.ClusterResourceLink(clusterID, "networking.k8s.io", "v1", "IngressClass", "ingressclasses", facts.ClassName, "")
			facts.Class = &link
		}
	}
	hostSet := map[string]struct{}{}
	for _, tls := range ingress.Spec.TLS {
		tlsFacts := TLSFacts{Hosts: append([]string(nil), tls.Hosts...)}
		if tls.SecretName != "" {
			link := resourcemodel.NewDisplayResourceLink(clusterID, "", "v1", "Secret", "secrets", ingress.Namespace, tls.SecretName)
			tlsFacts.SecretRef = &link
		}
		facts.TLS = append(facts.TLS, tlsFacts)
	}
	for _, rule := range ingress.Spec.Rules {
		if rule.Host != "" {
			hostSet[rule.Host] = struct{}{}
		}
		ruleFacts := RuleFacts{Host: rule.Host}
		if rule.HTTP != nil {
			for _, path := range rule.HTTP.Paths {
				pathFacts := PathFacts{Path: path.Path}
				if path.PathType != nil {
					pathFacts.PathType = string(*path.PathType)
				}
				pathFacts.Backend = backendFacts(clusterID, ingress.Namespace, path.Backend)
				ruleFacts.Paths = append(ruleFacts.Paths, pathFacts)
				appendBackendRef(&facts.BackendRefs, pathFacts.Backend)
			}
		}
		facts.Rules = append(facts.Rules, ruleFacts)
	}
	if ingress.Spec.DefaultBackend != nil {
		backend := backendFacts(clusterID, ingress.Namespace, *ingress.Spec.DefaultBackend)
		facts.DefaultBackend = &backend
		appendBackendRef(&facts.BackendRefs, backend)
	}
	facts.Hosts = make([]string, 0, len(hostSet))
	for host := range hostSet {
		facts.Hosts = append(facts.Hosts, host)
	}
	sort.Strings(facts.Hosts)
	return facts
}

func statusPresentation(ingress *networkingv1.Ingress, facts Facts) resourcemodel.ResourceStatusPresentation {
	state := strconv.Itoa(len(facts.Addresses))
	signals := []resourcemodel.ResourceStatusSignal{
		{Type: resourcemodel.StatusSignalResourceState, Name: "status.loadBalancer.ingress", Status: state},
		{Type: resourcemodel.StatusSignalResourceState, Name: "spec.rules", Status: strconv.Itoa(len(facts.Rules))},
	}
	lifecycle := resourcemodel.NetworkLifecycle(ingress.ObjectMeta)
	if status, ok := resourcemodel.DeletingNetworkStatus(ingress.ObjectMeta, state, signals, lifecycle); ok {
		return status
	}
	if len(facts.Addresses) > 0 {
		return resourcemodel.NetworkSourceStatus("Address assigned", state, "", "ready", signals, lifecycle)
	}
	if len(facts.Rules) == 0 && facts.DefaultBackend == nil {
		return resourcemodel.NetworkSourceStatus("No rules", state, "", "unknown", signals, lifecycle)
	}
	return resourcemodel.NetworkSourceStatus("Address pending", state, "", "warning", signals, lifecycle)
}

func backendFacts(clusterID, namespace string, backend networkingv1.IngressBackend) BackendFacts {
	if backend.Service != nil {
		facts := BackendFacts{ServiceName: backend.Service.Name}
		if backend.Service.Port.Number != 0 {
			facts.ServicePort = fmt.Sprintf("%d", backend.Service.Port.Number)
		} else if backend.Service.Port.Name != "" {
			facts.ServicePort = backend.Service.Port.Name
		}
		link := resourcemodel.NewDisplayResourceLink(clusterID, "", "v1", "Service", "services", namespace, backend.Service.Name)
		facts.Service = &link
		return facts
	}
	if backend.Resource != nil {
		return BackendFacts{Resource: fmt.Sprintf("%s/%s", backend.Resource.Kind, backend.Resource.Name)}
	}
	return BackendFacts{}
}

func appendBackendRef(refs *[]resourcemodel.ResourceLink, backend BackendFacts) {
	if backend.Service != nil {
		*refs = append(*refs, *backend.Service)
	}
}

func loadBalancerAddresses(ingresses []networkingv1.IngressLoadBalancerIngress) []string {
	addresses := make([]string, 0, len(ingresses))
	for _, ingress := range ingresses {
		if ingress.IP != "" {
			addresses = append(addresses, ingress.IP)
		} else if ingress.Hostname != "" {
			addresses = append(addresses, ingress.Hostname)
		}
	}
	sort.Strings(addresses)
	return addresses
}
