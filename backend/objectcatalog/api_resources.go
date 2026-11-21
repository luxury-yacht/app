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
	sort.Slice(result, func(i, j int) bool {
		if result[i].Group != result[j].Group {
			return result[i].Group < result[j].Group
		}
		return result[i].Resource < result[j].Resource
	})
	return result
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
	// discovered is the last discovery's list; custom is the set of resources
	// CustomResourceDefinitions define. items is discovered with Custom set.
	discovered  []APIResource
	custom      map[schema.GroupResource]struct{}
	items       []APIResource
	revision    uint64
	ready       bool
	subscribers subsetSubscribers
}

// replace publishes a successful discovery's API resources.
func (s *apiResourceStore) replace(discovered []APIResource) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.discovered = discovered
	first := !s.ready
	s.ready = true
	s.publishLocked(first)
}

// setCustomResources replaces the set of CRD-defined resources. CRD rows are
// listed independently of discovery, so this may run before or after replace.
func (s *apiResourceStore) setCustomResources(custom map[schema.GroupResource]struct{}) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.custom = custom
	if s.ready {
		s.publishLocked(false)
	}
}

// publishLocked rebuilds the flagged list and signals subscribers when it
// changed, or unconditionally when force is set (the first discovery).
func (s *apiResourceStore) publishLocked(force bool) {
	next := make([]APIResource, len(s.discovered))
	for i, resource := range s.discovered {
		_, resource.Custom = s.custom[schema.GroupResource{Group: resource.Group, Resource: resource.Resource}]
		next[i] = resource
	}
	if !force && reflect.DeepEqual(s.items, next) {
		return
	}
	s.items = next
	s.revision++
	s.subscribers.publish(SubsetUpdate{Revision: s.revision})
}

func (s *apiResourceStore) snapshot() ([]APIResource, uint64, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return append([]APIResource(nil), s.items...), s.revision, s.ready
}

func (s *apiResourceStore) subscribe() (<-chan SubsetUpdate, func()) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var current *SubsetUpdate
	if s.ready {
		current = &SubsetUpdate{Revision: s.revision}
	}
	ch, id := s.subscribers.add(current)
	return ch, func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		s.subscribers.remove(id)
	}
}

// APIResources returns the kinds the cluster serves, the revision of that list,
// and whether a discovery has succeeded yet. The list is shared: do not mutate
// its entries.
func (s *Service) APIResources() ([]APIResource, uint64, bool) {
	if s == nil {
		return nil, 0, false
	}
	return s.apiResources.snapshot()
}

// SubscribeAPIResources signals each change to the discovered API surface. A
// subscriber that joins after the first discovery immediately receives the
// current revision.
func (s *Service) SubscribeAPIResources() (<-chan SubsetUpdate, func()) {
	return s.apiResources.subscribe()
}
