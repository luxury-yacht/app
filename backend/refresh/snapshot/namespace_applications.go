package snapshot

import (
	"context"
	"sort"
	"strings"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/querypage"
	"github.com/luxury-yacht/app/backend/resourcekind"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/configmap"
	podres "github.com/luxury-yacht/app/backend/resources/pods"
	"github.com/luxury-yacht/app/backend/resources/secret"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

const namespaceApplicationsDomainName = "namespace-applications"

var (
	ConfigMapGVR = schema.GroupVersionResource{Group: configmap.Identity.Group, Version: configmap.Identity.Version, Resource: configmap.Identity.Resource}
	SecretGVR    = schema.GroupVersionResource{Group: secret.Identity.Group, Version: secret.Identity.Version, Resource: secret.Identity.Resource}
)

// applicationMemberAggregate is the compact workload half retained by ingest
// for application grouping. Ref remains the canonical member identity; Candidate
// carries only the selected grouping signal.
type applicationMemberAggregate struct {
	Ref          resourcemodel.ResourceRef
	Candidate    resourcemodel.ApplicationCandidate
	Presentation string
}

func newApplicationMemberAggregate(clusterID string, identity resourcekind.Identity, obj metav1.Object, presentation string) applicationMemberAggregate {
	candidate, _ := resourcemodel.ApplicationCandidateForObject(clusterID, obj)
	return applicationMemberAggregate{
		Ref: resourcemodel.NewResourceRef(
			clusterID,
			identity.Group,
			identity.Version,
			identity.Kind,
			identity.Resource,
			obj.GetNamespace(),
			obj.GetName(),
			string(obj.GetUID()),
		),
		Candidate:    candidate,
		Presentation: presentation,
	}
}

type applicationAggregateSource interface {
	AggregateRows(gvr schema.GroupVersionResource) []interface{}
	StoreResourceVersion(gvr schema.GroupVersionResource) string
}

// NamespaceApplicationsSnapshot is the query-backed application grouping lens.
type NamespaceApplicationsSnapshot struct {
	ClusterMeta
	ResourceQueryEnvelope
	Rows               []NamespaceApplicationSummary `json:"rows"`
	UngroupedWorkloads int                           `json:"ungroupedWorkloads"`
}

// NamespaceApplicationSummary is one confidence-bearing group. Root is absent
// for grouping-only evidence and complete for navigable Helm/owner roots.
type NamespaceApplicationSummary struct {
	ClusterMeta
	Kind               string                              `json:"kind"`
	Name               string                              `json:"name"`
	Namespace          string                              `json:"namespace"`
	Confidence         resourcemodel.ApplicationConfidence `json:"confidence"`
	Evidence           []resourcemodel.ApplicationEvidence `json:"evidence"`
	Root               *resourcemodel.ResourceRef          `json:"root,omitempty"`
	WorkloadCount      int                                 `json:"workloadCount"`
	NeedsAttention     int                                 `json:"needsAttention"`
	WorkloadKinds      []string                            `json:"workloadKinds,omitempty"`
	Status             string                              `json:"status"`
	StatusPresentation string                              `json:"statusPresentation"`
}

type NamespaceApplicationsBuilder struct {
	aggregates  applicationAggregateSource
	permissions NamespaceApplicationsPermissions
}

// NamespaceApplicationsPermissions records which contributing resource stores
// were admitted by the registration permission gate.
type NamespaceApplicationsPermissions struct {
	IncludePods         bool
	IncludeDeployments  bool
	IncludeStatefulSets bool
	IncludeDaemonSets   bool
	IncludeJobs         bool
	IncludeCronJobs     bool
	IncludeConfigMaps   bool
	IncludeSecrets      bool
}

// RegisterNamespaceApplicationsDomain wires the application grouping lens to
// the same compact ingest aggregates that own its workload and Helm evidence.
func RegisterNamespaceApplicationsDomain(
	reg *domain.Registry,
	aggregates *ingest.IngestManager,
	permissions NamespaceApplicationsPermissions,
) error {
	builder := &NamespaceApplicationsBuilder{aggregates: aggregates, permissions: permissions}
	return reg.Register(refresh.DomainConfig{
		Name:          namespaceApplicationsDomainName,
		BuildSnapshot: builder.Build,
	})
}

func namespaceApplicationsQueryCapabilities() ResourceQueryCapabilities {
	return newTypedResourceCapabilities(
		[]string{"name", "kind", "namespace", "confidence", "status", "workloadCount", "needsAttention"},
		[]string{"kinds", "namespaces"},
		[]string{"name", "namespace", "confidence", "status", "workloadKinds"},
		[]string{"Application"},
	)
}

func namespaceApplicationsQuerypageSchema() querypage.Schema[NamespaceApplicationSummary] {
	return querypageSchemaFromAdapter(
		namespaceApplicationsTableQueryAdapter(),
		[]string{"name", "kind", "namespace", "confidence", "status", "workloadcount", "needsattention"},
	)
}

func namespaceApplicationsTableQueryAdapter() typedTableQueryAdapter[NamespaceApplicationSummary] {
	return typedTableQueryAdapter[NamespaceApplicationSummary]{
		Key: func(row NamespaceApplicationSummary) string {
			return row.Namespace + "/" + row.Name
		},
		Namespace: func(row NamespaceApplicationSummary) string { return row.Namespace },
		Kind:      func(NamespaceApplicationSummary) string { return "Application" },
		SearchText: func(row NamespaceApplicationSummary) []string {
			values := []string{row.Name, row.Namespace, string(row.Confidence), row.Status}
			values = append(values, row.WorkloadKinds...)
			for _, evidence := range row.Evidence {
				values = append(values, string(evidence))
			}
			return values
		},
		Predicate: func(row NamespaceApplicationSummary, field, value string) bool {
			switch strings.ToLower(strings.TrimSpace(field)) {
			case "confidence":
				return strings.EqualFold(string(row.Confidence), value)
			case "status":
				return strings.EqualFold(row.StatusPresentation, value) || strings.EqualFold(row.Status, value)
			case "evidence":
				for _, evidence := range row.Evidence {
					if strings.EqualFold(string(evidence), value) {
						return true
					}
				}
			}
			return false
		},
		SortValue: func(row NamespaceApplicationSummary, field string) string {
			switch strings.ToLower(strings.TrimSpace(field)) {
			case "kind":
				return "application"
			case "namespace":
				return row.Namespace
			case "confidence":
				return applicationConfidenceSortValue(row.Confidence)
			case "status":
				return row.Status
			default:
				return row.Name
			}
		},
		NumericSort: func(row NamespaceApplicationSummary, field string) (float64, bool) {
			switch strings.ToLower(strings.TrimSpace(field)) {
			case "workloadcount":
				return float64(row.WorkloadCount), true
			case "needsattention":
				return float64(row.NeedsAttention), true
			default:
				return 0, false
			}
		},
	}
}

func applicationConfidenceSortValue(confidence resourcemodel.ApplicationConfidence) string {
	switch confidence {
	case resourcemodel.ApplicationConfidenceHigh:
		return "1-high"
	case resourcemodel.ApplicationConfidenceMedium:
		return "2-medium"
	default:
		return "3-low"
	}
}

func (b *NamespaceApplicationsBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	meta := ClusterMetaFromContext(ctx)
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	baseScope, query, err := parseTypedTableQueryScope(clusterID, strings.TrimSpace(trimmed), namespaceApplicationsDomainName, "")
	if err != nil {
		return nil, err
	}
	parsedScope, err := parseNamespaceSnapshotScope(refresh.JoinClusterScope(clusterID, baseScope), "namespace scope is required")
	if err != nil {
		return nil, err
	}
	namespace := parsedScope.Namespace
	if parsedScope.AllNamespaces {
		namespace = ""
	}
	sources := b.resourceSources()
	rows, ungrouped := buildNamespaceApplicationGroups(meta, namespace, b.aggregates, b.allowedGVRs(ctx, sources))
	version := namespaceWorkloadIngestVersion(
		b.aggregates,
		DeploymentGVR, StatefulSetGVR, DaemonSetGVR, JobGVR, CronJobGVR, PodGVR, ConfigMapGVR, SecretGVR,
	)
	resolved := resolveTypedSnapshotPageViaStore(
		namespaceApplicationsDomainName,
		rows,
		query,
		namespaceApplicationsTableQueryAdapter(),
		namespaceApplicationsQuerypageSchema(),
		namespaceApplicationsQueryCapabilities(),
		config.SnapshotNamespaceWorkloadsEntryLimit,
		"applications",
		func(NamespaceApplicationSummary) string { return "Application" },
		typedTableQueryResourceIssues(ctx, namespaceApplicationsDomainName, query, sources),
	)
	return &refresh.Snapshot{
		Domain:  namespaceApplicationsDomainName,
		Scope:   refresh.JoinClusterScope(clusterID, strings.TrimSpace(trimmed)),
		Version: version,
		Payload: NamespaceApplicationsSnapshot{
			ClusterMeta:           meta,
			ResourceQueryEnvelope: resolved.Envelope,
			Rows:                  resolved.Rows,
			UngroupedWorkloads:    ungrouped,
		},
		Stats: resolved.Stats,
	}, nil
}

type applicationGroupAccumulator struct {
	row          NamespaceApplicationSummary
	evidence     map[resourcemodel.ApplicationEvidence]struct{}
	kinds        map[string]struct{}
	presentation string
}

func buildNamespaceApplicationGroups(meta ClusterMeta, namespace string, source applicationAggregateSource, allowed map[schema.GroupVersionResource]bool) ([]NamespaceApplicationSummary, int) {
	activeHelm := activeHelmReleaseCandidates(namespace, source, allowed)
	groups := make(map[string]*applicationGroupAccumulator)
	for key, release := range activeHelm {
		root := resourcemodel.NewResourceRef(meta.ClusterID, "helm.sh", "v3", "HelmRelease", "helmreleases", release.Namespace, release.Name, "")
		groups[key] = &applicationGroupAccumulator{
			row: NamespaceApplicationSummary{
				ClusterMeta: meta,
				Kind:        "Application",
				Name:        release.Name,
				Namespace:   release.Namespace,
				Confidence:  resourcemodel.ApplicationConfidenceHigh,
				Root:        &root,
			},
			evidence:     map[resourcemodel.ApplicationEvidence]struct{}{resourcemodel.ApplicationEvidenceHelm: {}},
			kinds:        map[string]struct{}{},
			presentation: helmReleasePresentation(release.Status),
		}
	}

	ungrouped := 0
	for _, gvr := range []schema.GroupVersionResource{DeploymentGVR, StatefulSetGVR, DaemonSetGVR, JobGVR, CronJobGVR} {
		if !allowed[gvr] {
			continue
		}
		for _, raw := range aggregateRows(source, gvr) {
			member, ok := raw.(applicationMemberAggregate)
			if !ok || (namespace != "" && member.Ref.Namespace != namespace) {
				continue
			}
			if strings.TrimSpace(member.Candidate.Name) == "" {
				ungrouped++
				continue
			}
			addApplicationMember(groups, meta, member, activeHelm)
		}
	}
	if allowed[PodGVR] {
		for _, raw := range aggregateRows(source, PodGVR) {
			pod, ok := raw.(streamrows.PodAggregate)
			if !ok || pod.OwnerKey != "" || pod.Phase == string(corev1.PodSucceeded) || pod.Phase == string(corev1.PodFailed) || (namespace != "" && pod.Namespace != namespace) {
				continue
			}
			member := applicationMemberAggregate{
				Ref:          resourcemodel.NewResourceRef(meta.ClusterID, podres.Identity.Group, podres.Identity.Version, podres.Identity.Kind, podres.Identity.Resource, pod.Namespace, pod.Name, ""),
				Candidate:    pod.Application,
				Presentation: pod.StatusPresentation,
			}
			if strings.TrimSpace(member.Candidate.Name) == "" {
				ungrouped++
				continue
			}
			addApplicationMember(groups, meta, member, activeHelm)
		}
	}

	rows := make([]NamespaceApplicationSummary, 0, len(groups))
	for _, group := range groups {
		group.row.Evidence = sortedApplicationEvidence(group.evidence)
		group.row.WorkloadKinds = sortedStringSet(group.kinds)
		group.row.Status, group.row.StatusPresentation = applicationGroupStatus(group.presentation, group.row.NeedsAttention)
		rows = append(rows, group.row)
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].Namespace == rows[j].Namespace {
			return rows[i].Name < rows[j].Name
		}
		return rows[i].Namespace < rows[j].Namespace
	})
	return rows, ungrouped
}

func aggregateRows(source applicationAggregateSource, gvr schema.GroupVersionResource) []interface{} {
	if source == nil {
		return nil
	}
	return source.AggregateRows(gvr)
}

func activeHelmReleaseCandidates(namespace string, source applicationAggregateSource, allowed map[schema.GroupVersionResource]bool) map[string]resourcemodel.HelmReleaseStorageCandidate {
	latest := make(map[string]resourcemodel.HelmReleaseStorageCandidate)
	for _, gvr := range []schema.GroupVersionResource{SecretGVR, ConfigMapGVR} {
		if !allowed[gvr] {
			continue
		}
		for _, raw := range aggregateRows(source, gvr) {
			release, ok := raw.(resourcemodel.HelmReleaseStorageCandidate)
			if !ok || release.Name == "" || (namespace != "" && release.Namespace != namespace) {
				continue
			}
			key := release.Namespace + "/" + release.Name
			if current, exists := latest[key]; !exists || release.Revision > current.Revision {
				latest[key] = release
			}
		}
	}
	for key, release := range latest {
		if release.Status == "superseded" || release.Status == "uninstalled" {
			delete(latest, key)
		}
	}
	return latest
}

func (b *NamespaceApplicationsBuilder) resourceSources() []typedTableResourceSource {
	return []typedTableResourceSource{
		{Kind: podres.Identity.Kind, Group: "", Resource: "pods", Available: b.permissions.IncludePods, QueryKinds: []string{"Application"}},
		{Kind: "Deployment", Group: "apps", Resource: "deployments", Available: b.permissions.IncludeDeployments, QueryKinds: []string{"Application"}},
		{Kind: "StatefulSet", Group: "apps", Resource: "statefulsets", Available: b.permissions.IncludeStatefulSets, QueryKinds: []string{"Application"}},
		{Kind: "DaemonSet", Group: "apps", Resource: "daemonsets", Available: b.permissions.IncludeDaemonSets, QueryKinds: []string{"Application"}},
		{Kind: "Job", Group: "batch", Resource: "jobs", Available: b.permissions.IncludeJobs, QueryKinds: []string{"Application"}},
		{Kind: "CronJob", Group: "batch", Resource: "cronjobs", Available: b.permissions.IncludeCronJobs, QueryKinds: []string{"Application"}},
		{Kind: configmap.Identity.Kind, Group: "", Resource: "configmaps", Available: b.permissions.IncludeConfigMaps, QueryKinds: []string{"Application"}},
		{Kind: secret.Identity.Kind, Group: "", Resource: "secrets", Available: b.permissions.IncludeSecrets, QueryKinds: []string{"Application"}},
	}
}

func (b *NamespaceApplicationsBuilder) allowedGVRs(ctx context.Context, sources []typedTableResourceSource) map[schema.GroupVersionResource]bool {
	gvrs := []schema.GroupVersionResource{PodGVR, DeploymentGVR, StatefulSetGVR, DaemonSetGVR, JobGVR, CronJobGVR, ConfigMapGVR, SecretGVR}
	allowed := make(map[schema.GroupVersionResource]bool, len(gvrs))
	for i, source := range sources {
		allowed[gvrs[i]] = source.Available && runtimeResourceAllowed(ctx, namespaceApplicationsDomainName, source.Group, source.Resource)
	}
	return allowed
}

func addApplicationMember(groups map[string]*applicationGroupAccumulator, meta ClusterMeta, member applicationMemberAggregate, activeHelm map[string]resourcemodel.HelmReleaseStorageCandidate) {
	candidate := member.Candidate
	key := member.Ref.Namespace + "/" + candidate.Name
	group := groups[key]
	if group == nil {
		confidence := candidate.Confidence
		root := candidate.Root
		if root != nil && root.ClusterID != meta.ClusterID {
			root = nil
			confidence = resourcemodel.ApplicationConfidenceLow
		}
		if candidate.Evidence == resourcemodel.ApplicationEvidenceHelm {
			if _, confirmed := activeHelm[key]; confirmed {
				confirmedRoot := resourcemodel.NewResourceRef(meta.ClusterID, "helm.sh", "v3", "HelmRelease", "helmreleases", member.Ref.Namespace, candidate.Name, "")
				root = &confirmedRoot
				confidence = resourcemodel.ApplicationConfidenceHigh
			}
		}
		group = &applicationGroupAccumulator{
			row: NamespaceApplicationSummary{
				ClusterMeta: meta,
				Kind:        "Application",
				Name:        candidate.Name,
				Namespace:   member.Ref.Namespace,
				Confidence:  confidence,
				Root:        root,
			},
			evidence: map[resourcemodel.ApplicationEvidence]struct{}{},
			kinds:    map[string]struct{}{},
		}
		groups[key] = group
	}
	group.evidence[candidate.Evidence] = struct{}{}
	group.kinds[member.Ref.Kind] = struct{}{}
	group.row.WorkloadCount++
	if member.Presentation == "warning" || member.Presentation == "error" {
		group.row.NeedsAttention++
	}
	group.presentation = strongerApplicationPresentation(group.presentation, member.Presentation)
}

func strongerApplicationPresentation(current, candidate string) string {
	rank := func(value string) int {
		switch value {
		case "error":
			return 4
		case "warning", "terminating":
			return 3
		case "unknown":
			return 2
		case "ready":
			return 1
		default:
			return 0
		}
	}
	if rank(candidate) > rank(current) {
		return candidate
	}
	return current
}

func helmReleasePresentation(status string) string {
	switch status {
	case "failed":
		return "error"
	case "pending-install", "pending-upgrade", "pending-rollback", "uninstalling":
		return "warning"
	case "deployed":
		return "ready"
	default:
		return "unknown"
	}
}

func applicationGroupStatus(presentation string, needsAttention int) (string, string) {
	if presentation == "error" || presentation == "warning" || presentation == "terminating" || needsAttention > 0 {
		return "Needs attention", presentation
	}
	if presentation == "ready" {
		return "Healthy", "ready"
	}
	return "Unknown", "unknown"
}

func sortedApplicationEvidence(values map[resourcemodel.ApplicationEvidence]struct{}) []resourcemodel.ApplicationEvidence {
	order := []resourcemodel.ApplicationEvidence{
		resourcemodel.ApplicationEvidenceHelm,
		resourcemodel.ApplicationEvidenceOwner,
		resourcemodel.ApplicationEvidenceLabel,
	}
	result := make([]resourcemodel.ApplicationEvidence, 0, len(values))
	for _, value := range order {
		if _, ok := values[value]; ok {
			result = append(result, value)
		}
	}
	return result
}

func sortedStringSet(values map[string]struct{}) []string {
	result := make([]string, 0, len(values))
	for value := range values {
		if value != "" {
			result = append(result, value)
		}
	}
	sort.Strings(result)
	return result
}
