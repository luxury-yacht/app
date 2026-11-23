package objectcatalog

import (
	"reflect"
	"slices"
	"sort"
	"strings"
	"sync"

	"github.com/luxury-yacht/app/backend/resources/apiextensions"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
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
	// Custom retains the type of a CRD-backed kind until discovery removes it.
	Custom bool `json:"custom"`
	// DefinitionPresent reports whether the current CRD source can still see
	// that definition. Only a present definition can be opened as an object.
	DefinitionPresent bool `json:"definitionPresent"`
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
type crdDefinitions map[schema.GroupResource]*apiextensions.Definition

type definitionExpectation struct {
	// A nil definition expects the kind to stop being served.
	definition *apiextensions.Definition
	revision   uint64
}

type apiResourceStore struct {
	mu sync.RWMutex
	// custom is the latest CRD set. Published rows retain their Custom flag
	// until discovery confirms that the API is gone.
	custom             crdDefinitions
	watchListed        bool
	pendingDefinitions map[schema.GroupResource]definitionExpectation
	definitionRevision uint64
	published          APIResourceInventory
	subscribers        subsetSubscribers
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
	// CustomListDenied records a LIST permission denial, independently of WATCH access.
	CustomListDenied bool
	// FailedGroupVersions are the group versions the last discovery could not
	// read. Their groups' resources are the ones last successfully discovered.
	FailedGroupVersions []string
	// DiscoveryFailure is the error of a discovery that failed outright, kept
	// until a discovery succeeds. Resources are then the ones last successfully
	// discovered and may be out of date; with Ready false, none ever were.
	DiscoveryFailure error
}

// customForDiscovery snapshots the current CRD set before a discovery read.
// The set is replaced wholesale, so it can be read after releasing the lock.
// A removal needs uncached discovery, including when it was seen through LIST.
func (s *apiResourceStore) customForDiscovery() (crdDefinitions, uint64, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.custom, s.definitionRevision, s.discoveryPendingLocked()
}

func (s *apiResourceStore) discoveryPending() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.discoveryPendingLocked()
}

func (s *apiResourceStore) discoveryPendingLocked() bool {
	if len(s.pendingDefinitions) > 0 {
		return true
	}
	return slices.ContainsFunc(s.published.Resources, func(resource APIResource) bool {
		_, present := s.custom[resource.groupResource()]
		return resource.Custom && !present
	})
}

// replace publishes a discovery's API resources. failed lists the group
// versions that discovery could not read: a group with a failed version keeps
// the resources last published for it, because a partial answer would
// re-describe or drop kinds that are only temporarily unreachable.
func (s *apiResourceStore) replace(discovered []APIResource, failed []schema.GroupVersion, customAtStart crdDefinitions, revision uint64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	next := s.published
	s.confirmDefinitionsLocked(discovered, failed, revision)
	// Discovery can still advertise a deleted CRD's API. Keep the Custom flag
	// until the resource disappears from a complete response for its group.
	fresh := withCustomResources(discovered, s.custom, customAtStart, false)
	retainCustomFlags(next.Resources, fresh)
	next.Resources = retainFailedGroups(next.Resources, fresh, failed)
	next.Ready = true
	next.FailedGroupVersions = groupVersionNames(failed)
	next.DiscoveryFailure = nil
	s.publishLocked(next)
}

func (s *apiResourceStore) confirmDefinitionsLocked(discovered []APIResource, failed []schema.GroupVersion, revision uint64) {
	if len(s.pendingDefinitions) == 0 {
		return
	}
	unread := failedAPIGroups(failed)
	resources := make(map[schema.GroupResource]APIResource, len(discovered))
	for _, resource := range discovered {
		resources[resource.groupResource()] = resource
	}
	for key, expected := range s.pendingDefinitions {
		_, failed := unread[key.Group]
		if failed || expected.revision > revision {
			continue
		}
		if expected.matches(resources[key]) {
			delete(s.pendingDefinitions, key)
		}
	}
}

func (e definitionExpectation) matches(resource APIResource) bool {
	if e.definition == nil {
		return resource.Kind == ""
	}
	return definitionMatchesDiscovery(*e.definition, resource)
}

func definitionMatchesDiscovery(definition apiextensions.Definition, resource APIResource) bool {
	names := definition.AcceptedNames
	if names.Kind == "" {
		names = definition.Names
	}
	versions := slices.Clone(resource.Versions)
	sort.Strings(versions)
	return names.Kind == resource.Kind && slices.Equal(definition.ServedVersions(), versions) &&
		(definition.Scope == apiextensionsv1.NamespaceScoped) == resource.Namespaced &&
		(names.Singular == "" || names.Singular == resource.Singular) &&
		sameDiscoveryNames(names.ShortNames, resource.ShortNames) &&
		sameDiscoveryNames(names.Categories, resource.Categories)
}

func sameDiscoveryNames(expected, actual []string) bool {
	// Test and partially populated CRDs may omit accepted names. Compare
	// declared values without depending on how an API server orders them.
	if expected == nil {
		return true
	}
	sorted := slices.Clone(actual)
	sort.Strings(sorted)
	declared := slices.Clone(expected)
	sort.Strings(declared)
	return slices.Equal(declared, sorted)
}

func resourceScope(resource APIResource) Scope {
	if resource.Namespaced {
		return ScopeNamespace
	}
	return ScopeCluster
}

func retainCustomFlags(previous, fresh []APIResource) {
	custom := make(map[schema.GroupResource]APIResource)
	for _, resource := range previous {
		if resource.Custom {
			custom[resource.groupResource()] = resource
		}
	}
	for i := range fresh {
		resource := &fresh[i]
		if old, wasCustom := custom[resource.groupResource()]; wasCustom && old.Kind == resource.Kind && old.Namespaced == resource.Namespaced {
			fresh[i].Custom = true
		}
	}
}

func (r APIResource) groupResource() schema.GroupResource {
	return schema.GroupResource{Group: r.Group, Resource: r.Resource}
}

func withCustomResources(resources []APIResource, current, atDiscoveryStart crdDefinitions, retainPublished bool) []APIResource {
	classified := make([]APIResource, len(resources))
	for i, resource := range resources {
		key := resource.groupResource()
		_, defined := current[key]
		_, definedAtStart := atDiscoveryStart[key]
		resource.Custom = defined || definedAtStart || (retainPublished && resource.Custom)
		resource.DefinitionPresent = defined
		classified[i] = resource
	}
	return classified
}

// failed records that a discovery failed outright. The published resources
// stay: an unreachable API server does not mean the cluster serves nothing.
// Once a discovery has succeeded, the first failure's error is kept until the
// next success: retries fail with different text (a network error names a new
// local port each time), and that is not a change worth signalling. Before any
// success there is nothing to show but the reason, so the latest failure
// replaces the last one, without a signal.
func (s *apiResourceStore) failed(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.published.Ready && s.published.DiscoveryFailure != nil {
		return
	}
	next := s.published
	next.DiscoveryFailure = err
	s.publishLocked(next)
}

// retainFailedGroups returns fresh with every resource of a failed group taken
// from previous instead, when previous knew that group's resource.
func retainFailedGroups(previous, fresh []APIResource, failed []schema.GroupVersion) []APIResource {
	if len(failed) == 0 {
		return fresh
	}
	failedGroups := failedAPIGroups(failed)
	kept := make(map[schema.GroupResource]struct{})
	merged := make([]APIResource, 0, len(fresh)+len(previous))
	for _, resource := range previous {
		if _, isFailed := failedGroups[resource.Group]; isFailed {
			kept[resource.groupResource()] = struct{}{}
			merged = append(merged, resource)
		}
	}
	for _, resource := range fresh {
		if _, alreadyKept := kept[resource.groupResource()]; !alreadyKept {
			merged = append(merged, resource)
		}
	}
	sortAPIResources(merged)
	return merged
}

func failedAPIGroups(failed []schema.GroupVersion) map[string]struct{} {
	groups := make(map[string]struct{}, len(failed))
	for _, groupVersion := range failed {
		groups[groupVersion.Group] = struct{}{}
	}
	return groups
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

// setWatchedCustomResources receives reflector updates and its complete relists.
func (s *apiResourceStore) setWatchedCustomResources(custom crdDefinitions, listed bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.published.CustomListDenied {
		return
	}
	if listed || s.watchListed {
		s.watchListed = true
		s.publishCustomResourcesLocked(custom, false)
	} else if !s.published.CustomKnown {
		// Before a complete list, keep the flags for definitions seen so far.
		s.publishClassificationLocked(s.published, custom)
	}
}

func (s *apiResourceStore) definitionListDenied() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.published.CustomListDenied
}

func (s *apiResourceStore) publishCustomResourcesLocked(custom crdDefinitions, denied bool) bool {
	next := s.published
	next.CustomKnown = !denied
	next.CustomListDenied = denied
	return s.publishClassificationLocked(next, custom)
}

func (s *apiResourceStore) publishClassificationLocked(next APIResourceInventory, custom crdDefinitions) bool {
	changed := s.observeDefinitionsLocked(custom)
	s.custom = custom
	next.Resources = withCustomResources(next.Resources, custom, nil, !next.CustomListDenied)
	s.publishLocked(next)
	return changed
}

// applyDefinitionList uses the catalog's completed LIST or explicit denial
// until a reflector can supply the live set. Transient errors retain the last answer.
func (s *apiResourceStore) applyDefinitionList(rows []Summary, listed, denied bool) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if denied {
		s.watchListed = false
		s.publishCustomResourcesLocked(nil, true)
		s.pendingDefinitions = nil
		return false
	}
	if s.watchListed || !listed {
		return false
	}
	return s.publishCustomResourcesLocked(listedCustomResources(rows), false)
}

func listedCustomResources(rows []Summary) crdDefinitions {
	custom := make(crdDefinitions, len(rows))
	for _, row := range rows {
		// Kubernetes names every CRD <plural>.<group>.
		plural, group, ok := strings.Cut(row.Ref.Name, ".")
		if ok && plural != "" && group != "" {
			key := schema.GroupResource{Group: group, Resource: plural}
			custom[key] = row.crdDefinition
		}
	}
	return custom
}

func (s *apiResourceStore) observeDefinitionsLocked(current crdDefinitions) bool {
	revision := s.definitionRevision
	s.observeDefinitionWithdrawalsLocked(current)
	for key, after := range current {
		before := s.custom[key]
		if after != nil && after.Established && (before == nil || before.ChangesDiscovery(*after)) {
			s.expectDefinitionLocked(key, before, after)
		}
	}
	return revision != s.definitionRevision
}

func (s *apiResourceStore) observeDefinitionWithdrawalsLocked(current crdDefinitions) {
	for key, before := range s.custom {
		if before == nil || !before.Established {
			continue
		}
		if after, exists := current[key]; !exists {
			delete(s.pendingDefinitions, key)
			s.definitionRevision++
		} else if after != nil && !after.Established {
			s.expectDiscoveryLocked(key, nil)
		}
	}
}

func (s *apiResourceStore) expectDefinitionLocked(key schema.GroupResource, before, after *apiextensions.Definition) {
	if before == nil && len(s.published.FailedGroupVersions) == 0 && s.published.DiscoveryFailure == nil &&
		slices.ContainsFunc(s.published.Resources, func(resource APIResource) bool {
			return resource.groupResource() == key && definitionMatchesDiscovery(*after, resource)
		}) {
		return
	}
	s.expectDiscoveryLocked(key, after)
}

func (s *apiResourceStore) expectDiscoveryLocked(key schema.GroupResource, definition *apiextensions.Definition) {
	if definition != nil && len(definition.ServedVersions()) == 0 {
		definition = nil
	}
	if s.pendingDefinitions == nil {
		s.pendingDefinitions = make(map[schema.GroupResource]definitionExpectation)
	}
	s.definitionRevision++
	s.pendingDefinitions[key] = definitionExpectation{definition: definition, revision: s.definitionRevision}
}

func (run *catalogSync) publishListedDefinitions(complete, denied map[string]struct{}) {
	gvr := apiextensions.Identity.GVR()
	key := gvr.String()
	_, listed := complete[key]
	_, forbidden := denied[gvr.GroupResource().String()]
	preflightDenied := run.preflightDenied(key) && slices.ContainsFunc(run.descriptors, func(desc Descriptor) bool {
		return desc.GVR() == gvr
	})
	if run.service.apiResources.applyDefinitionList(run.succeeded[key], listed, forbidden || preflightDenied) {
		run.service.markDiscoveryStale()
		run.service.requestCatalogRetry()
	}
}

// publishLocked installs next, signalling
// subscribers when the published inventory changed. Before the first
// successful discovery the only change signalled is a discovery failing: a
// reader waiting for discovery must learn that an attempt failed.
func (s *apiResourceStore) publishLocked(next APIResourceInventory) {
	next.Revision = s.published.Revision
	firstDiscovery := next.Ready && !s.published.Ready
	if !firstDiscovery && reflect.DeepEqual(s.published, next) {
		return
	}
	newFailure := next.DiscoveryFailure != nil && s.published.DiscoveryFailure == nil
	if !next.Ready && !newFailure {
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
