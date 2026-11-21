package objectcatalog

import (
	"reflect"
	"sort"
	"strings"
	"sync"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// APIResource describes one kind the cluster serves, as API discovery reports
// it. Unlike a catalog Descriptor it also covers kinds whose objects the catalog
// never collects (Events, kinds that cannot be listed, the metrics API) and it
// carries every served version, preferred first.
type APIResource struct {
	Group      string   `json:"group"`
	Version    string   `json:"version"`
	Versions   []string `json:"versions"`
	Kind       string   `json:"kind"`
	Resource   string   `json:"resource"`
	Singular   string   `json:"singular,omitempty"`
	Namespaced bool     `json:"namespaced"`
	ShortNames []string `json:"shortNames,omitempty"`
	Verbs      []string `json:"verbs,omitempty"`
	Categories []string `json:"categories,omitempty"`
	// Custom reports that a CustomResourceDefinition visible to this identity
	// defines the resource. It is not part of discovery; the store sets it.
	Custom bool `json:"custom"`
}

// buildAPIResources folds a groups-and-resources discovery document into one
// entry per group and resource. The entry is described by the group's preferred
// version when that version serves the resource, otherwise by the first version
// that does, which is the rule client-go's ServerPreferredResources applies.
func buildAPIResources(groups []*metav1.APIGroup, lists []*metav1.APIResourceList) []APIResource {
	listsByVersion := resourceListsByVersion(lists)
	byResource := make(map[schema.GroupResource]*APIResource)
	for _, groupVersion := range discoveryVersionOrder(groups) {
		list, ok := listsByVersion[groupVersion]
		if !ok {
			continue
		}
		for i := range list.APIResources {
			addAPIResourceVersion(byResource, groupVersion, &list.APIResources[i])
		}
	}

	result := make([]APIResource, 0, len(byResource))
	for _, resource := range byResource {
		result = append(result, *resource)
	}
	sortAPIResources(result)
	return result
}

// sortAPIResources orders an inventory by group, then plural resource, so two
// discoveries of the same cluster compare equal.
func sortAPIResources(resources []APIResource) {
	sort.Slice(resources, func(i, j int) bool {
		if resources[i].Group != resources[j].Group {
			return resources[i].Group < resources[j].Group
		}
		return resources[i].Resource < resources[j].Resource
	})
}

func resourceListsByVersion(lists []*metav1.APIResourceList) map[schema.GroupVersion]*metav1.APIResourceList {
	byVersion := make(map[schema.GroupVersion]*metav1.APIResourceList, len(lists))
	for _, list := range lists {
		if list == nil {
			continue
		}
		if groupVersion, err := schema.ParseGroupVersion(list.GroupVersion); err == nil {
			byVersion[groupVersion] = list
		}
	}
	return byVersion
}

// discoveryVersionOrder lists every group version with each group's preferred
// version ahead of its other versions, which keep the server's order.
func discoveryVersionOrder(groups []*metav1.APIGroup) []schema.GroupVersion {
	order := make([]schema.GroupVersion, 0, len(groups))
	for _, group := range groups {
		if group == nil {
			continue
		}
		preferred := group.PreferredVersion.Version
		if preferred != "" {
			order = append(order, schema.GroupVersion{Group: group.Name, Version: preferred})
		}
		for _, version := range group.Versions {
			if version.Version != preferred {
				order = append(order, schema.GroupVersion{Group: group.Name, Version: version.Version})
			}
		}
	}
	return order
}

func addAPIResourceVersion(byResource map[schema.GroupResource]*APIResource, groupVersion schema.GroupVersion, apiResource *metav1.APIResource) {
	// Subresources such as pods/log are part of their parent resource.
	if strings.Contains(apiResource.Name, "/") || apiResource.Kind == "" {
		return
	}
	key := schema.GroupResource{Group: groupVersion.Group, Resource: apiResource.Name}
	if existing, ok := byResource[key]; ok {
		existing.Versions = append(existing.Versions, groupVersion.Version)
		return
	}
	byResource[key] = &APIResource{
		Group:      groupVersion.Group,
		Version:    groupVersion.Version,
		Versions:   []string{groupVersion.Version},
		Kind:       apiResource.Kind,
		Resource:   apiResource.Name,
		Singular:   apiResource.SingularName,
		Namespaced: apiResource.Namespaced,
		ShortNames: cloneStrings(apiResource.ShortNames),
		Verbs:      cloneStrings(apiResource.Verbs),
		Categories: cloneStrings(apiResource.Categories),
	}
}

func cloneStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	return append([]string(nil), values...)
}

// apiResourceStore holds the API surface from the last successful discovery.
// Subscribers are told only when it changes, so the periodic rediscovery of an
// unchanged cluster stays silent. The zero value is ready to use.
type apiResourceStore struct {
	mu sync.RWMutex
	// discovered is the inventory from discovery; custom is the set of resources
	// CustomResourceDefinitions define. published is discovered with Custom set,
	// plus what is known about its completeness.
	discovered  []APIResource
	custom      map[schema.GroupResource]struct{}
	published   APIResourceInventory
	subscribers subsetSubscribers
}

// APIResourceInventory is the cluster's API surface as last published.
type APIResourceInventory struct {
	// Resources is shared: do not mutate its entries.
	Resources []APIResource
	// Revision changes whenever anything else in the inventory does.
	Revision uint64
	// Ready reports that a discovery has succeeded.
	Ready bool
	// CustomKnown reports that the CustomResourceDefinition list has been read,
	// so a resource that is not flagged Custom really has no definition. Until
	// then, and for an identity that cannot list definitions, Custom says nothing.
	CustomKnown bool
	// FailedGroupVersions are the group versions the last discovery could not
	// read. Their groups' resources are the ones last successfully discovered.
	FailedGroupVersions []string
}

// replace publishes a discovery's API resources. failed lists the group
// versions that discovery could not read: a group with a failed version keeps
// the resources last published for it, because a partial answer would
// re-describe or drop kinds that are only temporarily unreachable.
func (s *apiResourceStore) replace(discovered []APIResource, failed []schema.GroupVersion) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.discovered = retainFailedGroups(s.discovered, discovered, failed)
	next := s.published
	next.Ready = true
	next.FailedGroupVersions = groupVersionNames(failed)
	s.publishLocked(next)
}

// retainFailedGroups returns fresh with every resource of a failed group taken
// from previous instead, when previous knew that group's resource.
func retainFailedGroups(previous, fresh []APIResource, failed []schema.GroupVersion) []APIResource {
	if len(failed) == 0 {
		return fresh
	}
	failedGroups := make(map[string]struct{}, len(failed))
	for _, groupVersion := range failed {
		failedGroups[groupVersion.Group] = struct{}{}
	}
	kept := make(map[schema.GroupResource]struct{})
	merged := make([]APIResource, 0, len(fresh)+len(previous))
	for _, resource := range previous {
		if _, isFailed := failedGroups[resource.Group]; isFailed {
			kept[schema.GroupResource{Group: resource.Group, Resource: resource.Resource}] = struct{}{}
			merged = append(merged, resource)
		}
	}
	for _, resource := range fresh {
		if _, alreadyKept := kept[schema.GroupResource{Group: resource.Group, Resource: resource.Resource}]; !alreadyKept {
			merged = append(merged, resource)
		}
	}
	sortAPIResources(merged)
	return merged
}

func groupVersionNames(groupVersions []schema.GroupVersion) []string {
	if len(groupVersions) == 0 {
		return nil
	}
	names := make([]string, 0, len(groupVersions))
	for _, groupVersion := range groupVersions {
		names = append(names, groupVersion.String())
	}
	sort.Strings(names)
	return names
}

// setCustomResources replaces the set of CRD-defined resources. CRD rows are
// listed independently of discovery, so this may run before or after replace.
func (s *apiResourceStore) setCustomResources(custom map[schema.GroupResource]struct{}) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.custom = custom
	s.publishLocked(s.published)
}

// markCustomKnown records that the CustomResourceDefinition list has been read
// and handed to setCustomResources.
func (s *apiResourceStore) markCustomKnown() {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := s.published
	next.CustomKnown = true
	s.publishLocked(next)
}

// publishLocked flags the discovered resources and installs next, signalling
// subscribers when the published inventory changed. Nothing is signalled
// before the first discovery.
func (s *apiResourceStore) publishLocked(next APIResourceInventory) {
	next.Resources = make([]APIResource, len(s.discovered))
	for i, resource := range s.discovered {
		_, resource.Custom = s.custom[schema.GroupResource{Group: resource.Group, Resource: resource.Resource}]
		next.Resources[i] = resource
	}
	next.Revision = s.published.Revision
	firstDiscovery := next.Ready && !s.published.Ready
	if !firstDiscovery && reflect.DeepEqual(s.published, next) {
		return
	}
	if !next.Ready {
		// Classification can arrive before discovery; keep it without signalling.
		s.published = next
		return
	}
	next.Revision++
	s.published = next
	s.subscribers.publish(SubsetUpdate{Revision: next.Revision})
}

func (s *apiResourceStore) snapshot() APIResourceInventory {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.published
}

func (s *apiResourceStore) subscribe() (<-chan SubsetUpdate, func()) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var current *SubsetUpdate
	if s.published.Ready {
		current = &SubsetUpdate{Revision: s.published.Revision}
	}
	ch, id := s.subscribers.add(current)
	return ch, func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.subscribers.remove(id)
	}
}

// APIResources returns the kinds the cluster serves and what is known about
// that list's completeness.
func (s *Service) APIResources() APIResourceInventory {
	if s == nil {
		return APIResourceInventory{}
	}
	return s.apiResources.snapshot()
}

// SubscribeAPIResources signals each change to the discovered API surface. A
// subscriber that joins after the first discovery immediately receives the
// current revision.
func (s *Service) SubscribeAPIResources() (<-chan SubsetUpdate, func()) {
	return s.apiResources.subscribe()
}
