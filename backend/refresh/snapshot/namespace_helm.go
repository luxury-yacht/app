package snapshot

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"helm.sh/helm/v3/pkg/release"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/querypage"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/helm"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/labels"
	corelisters "k8s.io/client-go/listers/core/v1"
	"k8s.io/client-go/tools/cache"
)

const namespaceHelmDomainName = "namespace-helm"

// helmReleaseSecretType marks the secrets helm's storage driver writes (one
// secret per release revision).
const helmReleaseSecretType corev1.SecretType = "helm.sh/release.v1"

// helmDecodeCacheLimit bounds the decoded-release memo; past it the cache is
// rebuilt from scratch (release counts this high are not a realistic working
// set, this is purely a leak guard).
const helmDecodeCacheLimit = 4096

// helmOwnerSelector narrows the lister scan to helm storage records.
var helmOwnerSelector = labels.SelectorFromSet(labels.Set{"owner": "helm"})

// NamespaceHelmSnapshot payload returned to the frontend.
type NamespaceHelmSnapshot struct {
	ClusterMeta
	ResourceQueryEnvelope
	Rows []NamespaceHelmSummary `json:"rows"`
}

// NamespaceHelmSummary captures the fields required by the Helm table.
type NamespaceHelmSummary struct {
	ClusterMeta
	Name               string `json:"name"`
	Namespace          string `json:"namespace"`
	Chart              string `json:"chart"`
	AppVersion         string `json:"appVersion"`
	Status             string `json:"status"`
	StatusState        string `json:"statusState,omitempty"`
	StatusPresentation string `json:"statusPresentation,omitempty"`
	StatusReason       string `json:"statusReason,omitempty"`
	Revision           int    `json:"revision"`
	Updated            string `json:"updated"`
	Description        string `json:"description,omitempty"`
	Age                string `json:"age"`
	AgeTimestamp       int64  `json:"ageTimestamp,omitempty"`
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
	return querypageSchemaFromAdapter(helmTableQueryAdapter(), []string{"name", "kind", "namespace", "chart", "appversion", "status", "revision", "updated", "age"})
}

// HelmStorageSource supplies the full typed helm-release Secrets the namespace-helm
// builder decodes. ConfigMap/Secret are cut to the ingest path so the shared
// informer factory no longer caches them as typed objects; the dedicated
// label-filtered (owner=helm) helm-storage source holds the release subset instead.
// *informer.HelmStorageSource satisfies it.
type HelmStorageSource interface {
	SecretLister() corelisters.SecretLister
	SecretsHasSynced() cache.InformerSynced
	SecretInformer() cache.SharedIndexInformer
}

// helmAvailableKinds is the single-kind availability set the maintained store filters by:
// every helm row's Kind is the synthesized "HelmRelease".
var helmAvailableKinds = map[string]bool{"HelmRelease": true}

// RegisterNamespaceHelmDomain registers the namespace helm domain. It serves from a
// maintained store of synthesized HelmRelease rows: a handler on the helm-storage Secret
// informer re-aggregates a release (its latest non-superseded revision) on every revision
// secret event, so Build reads rows from RAM instead of listing + decoding every request.
// The handler is registered before the helm-storage factory starts, so the sync gate
// guarantees the store is populated before serve.
func RegisterNamespaceHelmDomain(
	reg *domain.Registry,
	helmStorage HelmStorageSource,
	clusterMeta ClusterMeta,
) error {
	if helmStorage == nil {
		return fmt.Errorf("helm storage source is nil")
	}
	builder := &NamespaceHelmBuilder{
		secretLister:  helmStorage.SecretLister(),
		secretsSynced: helmStorage.SecretsHasSynced(),
		meta:          clusterMeta,
	}
	// Feed a maintained store only when the helm-storage secret informer exists (the
	// identity can list+watch helm secrets). When it is nil — the permission gate denied
	// secrets — the builder falls back to the list path over the (empty) lister, exactly
	// as before the maintained-store cutover, rather than registering a handler on nil.
	if informer := helmStorage.SecretInformer(); informer != nil {
		builder.maintained = newTypedMaintainedStore(clusterMeta, helmQuerypageSchema(), helmTableQueryAdapter())
		reaggregate := func(obj interface{}) {
			secret, ok := maintainedUnwrap(obj).(*corev1.Secret)
			if !ok || secret.Type != helmReleaseSecretType {
				return
			}
			name := secret.Labels["name"]
			if name == "" {
				return
			}
			builder.reaggregateRelease(secret.Namespace, name, secret)
		}
		if _, err := informer.AddEventHandler(cache.ResourceEventHandlerFuncs{
			AddFunc:    reaggregate,
			UpdateFunc: func(_, newObj interface{}) { reaggregate(newObj) },
			DeleteFunc: reaggregate,
		}); err != nil {
			return err
		}
	}
	// NOTE: helm is intentionally NOT registered for spill/restore. Its rows are HelmReleases
	// synthesized from revision secrets by the bespoke reaggregate handler; reconciling a
	// release deleted while Cold would need a per-release sweep the handler does not express.
	// Re-warm re-synthesizes the releases from the secret informer's initial relist (correct,
	// just no warm-paint) — the value (few releases) does not justify a bespoke reconcile.
	return reg.Register(refresh.DomainConfig{
		Name:          namespaceHelmDomainName,
		BuildSnapshot: builder.Build,
	})
}

// reaggregateRelease recomputes the synthesized HelmRelease row for one release from its
// revision secrets and upserts it, or deletes the row when no current (non-superseded)
// revision remains — the incremental form of the list path's per-(namespace,name)
// aggregation. source is the triggering secret, used as the version watermark.
func (b *NamespaceHelmBuilder) reaggregateRelease(namespace, name string, source *corev1.Secret) {
	rls := b.latestReleaseFor(namespace, name)
	if rls == nil {
		b.maintained.deleteRow(NamespaceHelmSummary{Namespace: namespace, Name: name})
		return
	}
	summaries, _ := mapHelmReleases([]*release.Release{rls}, "", b.meta)
	if len(summaries) == 1 {
		b.maintained.upsertRow(summaries[0], source)
	}
}

// NamespaceHelmBuilder renders Helm releases straight from the shared secrets
// informer — helm stores every release revision as a typed secret, so the
// already-synced cache replaces what used to be live per-namespace Helm SDK
// list calls (one client bootstrap + API round-trip per namespace, plus a
// cluster-wide re-list for every namespace without releases).
type NamespaceHelmBuilder struct {
	secretLister  corelisters.SecretLister
	secretsSynced cache.InformerSynced

	// maintained is the informer-fed store of synthesized HelmRelease rows (production);
	// meta is the cluster identity the re-aggregation projects with. A builder without a
	// maintained store takes the list path (the direct-builder unit tests).
	maintained *typedMaintainedStore[NamespaceHelmSummary]
	meta       ClusterMeta

	// decodeCache memoizes decoded release payloads by secret identity so
	// repeat builds (pagination, per-keystroke filter queries) skip the
	// gzip+json work. Keyed by namespace/name (unique per revision secret),
	// validated by resourceVersion.
	decodeMu    sync.Mutex
	decodeCache map[string]decodedHelmRelease
}

type decodedHelmRelease struct {
	resourceVersion string
	release         *release.Release
}

func (b *NamespaceHelmBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	meta := ClusterMetaFromContext(ctx)
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	baseScope, query, err := parseTypedTableQueryScope(clusterID, strings.TrimSpace(trimmed), namespaceHelmDomainName, "")
	if err != nil {
		return nil, err
	}
	parsedScope, err := parseNamespaceSnapshotScope(refresh.JoinClusterScope(clusterID, baseScope), "namespace scope is required")
	if err != nil {
		return nil, err
	}

	// Wait out the informer's initial sync (bounded by the request context)
	// instead of listing an unsynced cache: the first request after connect is
	// slower, never wrong. See ClusterEventsBuilder.Build.
	if b.secretsSynced != nil && !cache.WaitForCacheSync(ctx.Done(), b.secretsSynced) {
		return nil, fmt.Errorf("helm release cache has not finished syncing")
	}

	namespaceFilter := parsedScope.Namespace
	if parsedScope.AllNamespaces {
		namespaceFilter = ""
	}

	var summaries []NamespaceHelmSummary
	var version uint64
	if b.maintained != nil {
		// Serve the synthesized rows straight from the informer-fed store (re-aggregated
		// at intake) instead of listing + decoding every request.
		summaries = b.maintained.rows(namespaceFilter, helmAvailableKinds)
		version = b.maintained.snapshotVersion()
	} else {
		releases, listErr := b.listReleases(namespaceFilter)
		if listErr != nil {
			return nil, listErr
		}
		summaries, version = mapHelmReleases(releases, namespaceFilter, meta)
	}
	// The lister + latest-revision map yield no particular order; builds must
	// be deterministic for stable snapshot checksums.
	sort.Slice(summaries, func(i, j int) bool {
		if summaries[i].Namespace == summaries[j].Namespace {
			return summaries[i].Name < summaries[j].Name
		}
		return summaries[i].Namespace < summaries[j].Namespace
	})

	snapshotScope := refresh.JoinClusterScope(clusterID, strings.TrimSpace(trimmed))
	resolved := resolveTypedSnapshotPageViaStore(
		namespaceHelmDomainName,
		summaries,
		query,
		helmTableQueryAdapter(),
		helmQuerypageSchema(),
		namespaceHelmQueryCapabilities(),
		config.SnapshotNamespaceHelmEntryLimit,
		"Helm releases",
		func(NamespaceHelmSummary) string { return "HelmRelease" },
		nil,
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

// listReleases returns the current state of every release in the namespace
// (cluster-wide when namespace is empty). It groups the revision secrets per
// (namespace, name) and resolves each group through latestRelease, so the list path
// and the maintained-store re-aggregation share the EXACT current-revision selection.
func (b *NamespaceHelmBuilder) listReleases(namespace string) ([]*release.Release, error) {
	var (
		secrets []*corev1.Secret
		err     error
	)
	if namespace == "" {
		secrets, err = b.secretLister.List(helmOwnerSelector)
	} else {
		secrets, err = b.secretLister.Secrets(namespace).List(helmOwnerSelector)
	}
	if err != nil {
		return nil, err
	}

	type releaseKey struct{ namespace, name string }
	groups := make(map[releaseKey][]*corev1.Secret)
	for _, secret := range secrets {
		if secret == nil || secret.Type != helmReleaseSecretType {
			continue
		}
		name := secret.Labels["name"]
		if name == "" {
			continue
		}
		key := releaseKey{namespace: secret.Namespace, name: name}
		groups[key] = append(groups[key], secret)
	}

	releases := make([]*release.Release, 0, len(groups))
	for _, group := range groups {
		if rls := b.latestRelease(group); rls != nil {
			releases = append(releases, rls)
		}
	}
	return releases, nil
}

// latestRelease selects the latest revision among a single release's revision secrets
// and decodes it, or returns nil when none is current: the newest revision marked
// superseded/uninstalled is history (not fallen back to a prior revision — matching the
// list path), and a corrupt record is skipped (helm's own list is similarly tolerant).
func (b *NamespaceHelmBuilder) latestRelease(secrets []*corev1.Secret) *release.Release {
	var latest *corev1.Secret
	latestVersion := -1
	for _, secret := range secrets {
		if secret == nil || secret.Type != helmReleaseSecretType {
			continue
		}
		version, err := strconv.Atoi(secret.Labels["version"])
		if err != nil {
			continue
		}
		if version > latestVersion {
			latestVersion = version
			latest = secret
		}
	}
	if latest == nil {
		return nil
	}
	switch latest.Labels["status"] {
	case "superseded", "uninstalled":
		return nil
	}
	rls, err := b.decodeReleaseSecret(latest)
	if err != nil {
		return nil
	}
	return rls
}

// latestReleaseFor resolves the current release for one (namespace, name) from the
// label-filtered secret lister — the single-release form listReleases applies per group,
// used by the maintained store's incremental re-aggregation.
func (b *NamespaceHelmBuilder) latestReleaseFor(namespace, name string) *release.Release {
	secrets, err := b.secretLister.Secrets(namespace).List(helmOwnerSelector)
	if err != nil {
		return nil
	}
	matching := make([]*corev1.Secret, 0, len(secrets))
	for _, secret := range secrets {
		if secret != nil && secret.Labels["name"] == name {
			matching = append(matching, secret)
		}
	}
	return b.latestRelease(matching)
}

func (b *NamespaceHelmBuilder) decodeReleaseSecret(secret *corev1.Secret) (*release.Release, error) {
	cacheKey := secret.Namespace + "/" + secret.Name
	b.decodeMu.Lock()
	cached, ok := b.decodeCache[cacheKey]
	b.decodeMu.Unlock()
	if ok && cached.resourceVersion == secret.ResourceVersion {
		return cached.release, nil
	}

	rls, err := decodeHelmRelease(secret.Data["release"])
	if err != nil {
		return nil, err
	}

	b.decodeMu.Lock()
	if b.decodeCache == nil || len(b.decodeCache) >= helmDecodeCacheLimit {
		b.decodeCache = make(map[string]decodedHelmRelease)
	}
	b.decodeCache[cacheKey] = decodedHelmRelease{resourceVersion: secret.ResourceVersion, release: rls}
	b.decodeMu.Unlock()
	return rls, nil
}

// decodeHelmRelease mirrors helm v3's storage record format
// (storage/driver/util.go): base64 text wrapping an optionally-gzipped JSON
// release.
func decodeHelmRelease(data []byte) (*release.Release, error) {
	if len(data) == 0 {
		return nil, fmt.Errorf("helm release record is empty")
	}
	decoded, err := base64.StdEncoding.DecodeString(string(data))
	if err != nil {
		return nil, err
	}
	if len(decoded) > 3 && bytes.Equal(decoded[:3], []byte{0x1f, 0x8b, 0x08}) {
		reader, err := gzip.NewReader(bytes.NewReader(decoded))
		if err != nil {
			return nil, err
		}
		defer reader.Close()
		if decoded, err = io.ReadAll(reader); err != nil {
			return nil, err
		}
	}
	var rls release.Release
	if err := json.Unmarshal(decoded, &rls); err != nil {
		return nil, err
	}
	return &rls, nil
}

func mapHelmReleases(
	releases []*release.Release,
	namespaceFilter string,
	meta ClusterMeta,
) ([]NamespaceHelmSummary, uint64) {
	summaries := make([]NamespaceHelmSummary, 0, len(releases))
	var version uint64

	for _, release := range releases {
		if release == nil {
			continue
		}
		ns := release.Namespace
		if ns == "" && namespaceFilter != "" {
			ns = namespaceFilter
		}
		if namespaceFilter != "" && ns != namespaceFilter {
			continue
		}
		helmOpts := resourcemodel.ResourceModelBuildOptions{Materialization: resourcemodel.MaterializeSummaryFacts}
		model := helm.BuildResourceModel(meta.ClusterID, release, namespaceFilter, nil, nil, helmOpts)
		facts := helm.BuildFacts(release, nil, nil, helmOpts)
		chartName := facts.Chart
		appVersion := facts.AppVersion
		status := model.Status.Label
		updated := ""
		description := ""
		age := ""
		ageTimestamp := int64(0)
		if facts.Updated != nil && !facts.Updated.IsZero() {
			updated = facts.Updated.Time.Format(time.RFC3339)
		}
		description = facts.Description
		if !model.Metadata.CreationTimestamp.IsZero() {
			age = formatAge(model.Metadata.CreationTimestamp.Time)
			ageTimestamp = model.Metadata.CreationTimestamp.UnixMilli()
		}
		summaries = append(summaries, NamespaceHelmSummary{
			ClusterMeta:        meta,
			Name:               release.Name,
			Namespace:          ns,
			Chart:              chartName,
			AppVersion:         appVersion,
			Status:             status,
			StatusState:        model.Status.State,
			StatusPresentation: model.Status.Presentation,
			StatusReason:       model.Status.Reason,
			Revision:           release.Version,
			Updated:            updated,
			Description:        description,
			Age:                age,
			AgeTimestamp:       ageTimestamp,
		})
		if v := uint64(release.Version); v > version {
			version = v
		}
	}

	return summaries, version
}
