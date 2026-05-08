package resourcemodel

import (
	"fmt"
	"sort"
	"strconv"

	networkingv1 "k8s.io/api/networking/v1"
)

func BuildIngressResourceModel(clusterID string, ingress *networkingv1.Ingress) ResourceModel {
	facts := BuildIngressFacts(clusterID, ingress)
	status := BuildIngressStatusPresentation(ingress, facts)
	return networkResourceModel(clusterID, "networking.k8s.io", "v1", "Ingress", "ingresses", ResourceScopeNamespaced, ingress.ObjectMeta, status, ResourceFacts{Ingress: &facts})
}

func BuildIngressFacts(clusterID string, ingress *networkingv1.Ingress) IngressFacts {
	facts := IngressFacts{
		Addresses: ingressLoadBalancerAddresses(ingress.Status.LoadBalancer.Ingress),
	}
	if ingress.Spec.IngressClassName != nil {
		facts.ClassName = *ingress.Spec.IngressClassName
		if facts.ClassName != "" {
			link := clusterResourceLink(clusterID, "networking.k8s.io", "v1", "IngressClass", "ingressclasses", facts.ClassName, "")
			facts.Class = &link
		}
	}
	hostSet := map[string]struct{}{}
	for _, tls := range ingress.Spec.TLS {
		tlsFacts := IngressTLSFacts{Hosts: append([]string(nil), tls.Hosts...)}
		if tls.SecretName != "" {
			link := displayResourceLink(clusterID, "", "v1", "Secret", "secrets", ingress.Namespace, tls.SecretName)
			tlsFacts.SecretRef = &link
		}
		facts.TLS = append(facts.TLS, tlsFacts)
	}
	for _, rule := range ingress.Spec.Rules {
		if rule.Host != "" {
			hostSet[rule.Host] = struct{}{}
		}
		ruleFacts := IngressRuleFacts{Host: rule.Host}
		if rule.HTTP != nil {
			for _, path := range rule.HTTP.Paths {
				pathFacts := IngressPathFacts{Path: path.Path}
				if path.PathType != nil {
					pathFacts.PathType = string(*path.PathType)
				}
				pathFacts.Backend = ingressBackendFacts(clusterID, ingress.Namespace, path.Backend)
				ruleFacts.Paths = append(ruleFacts.Paths, pathFacts)
				appendBackendRef(&facts.BackendRefs, pathFacts.Backend)
			}
		}
		facts.Rules = append(facts.Rules, ruleFacts)
	}
	if ingress.Spec.DefaultBackend != nil {
		backend := ingressBackendFacts(clusterID, ingress.Namespace, *ingress.Spec.DefaultBackend)
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

func BuildIngressStatusPresentation(ingress *networkingv1.Ingress, facts IngressFacts) ResourceStatusPresentation {
	state := strconv.Itoa(len(facts.Addresses))
	signals := []ResourceStatusSignal{
		{Type: StatusSignalResourceState, Name: "status.loadBalancer.ingress", Status: state},
		{Type: StatusSignalResourceState, Name: "spec.rules", Status: strconv.Itoa(len(facts.Rules))},
	}
	lifecycle := networkLifecycle(ingress.ObjectMeta)
	if status, ok := deletingNetworkStatus(ingress.ObjectMeta, state, signals, lifecycle); ok {
		return status
	}
	if len(facts.Addresses) > 0 {
		return networkSourceStatus("Address assigned", state, "", "ready", signals, lifecycle)
	}
	if len(facts.Rules) == 0 && facts.DefaultBackend == nil {
		return networkSourceStatus("No rules", state, "", "unknown", signals, lifecycle)
	}
	return networkSourceStatus("Address pending", state, "", "warning", signals, lifecycle)
}

func ingressBackendFacts(clusterID, namespace string, backend networkingv1.IngressBackend) IngressBackendFacts {
	if backend.Service != nil {
		facts := IngressBackendFacts{ServiceName: backend.Service.Name}
		if backend.Service.Port.Number != 0 {
			facts.ServicePort = fmt.Sprintf("%d", backend.Service.Port.Number)
		} else if backend.Service.Port.Name != "" {
			facts.ServicePort = backend.Service.Port.Name
		}
		link := displayResourceLink(clusterID, "", "v1", "Service", "services", namespace, backend.Service.Name)
		facts.Service = &link
		return facts
	}
	if backend.Resource != nil {
		facts := IngressBackendFacts{Resource: fmt.Sprintf("%s/%s", backend.Resource.Kind, backend.Resource.Name)}
		return facts
	}
	return IngressBackendFacts{}
}

func appendBackendRef(refs *[]ResourceLink, backend IngressBackendFacts) {
	if backend.Service != nil {
		*refs = append(*refs, *backend.Service)
	}
}
