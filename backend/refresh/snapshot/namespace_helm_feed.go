package snapshot

import (
	"github.com/luxury-yacht/app/backend/refresh/doorbell"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/helm"
)

// helmReleaseFeed keeps the Helm release table current from the Secrets ingest
// store. A release's row comes from its latest revision, which can live in any
// of its Secrets, but a sink runs under the Secrets store's write lock and must
// not read that store back. So the feed indexes each release's revisions
// itself. That lock also makes the store's sink calls the index's only writer,
// so the index needs no lock of its own.
type helmReleaseFeed struct {
	maintained *typedMaintainedStore[NamespaceHelmSummary]
	meta       ClusterMeta
	publish    rowPublication[NamespaceHelmSummary]
	// releases holds each release's revisions by storage Secret key, and
	// secrets maps each indexed Secret to its release.
	releases map[helmReleaseID]map[string]helmStoredRevision
	secrets  map[string]helmReleaseID
	batch    *relistBatch
}

type helmReleaseID struct {
	namespace, name string
}

// helmStoredRevision is one indexed revision and the resourceVersion of the
// Secret it came from, which tells a relist's unchanged Secret from a change.
type helmStoredRevision struct {
	release         helmReleaseID
	resourceVersion string
	revision        helm.Revision
}

var (
	_ ingest.BundleReplacer = (*helmReleaseFeed)(nil)
	_ ingest.BundleSeeder   = (*helmReleaseFeed)(nil)
	_ ingest.RelistBoundary = (*helmReleaseFeed)(nil)
)

// newHelmReleaseFeed returns the sink feeding maintained. Each change rings
// the release's namespace scopes with the domain's scope-level COMPLETE
// signal (refresh-domain-contract.json).
func newHelmReleaseFeed(maintained *typedMaintainedStore[NamespaceHelmSummary], meta ClusterMeta, bell doorbell.Bell) *helmReleaseFeed {
	publish := namespacedRowPublication(maintained, namespaceHelmDomainName, bell)
	publish.ref = func(row NamespaceHelmSummary) *resourcemodel.ResourceRef {
		ref := row.Ref
		return &ref
	}
	return &helmReleaseFeed{
		maintained: maintained,
		meta:       meta,
		publish:    publish,
		releases:   make(map[helmReleaseID]map[string]helmStoredRevision),
		secrets:    make(map[string]helmReleaseID),
	}
}

func (f *helmReleaseFeed) UpsertBundle(bundle ingest.Bundle) {
	if key, ok := helmSecretKey(bundle); ok {
		f.recompute(f.index(key, storedHelmRevision(bundle)))
	}
}

func (f *helmReleaseFeed) DeleteBundle(bundle ingest.Bundle) {
	if key, ok := helmSecretKey(bundle); ok {
		f.recompute(f.index(key, nil))
	}
}

// ReplaceBundles receives an unpartitioned relist's complete Secret set, with
// no per-Secret deletes, so it rebuilds the index and recomputes every release
// whose revisions differ from before.
func (f *helmReleaseFeed) ReplaceBundles(bundles []ingest.Bundle) {
	previous := f.releases
	f.rebuild(bundles)
	f.recompute(changedHelmReleases(previous, f.releases))
}

// SeedBundles rebuilds the index and the table from the Secrets restored from
// spill, before any watch runs. Nothing is subscribed yet, so it rings
// nothing.
func (f *helmReleaseFeed) SeedBundles(bundles []ingest.Bundle) {
	f.rebuild(bundles)
	rows := make([]NamespaceHelmSummary, 0, len(f.releases))
	for id := range f.releases {
		if row, ok := f.currentRow(id); ok {
			rows = append(rows, row)
		}
	}
	f.maintained.store.ReplaceWhere(rows, func(NamespaceHelmSummary) bool { return true })
	f.maintained.bumpSinkVersion()
}

func (f *helmReleaseFeed) BeginRelist(string) {
	f.batch = &relistBatch{}
}

// EndRelist rings each scope the relist changed once, after the store holds
// the relisted set.
func (f *helmReleaseFeed) EndRelist(string) {
	batch := f.batch
	f.batch = nil
	if batch != nil {
		f.publish.ring(mergeByDomain(batch.pending))
	}
}

// index records the Secret's revision, or forgets the Secret when stored is
// nil, and returns the releases whose revisions changed.
func (f *helmReleaseFeed) index(key string, stored *helmStoredRevision) []helmReleaseID {
	previous, had := f.secrets[key]
	if had && stored != nil && previous == stored.release && f.releases[previous][key].resourceVersion == stored.resourceVersion {
		return nil
	}
	var changed []helmReleaseID
	if had {
		f.forget(previous, key)
		changed = append(changed, previous)
	}
	if stored != nil {
		f.remember(key, *stored)
		if !had || previous != stored.release {
			changed = append(changed, stored.release)
		}
	}
	return changed
}

func (f *helmReleaseFeed) remember(key string, stored helmStoredRevision) {
	revisions := f.releases[stored.release]
	if revisions == nil {
		revisions = make(map[string]helmStoredRevision)
		f.releases[stored.release] = revisions
	}
	revisions[key] = stored
	f.secrets[key] = stored.release
}

func (f *helmReleaseFeed) forget(release helmReleaseID, key string) {
	delete(f.releases[release], key)
	if len(f.releases[release]) == 0 {
		delete(f.releases, release)
	}
	delete(f.secrets, key)
}

func (f *helmReleaseFeed) rebuild(bundles []ingest.Bundle) {
	f.releases = make(map[helmReleaseID]map[string]helmStoredRevision)
	f.secrets = make(map[string]helmReleaseID)
	for _, bundle := range bundles {
		key, ok := helmSecretKey(bundle)
		if stored := storedHelmRevision(bundle); ok && stored != nil {
			f.remember(key, *stored)
		}
	}
}

// recompute writes each release's current row, or removes the row when the
// release has none, and publishes each change.
func (f *helmReleaseFeed) recompute(releases []helmReleaseID) {
	for _, id := range releases {
		if row, ok := f.currentRow(id); ok {
			previous, replaced := f.maintained.store.UpsertReplacing(row)
			f.maintained.bumpSinkVersion()
			var before *NamespaceHelmSummary
			if replaced {
				before = &previous
			}
			f.published(f.publish.changes(before, &row, nil, doorbell.MessageTypeComplete))
			continue
		}
		key := namespacedTableKey("HelmRelease", id.namespace, id.name)
		if removed, existed := f.maintained.store.DeleteReturning(key); existed {
			f.maintained.bumpSinkVersion()
			f.published(f.publish.changes(&removed, nil, nil, doorbell.MessageTypeComplete))
		}
	}
}

// currentRow maps the release's latest revision. A release whose latest
// revision is superseded, uninstalled, or undecodable has no row; it does not
// fall back to an earlier revision.
func (f *helmReleaseFeed) currentRow(id helmReleaseID) (NamespaceHelmSummary, bool) {
	var latest *helm.Revision
	for _, stored := range f.releases[id] {
		revision := stored.revision
		if revision.Version >= 0 && (latest == nil || revision.Version > latest.Version) {
			latest = &revision
		}
	}
	if latest == nil || latest.Release == nil {
		return NamespaceHelmSummary{}, false
	}
	return mapHelmRelease(latest.Release, "", f.meta)
}

// published rings the changes now, or adds them to the open relist batch.
func (f *helmReleaseFeed) published(changes []doorbell.Change) {
	if f.batch != nil {
		f.batch.add(changes)
		return
	}
	f.publish.ring(changes)
}

// helmSecretKey is the storage Secret's namespace/name, from the bundle's
// Catalog half, which deletes also carry.
func helmSecretKey(bundle ingest.Bundle) (string, bool) {
	summary := catalogOf(bundle)
	if summary == nil {
		return "", false
	}
	return summary.Ref.Namespace + "/" + summary.Ref.Name, true
}

// storedHelmRevision is the bundle's Helm revision, or nil for a Secret that
// holds none.
func storedHelmRevision(bundle ingest.Bundle) *helmStoredRevision {
	record, ok := bundle.Aggregate.(helm.StorageRecord)
	summary := catalogOf(bundle)
	if !ok || record.Revision == nil || summary == nil {
		return nil
	}
	return &helmStoredRevision{
		release:         helmReleaseID{namespace: record.Namespace, name: record.Revision.Name},
		resourceVersion: summary.ResourceVersion,
		revision:        *record.Revision,
	}
}

// changedHelmReleases lists the releases whose revisions differ between two
// indexes: added, removed, or carried by a changed Secret.
func changedHelmReleases(before, after map[helmReleaseID]map[string]helmStoredRevision) []helmReleaseID {
	var changed []helmReleaseID
	for id, revisions := range before {
		if !sameHelmRevisions(revisions, after[id]) {
			changed = append(changed, id)
		}
	}
	for id := range after {
		if _, existed := before[id]; !existed {
			changed = append(changed, id)
		}
	}
	return changed
}

func sameHelmRevisions(a, b map[string]helmStoredRevision) bool {
	if len(a) != len(b) {
		return false
	}
	for key, stored := range a {
		if other, ok := b[key]; !ok || other.resourceVersion != stored.resourceVersion {
			return false
		}
	}
	return true
}
