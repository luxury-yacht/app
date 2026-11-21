package snapshot

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/errorstatus"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
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
}

// APIResourceSource supplies the discovered API surface; the object catalog
// implements it.
type APIResourceSource interface {
	APIResources() ([]objectcatalog.APIResource, uint64, bool)
	SubscribeAPIResources() (<-chan objectcatalog.SubsetUpdate, func())
}

// ClusterAPIResourcesBuilder serves the API Resources table from the catalog's
// discovered API surface.
type ClusterAPIResourcesBuilder struct {
	source            func() APIResourceSource
	definitionsDenied func() bool
	discoveryWait     time.Duration
}

// RegisterClusterAPIResourcesDomain registers the API Resources domain.
// catalogService returns the cluster's catalog, or nil while none runs.
// ingestManager says whether this identity may list CustomResourceDefinitions;
// it is nil in unit tests.
func RegisterClusterAPIResourcesDomain(reg *domain.Registry, catalogService func() *objectcatalog.Service, ingestManager *ingest.IngestManager) error {
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
		definitionsDenied: func() bool {
			return ingestManager != nil && ingestManager.PermissionSkippedFor(apiextensions.Identity.GVR())
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
	discovered, revision, err := b.discovered(ctx)
	if err != nil {
		return nil, err
	}

	definitionsDenied := b.definitionsDenied()
	rows := make([]ClusterAPIResourceEntry, 0, len(discovered))
	for _, resource := range discovered {
		rows = append(rows, newClusterAPIResourceEntry(meta.ClusterID, resource, definitionsDenied))
	}
	var issues []ResourceQueryIssue
	if definitionsDenied {
		issues = append(issues, ResourceQueryIssue{
			Kind:    apiextensions.Identity.Kind,
			Message: "CustomResourceDefinitions cannot be listed, so custom kinds cannot be told apart from built-in kinds",
		})
	}

	adapter := clusterAPIResourcesQueryAdapter()
	capabilities := clusterAPIResourcesQueryCapabilities()
	resolved := resolveTypedSnapshotPageViaStore(ClusterAPIResourcesDomainName, rows, query, adapter,
		querypageSchemaFromAdapter(adapter, lowerTrimAll(capabilities.SortableFields)),
		newTypedSnapshotPageConfig(capabilities, config.SnapshotClusterAPIResourcesEntryLimit, "API resources", adapter.Kind, issues))
	return &refresh.Snapshot{
		Domain:  ClusterAPIResourcesDomainName,
		Scope:   scope,
		Version: revision,
		Payload: ClusterAPIResourcesSnapshot{ClusterMeta: meta, ResourceQueryEnvelope: resolved.Envelope, Rows: resolved.Rows},
		Stats:   resolved.Stats,
	}, nil
}

// discovered returns the cluster's API surface, waiting a bounded time for the
// first discovery so a view opened right after connecting loads instead of
// rendering an empty table.
func (b *ClusterAPIResourcesBuilder) discovered(ctx context.Context) ([]objectcatalog.APIResource, uint64, error) {
	source := b.source()
	if source == nil {
		return nil, 0, errorstatus.ClusterNotReady(errors.New("object catalog service unavailable"))
	}
	// Subscribe before reading, so a discovery that completes in between is seen.
	updates, cancel := source.SubscribeAPIResources()
	defer cancel()
	if resources, revision, ready := source.APIResources(); ready {
		return resources, revision, nil
	}
	timer := time.NewTimer(b.discoveryWait)
	defer timer.Stop()
	select {
	case <-updates:
	case <-timer.C:
	case <-ctx.Done():
		return nil, 0, ctx.Err()
	}
	if resources, revision, ready := source.APIResources(); ready {
		return resources, revision, nil
	}
	return nil, 0, errorstatus.ClusterNotReady(errors.New("API discovery has not completed"))
}

func newClusterAPIResourceEntry(clusterID string, resource objectcatalog.APIResource, definitionsDenied bool) ClusterAPIResourceEntry {
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
	case definitionsDenied:
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
		SearchText: func(row ClusterAPIResourceEntry) []string {
			return append([]string{row.Kind, row.Resource, row.Group}, row.ShortNames...)
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
