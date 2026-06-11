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
	"github.com/luxury-yacht/app/backend/resourcemodel"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/labels"
	informers "k8s.io/client-go/informers"
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

// RegisterNamespaceHelmDomain registers the namespace helm domain.
func RegisterNamespaceHelmDomain(
	reg *domain.Registry,
	informerFactory informers.SharedInformerFactory,
) error {
	if informerFactory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	builder := &NamespaceHelmBuilder{
		secretLister:  informerFactory.Core().V1().Secrets().Lister(),
		secretsSynced: informerFactory.Core().V1().Secrets().Informer().HasSynced,
	}
	return reg.Register(refresh.DomainConfig{
		Name:          namespaceHelmDomainName,
		BuildSnapshot: builder.Build,
	})
}

// NamespaceHelmBuilder renders Helm releases straight from the shared secrets
// informer — helm stores every release revision as a typed secret, so the
// already-synced cache replaces what used to be live per-namespace Helm SDK
// list calls (one client bootstrap + API round-trip per namespace, plus a
// cluster-wide re-list for every namespace without releases).
type NamespaceHelmBuilder struct {
	secretLister  corelisters.SecretLister
	secretsSynced cache.InformerSynced

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

	releases, err := b.listReleases(namespaceFilter)
	if err != nil {
		return nil, err
	}

	summaries, version := mapHelmReleases(releases, namespaceFilter, meta)
	// The lister + latest-revision map yield no particular order; builds must
	// be deterministic for stable snapshot checksums.
	sort.Slice(summaries, func(i, j int) bool {
		if summaries[i].Namespace == summaries[j].Namespace {
			return summaries[i].Name < summaries[j].Name
		}
		return summaries[i].Namespace < summaries[j].Namespace
	})

	snapshotScope := refresh.JoinClusterScope(clusterID, strings.TrimSpace(trimmed))
	if query.Enabled {
		page := applyTypedTableQuery(summaries, query, helmTableQueryAdapter())
		return &refresh.Snapshot{
			Domain:  namespaceHelmDomainName,
			Scope:   snapshotScope,
			Version: version,
			Payload: NamespaceHelmSnapshot{
				ClusterMeta:           meta,
				ResourceQueryEnvelope: typedQueryEnvelope(namespaceHelmDomainName, page, namespaceHelmQueryCapabilities()),
				Rows:                  page.Rows,
			},
			Stats: refresh.SnapshotStats{ItemCount: len(page.Rows)},
		}, nil
	}

	var totalItems int
	summaries, totalItems = truncateSnapshotWindow(summaries, config.SnapshotNamespaceHelmEntryLimit)

	return &refresh.Snapshot{
		Domain:  namespaceHelmDomainName,
		Scope:   snapshotScope,
		Version: version,
		Payload: NamespaceHelmSnapshot{
			ClusterMeta:           meta,
			ResourceQueryEnvelope: typedWindowEnvelope(namespaceHelmDomainName, totalItems, totalItems == len(summaries), snapshotSortedKinds(summaries, func(NamespaceHelmSummary) string { return "HelmRelease" }), namespaceHelmQueryCapabilities()),
			Rows:                  summaries,
		},
		Stats: snapshotWindowStats(len(summaries), totalItems, "Helm releases"),
	}, nil
}

// listReleases returns the current state of every release in the namespace
// (cluster-wide when namespace is empty).
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

	// Helm stores every revision of a release as its own secret; only the
	// newest revision describes the release's current state. Pick it per
	// (namespace, name) BEFORE decoding so decode cost scales with releases,
	// not revisions.
	type releaseKey struct{ namespace, name string }
	latest := make(map[releaseKey]*corev1.Secret)
	latestVersion := make(map[releaseKey]int)
	for _, secret := range secrets {
		if secret == nil || secret.Type != helmReleaseSecretType {
			continue
		}
		name := secret.Labels["name"]
		version, err := strconv.Atoi(secret.Labels["version"])
		if name == "" || err != nil {
			continue
		}
		key := releaseKey{namespace: secret.Namespace, name: name}
		if existing, ok := latestVersion[key]; !ok || version > existing {
			latestVersion[key] = version
			latest[key] = secret
		}
	}

	releases := make([]*release.Release, 0, len(latest))
	for _, secret := range latest {
		// A latest revision marked superseded or uninstalled is history, not a
		// current release.
		switch secret.Labels["status"] {
		case "superseded", "uninstalled":
			continue
		}
		rls, err := b.decodeReleaseSecret(secret)
		if err != nil {
			// One corrupt record must not take down the whole view; helm's own
			// list is similarly tolerant.
			continue
		}
		releases = append(releases, rls)
	}
	return releases, nil
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
		model := resourcemodel.BuildHelmReleaseResourceModel(
			meta.ClusterID,
			release,
			namespaceFilter,
			nil,
			nil,
			resourcemodel.ResourceModelBuildOptions{Materialization: resourcemodel.MaterializeSummaryFacts},
		)
		facts := model.Facts.HelmRelease
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
