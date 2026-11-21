package snapshot

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/errorstatus"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/apiextensions"
)

// ClusterAPIResourcesDomainName is the API Resources table's refresh domain.
const ClusterAPIResourcesDomainName = "cluster-api-resources"

const (
	apiResourceTypeBuiltIn = "Built-in"
	apiResourceTypeCustom  = "Custom"
	apiResourceScopeNS     = "Namespaced"
	apiResourceScopeAll    = "Cluster"
)

// ClusterAPIResourceEntry describes one kind the cluster serves. It is a
// description of the kind, not a Kubernetes object: Definition is the object to
// open for a custom kind, and a built-in kind has none.
type ClusterAPIResourceEntry struct {
	ClusterID  string   `json:"clusterId"`
	Kind       string   `json:"kind"`
	Group      string   `json:"group"`
	Version    string   `json:"version"`
	APIVersion string   `json:"apiVersion"`
	Versions   []string `json:"versions"`
	Resource   string   `json:"resource"`
	Singular   string   `json:"singular,omitempty"`
	Scope      string   `json:"scope"`
	ShortNames []string `json:"shortNames"`
	Verbs      []string `json:"verbs"`
	Categories []string `json:"categories"`
	// Type is "Built-in" or "Custom"; empty when the identity cannot list
	// CustomResourceDefinitions, so the two cannot be told apart.
	Type       string                     `json:"type"`
	Definition *resourcemodel.ResourceRef `json:"definition,omitempty"`
}

// ClusterAPIResourcesSnapshot is the API Resources table payload.
type ClusterAPIResourcesSnapshot struct {
	ClusterMeta
	ResourceQueryEnvelope
	Rows []ClusterAPIResourceEntry `json:"rows"`
	// UnreadGroups are the API groups the last discovery could not read (the
	// core group is ""), and DiscoveryFailed says it failed outright. A kind
	// with no row is known to be gone only when discovery read its group; the
	// kind panel decides that from these.
	UnreadGroups    []string `json:"unreadGroups,omitempty"`
	DiscoveryFailed bool     `json:"discoveryFailed,omitempty"`
}

// APIResourceSource supplies the discovered API surface; the object catalog
// implements it.
type APIResourceSource interface {
	APIResources() objectcatalog.APIResourceInventory
	SubscribeAPIResources() (<-chan objectcatalog.SubsetUpdate, func())
	LookupObject(namespace, group, kind, name string) objectcatalog.ObjectLookup
}

// ClusterAPIResourcesBuilder serves the API Resources table from the catalog's
// discovered API surface.
type ClusterAPIResourcesBuilder struct {
	source        func() APIResourceSource
	discoveryWait time.Duration
}

// RegisterClusterAPIResourcesDomain registers the API Resources domain.
// catalogService returns the cluster's catalog, or nil while none runs.
func RegisterClusterAPIResourcesDomain(reg *domain.Registry, catalogService func() *objectcatalog.Service) error {
	if reg == nil {
		return errors.New("domain registry is required")
	}
	if catalogService == nil {
		return errors.New("catalog service accessor is required")
	}
	builder := &ClusterAPIResourcesBuilder{
		source: func() APIResourceSource {
			// A nil *Service must stay a nil interface.
			if service := catalogService(); service != nil {
				return service
			}
			return nil
		},
		discoveryWait: config.SnapshotAPIResourcesDiscoveryWait,
	}
	return reg.Register(refresh.DomainConfig{Name: ClusterAPIResourcesDomainName, BuildSnapshot: builder.Build})
}

// Build serves one API Resources page.
func (b *ClusterAPIResourcesBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	meta := ClusterMetaFromContext(ctx)
	clusterID, tail := refresh.SplitClusterScope(scope)
	base, query, err := parseTypedTableQueryScope(clusterID, strings.TrimSpace(tail), ClusterAPIResourcesDomainName, "")
	if err != nil {
		return nil, err
	}
	if base != "" {
		return nil, fmt.Errorf("API resources scope must be cluster-wide")
	}
	source := b.source()
	inventory, err := b.discovered(ctx, source)
	if err != nil {
		return nil, err
	}

	// Whether a kind is custom is known only once the CustomResourceDefinition
	// list has been read, which this identity may not be allowed to do.
	typesKnown := inventory.CustomKnown
	rows := make([]ClusterAPIResourceEntry, 0, len(inventory.Resources))
	for _, resource := range inventory.Resources {
		rows = append(rows, newClusterAPIResourceEntry(meta.ClusterID, resource, typesKnown))
	}
	issues := clusterAPIResourceIssues(inventory)

	adapter := clusterAPIResourcesQueryAdapter()
	capabilities := clusterAPIResourcesQueryCapabilities()
	resolved := resolveTypedSnapshotPageViaStore(ClusterAPIResourcesDomainName, rows, query, adapter,
		querypageSchemaFromAdapter(adapter, lowerTrimAll(capabilities.SortableFields)),
		newTypedSnapshotPageConfig(capabilities, config.SnapshotClusterAPIResourcesEntryLimit, "API resources", adapter.Kind, issues))
	resolveDefinitionAnchor(resolved.Envelope.Anchor, query.Request.Anchor, source)
	return &refresh.Snapshot{
		Domain:  ClusterAPIResourcesDomainName,
		Scope:   scope,
		Version: inventory.Revision,
		Payload: ClusterAPIResourcesSnapshot{
			ClusterMeta: meta, ResourceQueryEnvelope: resolved.Envelope, Rows: resolved.Rows,
			UnreadGroups:    unreadGroups(inventory.FailedGroupVersions),
			DiscoveryFailed: inventory.DiscoveryFailure != nil,
		},
		Stats: resolved.Stats,
	}, nil
}

// resolveDefinitionAnchor checks the same catalog publication that Browse uses,
// including definitions collected by LIST when WATCH is denied.
func resolveDefinitionAnchor(result *ResourceQueryAnchorResult, anchor *ResourceQueryAnchor, source APIResourceSource) {
	if result == nil || anchor == nil || result.Found || result.Reason != ResourceQueryAnchorNotFound {
		return
	}
	identity := apiextensions.Identity
	if anchor.Group != identity.Group || anchor.Version != identity.Version || anchor.Kind != identity.Kind || anchor.Namespace != "" {
		return
	}
	lookup := source.LookupObject(anchor.Namespace, anchor.Group, anchor.Kind, anchor.Name)
	switch {
	case lookup.Found && (anchor.UID == "" || anchor.UID == lookup.Summary.Ref.UID):
		result.Reason = ResourceQueryAnchorUnlisted
	case !lookup.Found && !lookup.Absent:
		result.Reason = ResourceQueryAnchorUnavailable
	}
}

// clusterAPIResourceIssues reports what makes the served inventory less than
// complete: an unknown custom/built-in classification, and group versions the
// last discovery could not read.
func clusterAPIResourceIssues(inventory objectcatalog.APIResourceInventory) []ResourceQueryIssue {
	var issues []ResourceQueryIssue
	switch {
	case inventory.CustomListDenied:
		issues = append(issues, ResourceQueryIssue{
			Kind:    apiextensions.Identity.Kind,
			Message: "CustomResourceDefinitions cannot be listed, so custom kinds cannot be told apart from built-in kinds",
		})
	case !inventory.CustomKnown:
		issues = append(issues, ResourceQueryIssue{
			Kind:    apiextensions.Identity.Kind,
			Message: "CustomResourceDefinitions are still being listed; custom and built-in kinds are told apart once that finishes",
		})
	}
	switch {
	case inventory.DiscoveryFailure != nil:
		issues = append(issues, ResourceQueryIssue{
			Kind: "API discovery",
			Message: fmt.Sprintf("API discovery failed (%s). Kinds are shown as last discovered and may be missing or out of date",
				inventory.DiscoveryFailure),
		})
	case len(inventory.FailedGroupVersions) > 0:
		issues = append(issues, ResourceQueryIssue{
			Kind: "API discovery",
			Message: fmt.Sprintf("These API groups could not be read: %s. Their kinds are shown as last discovered and may be missing or out of date",
				strings.Join(inventory.FailedGroupVersions, ", ")),
		})
	}
	return issues
}

// unreadGroups are the API groups of the group versions discovery could not
// read, sorted, with the core group as "".
func unreadGroups(failedGroupVersions []string) []string {
	if len(failedGroupVersions) == 0 {
		return nil
	}
	groups := make(map[string]struct{}, len(failedGroupVersions))
	for _, name := range failedGroupVersions {
		groupVersion, err := schema.ParseGroupVersion(name)
		if err != nil {
			continue
		}
		groups[groupVersion.Group] = struct{}{}
	}
	sorted := make([]string, 0, len(groups))
	for group := range groups {
		sorted = append(sorted, group)
	}
	sort.Strings(sorted)
	return sorted
}

// discovered returns the cluster's API surface, waiting a bounded time for the
// first discovery so a view opened right after connecting loads instead of
// rendering an empty table. A first discovery that failed ends the wait with
// its failure; only a discovery still pending reads as "not ready".
func (b *ClusterAPIResourcesBuilder) discovered(ctx context.Context, source APIResourceSource) (objectcatalog.APIResourceInventory, error) {
	if source == nil {
		return objectcatalog.APIResourceInventory{}, errorstatus.ClusterNotReady(errors.New("object catalog service unavailable"))
	}
	// Subscribe before reading, so a discovery that completes in between is seen.
	updates, cancel := source.SubscribeAPIResources()
	defer cancel()
	if inventory, settled, err := discoveryOutcome(source.APIResources()); settled {
		return inventory, err
	}
	timer := time.NewTimer(b.discoveryWait)
	defer timer.Stop()
	select {
	case <-updates:
	case <-timer.C:
	case <-ctx.Done():
		return objectcatalog.APIResourceInventory{}, ctx.Err()
	}
	if inventory, settled, err := discoveryOutcome(source.APIResources()); settled {
		return inventory, err
	}
	return objectcatalog.APIResourceInventory{}, errorstatus.ClusterNotReady(errors.New("API discovery has not completed"))
}

// discoveryOutcome reports whether discovery has an answer for a read: the
// inventory, or the failure of a first discovery that failed. Without either
// (settled false), discovery is still pending. The failure keeps its type, so
// a denied discovery is reported as a permission error and not as a cluster
// that is still starting.
func discoveryOutcome(inventory objectcatalog.APIResourceInventory) (objectcatalog.APIResourceInventory, bool, error) {
	if inventory.Ready {
		return inventory, true, nil
	}
	if inventory.DiscoveryFailure != nil {
		return objectcatalog.APIResourceInventory{}, true, fmt.Errorf("API discovery failed: %w", inventory.DiscoveryFailure)
	}
	return objectcatalog.APIResourceInventory{}, false, nil
}

// newClusterAPIResourceEntry describes one kind. typesKnown says whether the
// custom/built-in classification can be trusted; when it cannot, the row has
// no Type and offers no definition to open.
func newClusterAPIResourceEntry(clusterID string, resource objectcatalog.APIResource, typesKnown bool) ClusterAPIResourceEntry {
	entry := ClusterAPIResourceEntry{
		ClusterID:  clusterID,
		Kind:       resource.Kind,
		Group:      resource.Group,
		Version:    resource.Version,
		APIVersion: resource.Version,
		Versions:   nonNilStrings(resource.Versions),
		Resource:   resource.Resource,
		Singular:   resource.Singular,
		Scope:      apiResourceScopeAll,
		ShortNames: nonNilStrings(resource.ShortNames),
		Verbs:      nonNilStrings(resource.Verbs),
		Categories: nonNilStrings(resource.Categories),
	}
	if resource.Group != "" {
		entry.APIVersion = resource.Group + "/" + resource.Version
	}
	if resource.Namespaced {
		entry.Scope = apiResourceScopeNS
	}
	switch {
	case !typesKnown:
	case resource.Custom:
		entry.Type = apiResourceTypeCustom
		definition := resourcemodel.NewResourceRef(resourcemodel.ResourceRef{
			ClusterID: clusterID,
			Group:     apiextensions.Identity.Group,
			Version:   apiextensions.Identity.Version,
			Kind:      apiextensions.Identity.Kind,
			Resource:  apiextensions.Identity.Resource,
			Name:      apiResourceName(resource.Group, resource.Resource),
		})
		entry.Definition = &definition
	default:
		entry.Type = apiResourceTypeBuiltIn
	}
	return entry
}

// nonNilStrings keeps list fields as JSON arrays, never null.
func nonNilStrings(values []string) []string {
	if values == nil {
		return []string{}
	}
	return values
}

// apiResourceName is a resource's fully qualified name, `<plural>.<group>`
// (just `<plural>` in the core group): the name kubectl accepts and the name of
// the CustomResourceDefinition that defines a custom resource.
func apiResourceName(group, resource string) string {
	if group == "" {
		return resource
	}
	return resource + "." + group
}

func clusterAPIResourcesQueryCapabilities() ResourceQueryCapabilities {
	adapter := clusterAPIResourcesQueryAdapter()
	return newTypedResourceCapabilities(
		[]string{"kind", "name", "shortNames", "apiVersion", "scope", "type"},
		[]string{},
		[]string{"kind", "name", "group", "shortNames"},
		nil,
		typedTableFacetDescriptors(adapter.Facets)...,
	)
}

func clusterAPIResourcesQueryAdapter() typedTableQueryAdapter[ClusterAPIResourceEntry] {
	return typedTableQueryAdapter[ClusterAPIResourceEntry]{
		Key: func(row ClusterAPIResourceEntry) string {
			return strings.ToLower(apiResourceName(row.Group, row.Resource))
		},
		// "Show in list" on a CustomResourceDefinition lands on the kind it
		// defines: a definition is named for its resource, which is the row key.
		// No other kind of object has a row here.
		AnchorKey: func(kind, _, name string) string {
			if kind != apiextensions.Identity.Kind {
				return ""
			}
			return strings.ToLower(strings.TrimSpace(name))
		},
		Namespace: func(ClusterAPIResourceEntry) string { return "" },
		Kind:      func(row ClusterAPIResourceEntry) string { return row.Kind },
		Facets: []typedTableQueryFacet[ClusterAPIResourceEntry]{
			{
				Descriptor: ResourceQueryFacetDescriptor{Key: "types", Label: "Type", Placeholder: "All types"},
				Value:      func(row ClusterAPIResourceEntry) string { return row.Type },
			},
			{
				Descriptor: ResourceQueryFacetDescriptor{Key: "scopes", Label: "Scope", Placeholder: "All scopes"},
				Value:      func(row ClusterAPIResourceEntry) string { return row.Scope },
			},
		},
		// The fully qualified name is one element so a search for it, as kubectl
		// prints it or as a definition is named, matches.
		SearchText: func(row ClusterAPIResourceEntry) []string {
			return append([]string{row.Kind, apiResourceName(row.Group, row.Resource), row.Group}, row.ShortNames...)
		},
		// The kind panel selects its one row by fully qualified resource name.
		Predicate: func(row ClusterAPIResourceEntry, field, value string) bool {
			return field != "resource" || strings.EqualFold(apiResourceName(row.Group, row.Resource), strings.TrimSpace(value))
		},
		SortValue: clusterAPIResourceSortValue,
		// Every column sorts as text.
		NumericSort: func(ClusterAPIResourceEntry, string) (float64, bool) { return 0, false },
	}
}

func clusterAPIResourceSortValue(row ClusterAPIResourceEntry, field string) string {
	switch strings.ToLower(field) {
	case "kind":
		return row.Kind
	case "shortnames":
		return strings.Join(row.ShortNames, ", ")
	case "apiversion":
		return row.APIVersion
	case "scope":
		return row.Scope
	case "type":
		return row.Type
	default:
		return row.Resource
	}
}
