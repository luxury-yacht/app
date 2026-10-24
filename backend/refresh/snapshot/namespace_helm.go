package snapshot

import (
	"context"
	"sort"
	"strings"
	"time"

	"helm.sh/helm/v3/pkg/release"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/doorbell"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/querypage"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/helm"
	"github.com/luxury-yacht/app/backend/resources/secret"
)

const namespaceHelmDomainName = "namespace-helm"

// NamespaceHelmSnapshot payload returned to the frontend.
type NamespaceHelmSnapshot struct {
	ClusterMeta
	ResourceQueryEnvelope
	Rows []NamespaceHelmSummary `json:"rows"`
}

// NamespaceHelmSummary captures the fields required by the Helm table.
type NamespaceHelmSummary struct {
	Ref                resourcemodel.ResourceRef `json:"ref"`
	Chart              string                    `json:"chart"`
	AppVersion         string                    `json:"appVersion"`
	Status             string                    `json:"status"`
	StatusState        string                    `json:"statusState,omitempty"`
	StatusPresentation string                    `json:"statusPresentation,omitempty"`
	StatusReason       string                    `json:"statusReason,omitempty"`
	Revision           int                       `json:"revision"`
	Updated            string                    `json:"updated"`
	Description        string                    `json:"description,omitempty"`
	Age                string                    `json:"age"`
	AgeTimestamp       int64                     `json:"ageTimestamp,omitempty"`
}

func namespaceHelmQueryCapabilities() ResourceQueryCapabilities {
	return newTypedResourceCapabilities(
		[]string{"name", "kind", "namespace", "chart", "appVersion", "status", "revision", "updated", "age"},
		[]string{"kinds", "namespaces"},
		[]string{"name", "namespace", "chart", "appVersion", "status", "description"},
		[]string{"HelmRelease"},
	)
}

// helmQuerypageSchema derives the querypage Schema for the helm table from its
// typed-table adapter (reusing the adapter's exact sort encoder + row key), so the
// engine orders rows byte-identically to the live executor. The sort-field names are
// lowercased to match how applyTypedTableQueryViaStore looks them up
// (strings.ToLower(SortField)); "appversion" is the only field whose request name is
// camelCase ("appVersion"), so a verbatim key would miss and the engine would fall
// back to name order.
func helmQuerypageSchema() querypage.Schema[NamespaceHelmSummary] {
	return querypageSchemaFromAdapter(helmTableQueryAdapter(), lowerTrimAll(namespaceHelmQueryCapabilities().SortableFields))
}

// helmAvailableKinds is the single-kind availability set the maintained store filters by:
// every helm row's Kind is the synthesized "HelmRelease".
var helmAvailableKinds = map[string]bool{"HelmRelease": true}

// RegisterNamespaceHelmDomain registers the namespace helm domain. It serves
// synthesized HelmRelease rows from a maintained store that a sink on the
// Secrets ingest store keeps current (namespace_helm_feed.go), so Build reads
// rows from RAM instead of decoding release Secrets per request.
// ingestManager is nil in unit tests that feed the store directly.
//
// The store is not spilled. A re-warm rebuilds it from the restored Secrets
// bundles, which the feed receives as a seed.
func RegisterNamespaceHelmDomain(
	reg *domain.Registry,
	ingestManager *ingest.IngestManager,
	clusterMeta ClusterMeta,
	bell doorbell.Bell,
) error {
	builder := newNamespaceHelmBuilder(clusterMeta)
	if ingestManager != nil {
		ingestManager.AddBundleSink(secret.Identity.GVR(), newHelmReleaseFeed(builder.maintained, clusterMeta, bell))
	}
	return reg.Register(refresh.DomainConfig{
		Name:          namespaceHelmDomainName,
		BuildSnapshot: builder.Build,
	})
}

// NamespaceHelmBuilder serves the Helm releases table from its maintained
// store of synthesized HelmRelease rows.
type NamespaceHelmBuilder struct {
	maintained *typedMaintainedStore[NamespaceHelmSummary]
}

func newNamespaceHelmBuilder(meta ClusterMeta) *NamespaceHelmBuilder {
	return &NamespaceHelmBuilder{maintained: newTypedMaintainedStore(meta, helmQuerypageSchema(), helmTableQueryAdapter())}
}

func (b *NamespaceHelmBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	meta := ClusterMetaFromContext(ctx)
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	baseScope, query, err := parseTypedTableQueryScope(clusterID, strings.TrimSpace(trimmed), namespaceHelmDomainName, "")
	if err != nil {
		return nil, err
	}
	parsedScope, err := parseNamespaceSnapshotScope(namespaceHelmDomainName, clusterID, baseScope, "namespace scope is required")
	if err != nil {
		return nil, err
	}

	namespaceFilter := parsedScope.Namespace
	if parsedScope.AllNamespaces {
		namespaceFilter = ""
	}

	summaries := b.maintained.rows(namespaceFilter, helmAvailableKinds)
	version := b.maintained.snapshotVersion()
	// Builds must be deterministic for stable snapshot checksums.
	sort.Slice(summaries, func(i, j int) bool {
		if summaries[i].Ref.Namespace == summaries[j].Ref.Namespace {
			return summaries[i].Ref.Name < summaries[j].Ref.Name
		}
		return summaries[i].Ref.Namespace < summaries[j].Ref.Namespace
	})

	snapshotScope := refresh.JoinClusterScope(clusterID, strings.TrimSpace(trimmed))
	resolved := resolveTypedSnapshotPageViaStore(
		namespaceHelmDomainName,
		summaries,
		query,
		helmTableQueryAdapter(),
		helmQuerypageSchema(),
		newTypedSnapshotPageConfig(
			namespaceHelmQueryCapabilities(),
			config.SnapshotNamespaceHelmEntryLimit,
			"Helm releases",
			func(NamespaceHelmSummary) string { return "HelmRelease" },
			nil,
		),
	)

	return &refresh.Snapshot{
		Domain:  namespaceHelmDomainName,
		Scope:   snapshotScope,
		Version: version,
		Payload: NamespaceHelmSnapshot{
			ClusterMeta:           meta,
			ResourceQueryEnvelope: resolved.Envelope,
			Rows:                  resolved.Rows,
		},
		Stats: resolved.Stats,
	}, nil
}

func mapHelmRelease(release *release.Release, namespaceFilter string, meta ClusterMeta) (NamespaceHelmSummary, bool) {
	if release == nil {
		return NamespaceHelmSummary{}, false
	}
	namespace := release.Namespace
	if namespace == "" && namespaceFilter != "" {
		namespace = namespaceFilter
	}
	if namespaceFilter != "" && namespace != namespaceFilter {
		return NamespaceHelmSummary{}, false
	}
	helmOpts := resourcemodel.ResourceModelBuildOptions{Materialization: resourcemodel.MaterializeSummaryFacts}
	model := helm.BuildResourceModel(meta.ClusterID, release, namespaceFilter)
	facts := helm.BuildFacts(release, nil, helmOpts)
	updated := ""
	if facts.Updated != nil && !facts.Updated.IsZero() {
		updated = facts.Updated.Time.Format(time.RFC3339)
	}
	age := ""
	ageTimestamp := int64(0)
	if !model.Metadata.CreationTimestamp.IsZero() {
		age = formatAge(model.Metadata.CreationTimestamp.Time)
		ageTimestamp = model.Metadata.CreationTimestamp.UnixMilli()
	}
	return NamespaceHelmSummary{
		Ref:                model.Ref,
		Chart:              facts.Chart,
		AppVersion:         facts.AppVersion,
		Status:             model.Status.Label,
		StatusState:        model.Status.State,
		StatusPresentation: model.Status.Presentation,
		StatusReason:       model.Status.Reason,
		Revision:           release.Version,
		Updated:            updated,
		Description:        facts.Description,
		Age:                age,
		AgeTimestamp:       ageTimestamp,
	}, true
}
