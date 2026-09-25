package snapshot

import (
	"context"
	"encoding/json"
	"fmt"
	"hash/fnv"
	"slices"
	"sort"
	"strconv"
	"strings"

	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/luxury-yacht/app/backend/kind/objectmapnode"
	"github.com/luxury-yacht/app/backend/kind/objectmapspec"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/domainpermissions"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/resourcemodel"
)

const clusterIdentitiesDomainName = "cluster-identities"

// ClusterIdentity is an observed User or Group subject, not a Kubernetes resource.
// Bindings identify the real source objects that reference the subject.
type ClusterIdentity struct {
	ClusterID   string                   `json:"clusterId"`
	Kind        string                   `json:"kind"`
	Name        string                   `json:"name"`
	Namespace   string                   `json:"namespace"`
	Bindings    []ClusterIdentityBinding `json:"bindings"`
	GrantScopes []string                 `json:"grantScopes"`
}

type ClusterIdentityBinding struct {
	resourcemodel.ResourceRef
	Role *resourcemodel.ResourceRef `json:"role,omitempty"`
}

type ClusterIdentitiesSnapshot struct {
	ClusterMeta
	ResourceQueryEnvelope
	Rows []ClusterIdentity `json:"rows"`
}

type ClusterIdentitiesBuilder struct {
	allowed       domainpermissions.AllowedResources
	projectedRows func(schema.GroupVersionResource) []interface{}
}

func RegisterClusterIdentitiesDomain(reg *domain.Registry, allowed domainpermissions.AllowedResources, manager *ingest.IngestManager) error {
	if manager == nil {
		return fmt.Errorf("cluster identities ingest manager is nil")
	}
	builder := &ClusterIdentitiesBuilder{allowed: allowed, projectedRows: manager.ObjectMapRows}
	return reg.Register(refresh.DomainConfig{Name: clusterIdentitiesDomainName, BuildSnapshot: builder.Build})
}

func (b *ClusterIdentitiesBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	meta := ClusterMetaFromContext(ctx)
	clusterID, tail := refresh.SplitClusterScope(scope)
	if clusterID == "" || clusterID != meta.ClusterID {
		return nil, fmt.Errorf("identities scope must identify the serving cluster")
	}
	base, query, err := parseTypedTableQueryScope(clusterID, tail, clusterIdentitiesDomainName, "")
	if err != nil {
		return nil, err
	}
	if base != "" {
		return nil, fmt.Errorf("identities scope must be cluster-wide")
	}
	sources := b.sources(ctx)
	rows := b.collect(meta.ClusterID, sources)
	adapter := identitiesQueryAdapter()
	capabilities := newTypedResourceCapabilities(
		[]string{"kind", "name", "namespace", "bindings", "grantScopes"},
		[]string{"kinds", "namespaces", "identity"}, []string{"kind", "name", "namespace", "grantScopes", "bindings"},
		[]string{"User", "Group"},
	)
	resolved := resolveTypedSnapshotPageViaStore(clusterIdentitiesDomainName, rows, query, adapter,
		querypageSchemaFromAdapter(adapter, capabilities.SortableFields),
		newTypedSnapshotPageConfig(capabilities, 1000, "identities", adapter.Kind,
			typedTableQueryResourceIssues(ctx, clusterIdentitiesDomainName, query, sources)))
	return &refresh.Snapshot{
		Domain: clusterIdentitiesDomainName, Scope: scope,
		Payload:        ClusterIdentitiesSnapshot{ClusterMeta: meta, ResourceQueryEnvelope: resolved.Envelope, Rows: resolved.Rows},
		Stats:          resolved.Stats,
		SourceVersions: map[string]string{"object": identitySourceVersion(rows, sources)},
	}, nil
}

// Fingerprint the full, deterministically ordered subject set and source coverage,
// before filtering or paging, so exports detect changes between page requests.
func identitySourceVersion(rows []ClusterIdentity, sources []typedTableResourceSource) string {
	hash := fnv.New64a()
	encoder := json.NewEncoder(hash)
	_ = encoder.Encode(rows)
	_ = encoder.Encode(sources)
	return strconv.FormatUint(hash.Sum64(), 16)
}

func (b *ClusterIdentitiesBuilder) sources(ctx context.Context) []typedTableResourceSource {
	resources := domainpermissions.CompositionByDomain()[clusterIdentitiesDomainName].Runtime
	sources := make([]typedTableResourceSource, 0, len(resources))
	for _, resource := range resources {
		sources = append(sources, typedTableResourceSource{
			Kind: resource.Kind, Group: resource.Group, Resource: resource.Resource,
			State: typedTableSourceState(b.allowed.Allows(resource.Group, resource.Resource)), QueryKinds: []string{"User", "Group"},
		})
	}
	return withTypedTableResourceReadiness(ctx, clusterIdentitiesDomainName, sources)
}

type identityProjection struct {
	ref  resourcemodel.ResourceRef
	node objectmapnode.Node
}

func (b *ClusterIdentitiesBuilder) projections(clusterID string, sources []typedTableResourceSource) []identityProjection {
	var result []identityProjection
	for _, source := range sources {
		if !source.State.servesRows() {
			continue
		}
		for _, value := range b.projectedRows(schema.GroupVersionResource{Group: source.Group, Version: "v1", Resource: source.Resource}) {
			node, ok := value.(objectmapnode.Node)
			if !ok || node.Name == "" {
				continue
			}
			result = append(result, identityProjection{node: node, ref: resourcemodel.ResourceRef{
				ClusterID: clusterID, Group: source.Group, Version: "v1", Kind: source.Kind,
				Resource: source.Resource, Namespace: node.Namespace, Name: node.Name, UID: node.UID,
			}})
		}
	}
	return result
}

func (b *ClusterIdentitiesBuilder) collect(clusterID string, sources []typedTableResourceSource) []ClusterIdentity {
	projections := b.projections(clusterID, sources)
	identities := map[string]*ClusterIdentity{}
	for _, projection := range projections {
		collectIdentityBindings(clusterID, identities, projection)
	}
	rows := make([]ClusterIdentity, 0, len(identities))
	for _, row := range identities {
		sort.Slice(row.Bindings, func(i, j int) bool {
			left, right := row.Bindings[i], row.Bindings[j]
			return clusterTableKey(left.Kind, left.Namespace+"/"+left.Name) < clusterTableKey(right.Kind, right.Namespace+"/"+right.Name)
		})
		sort.Strings(row.GrantScopes)
		rows = append(rows, *row)
	}
	sort.Slice(rows, func(i, j int) bool { return identityRowKey(rows[i]) < identityRowKey(rows[j]) })
	return rows
}

func collectIdentityBindings(clusterID string, identities map[string]*ClusterIdentity, projection identityProjection) {
	seen := map[string]bool{}
	binding := bindingWithRole(clusterID, projection)
	for _, edge := range projection.node.Edges {
		subject := identityFromSubjectLink(clusterID, edge)
		if subject == nil {
			continue
		}
		key := identityRowKey(*subject)
		if seen[key] {
			continue
		}
		seen[key] = true
		appendIdentityBinding(identities, key, subject, binding)
	}
}

func bindingWithRole(clusterID string, projection identityProjection) ClusterIdentityBinding {
	binding := ClusterIdentityBinding{ResourceRef: projection.ref}
	for _, edge := range projection.node.Edges {
		if edge.Type == objectmapspec.EdgeGrants && edge.Link.Ref != nil && edge.Link.Ref.ClusterID == clusterID {
			ref := *edge.Link.Ref
			binding.Role = &ref
			break
		}
	}
	return binding
}

func appendIdentityBinding(identities map[string]*ClusterIdentity, key string, subject *ClusterIdentity, binding ClusterIdentityBinding) {
	existing := identities[key]
	if existing == nil {
		identities[key] = subject
		existing = subject
	}
	existing.Bindings = append(existing.Bindings, binding)
	scope := binding.Namespace
	if scope == "" {
		scope = "Cluster-wide"
	}
	if !slices.Contains(existing.GrantScopes, scope) {
		existing.GrantScopes = append(existing.GrantScopes, scope)
	}
}

func identityFromSubjectLink(clusterID string, edge objectmapspec.Edge) *ClusterIdentity {
	if edge.Type != objectmapspec.EdgeBinds {
		return nil
	}
	if ref := edge.Link.Display; ref != nil && ref.ClusterID == clusterID && (ref.Kind == "User" || ref.Kind == "Group") && ref.Name != "" {
		return newClusterIdentity(clusterID, ref.Kind, "", ref.Name)
	}
	return nil
}

func newClusterIdentity(clusterID, kind, namespace, name string) *ClusterIdentity {
	return &ClusterIdentity{ClusterID: clusterID, Kind: kind, Namespace: namespace, Name: name,
		Bindings: []ClusterIdentityBinding{}, GrantScopes: []string{}}
}

func identityRowKey(row ClusterIdentity) string {
	key, _ := json.Marshal([4]string{row.ClusterID, row.Kind, row.Namespace, row.Name})
	return string(key)
}

func identitiesQueryAdapter() typedTableQueryAdapter[ClusterIdentity] {
	return typedTableQueryAdapter[ClusterIdentity]{
		Key:       identityRowKey,
		Kind:      func(row ClusterIdentity) string { return row.Kind },
		Namespace: func(row ClusterIdentity) string { return row.Namespace },
		SearchText: func(row ClusterIdentity) []string {
			values := []string{row.Kind, row.Name, row.Namespace, strings.Join(row.GrantScopes, " ")}
			for _, binding := range row.Bindings {
				values = append(values, binding.Name)
			}
			return values
		},
		Predicate: func(row ClusterIdentity, field, value string) bool {
			return field != "identity" || identityRowKey(row) == value
		},
		SortValue: identitySortValue,
		NumericSort: func(row ClusterIdentity, field string) (float64, bool) {
			return float64(len(row.Bindings)), field == "bindings"
		},
	}
}

func identitySortValue(row ClusterIdentity, field string) string {
	switch field {
	case "kind":
		return row.Kind
	case "namespace":
		return row.Namespace
	case "grantScopes":
		return strings.Join(row.GrantScopes, ", ")
	default:
		return row.Name
	}
}
