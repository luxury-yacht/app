package objectcatalog

import (
	"context"
	"errors"
	"fmt"
	"strings"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/util/sets"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/rest"
)

func (s *Service) discoverResources(ctx context.Context) ([]resourceDescriptor, error) {
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	default:
	}
	discoveryClient := s.deps.Common.KubernetesClient.Discovery()
	if cfg := s.deps.Common.RestConfig; cfg != nil {
		cfgCopy := rest.CopyConfig(cfg)
		cfgCopy.Timeout = discoveryRequestTimeout
		if dc, err := discovery.NewDiscoveryClientForConfig(cfgCopy); err == nil {
			discoveryClient = dc
		} else if s.deps.Logger != nil {
			s.logDebug(fmt.Sprintf("catalog discovery client fallback: %v", err))
		}
	}
	if discoveryClient == nil {
		return nil, errors.New("discovery client not available")
	}

	resourceLists, err := discoveryClient.ServerPreferredResources()
	if err != nil && len(resourceLists) == 0 {
		return nil, err
	}

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	default:
	}

	return s.extractDescriptors(resourceLists), nil
}

func (s *Service) extractDescriptors(resourceLists []*metav1.APIResourceList) []resourceDescriptor {
	exported := ExtractDescriptors(resourceLists)
	result := make([]resourceDescriptor, 0, len(exported))
	for _, desc := range exported {
		r := resourceDescriptor{
			GVR: schema.GroupVersionResource{
				Group:    desc.Group,
				Version:  desc.Version,
				Resource: desc.Resource,
			},
			Namespaced: desc.Namespaced,
			Kind:       desc.Kind,
			Group:      desc.Group,
			Version:    desc.Version,
			Resource:   desc.Resource,
			Scope:      desc.Scope,
		}
		result = append(result, r)
	}
	return result
}

// ExtractDescriptors converts API resource discovery results into catalog descriptors.
func ExtractDescriptors(resourceLists []*metav1.APIResourceList) []Descriptor {
	excludedKinds := sets.NewString(
		"Event",
		"ComponentStatus", // Deprecated since Kubernetes v1.19; avoid hitting the legacy endpoint.
	)
	result := make([]Descriptor, 0)

	for _, list := range resourceLists {
		groupVersion, parseErr := schema.ParseGroupVersion(list.GroupVersion)
		if parseErr != nil {
			continue
		}

		for _, apiResource := range list.APIResources {
			if strings.Contains(apiResource.Name, "/") {
				continue
			}
			if apiResource.Kind == "" || excludedKinds.Has(apiResource.Kind) {
				continue
			}
			if !containsVerb(apiResource.Verbs, "list") {
				continue
			}

			scope := ScopeCluster
			if apiResource.Namespaced {
				scope = ScopeNamespace
			}

			result = append(result, Descriptor{
				Group:      groupVersion.Group,
				Version:    groupVersion.Version,
				Resource:   apiResource.Name,
				Kind:       apiResource.Kind,
				Scope:      scope,
				Namespaced: apiResource.Namespaced,
			})
		}
	}

	return result
}
