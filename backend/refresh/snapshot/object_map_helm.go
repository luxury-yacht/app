package snapshot

import (
	"context"
	"fmt"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/resourcekind"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// A Helm release map holds exactly the objects the release's manifest names,
// with the links between them. An object the cluster confirms it does not have
// is a display-only Missing node. An object this build could not look for (its
// kind is denied or still loading, its namespace is outside the cluster's
// namespace scope, or its API is not served) is reported in the warnings and
// never drawn as missing.

// helmManifestPresence is what one build knows about an object the manifest
// names.
type helmManifestPresence int

const (
	// helmManifestObjectUnchecked means the build could not look for the
	// object; a warning says why.
	helmManifestObjectUnchecked helmManifestPresence = iota
	helmManifestObjectLive
	helmManifestObjectMissing
)

func (b *objectMapBuilder) buildHelmReleaseSnapshot(ctx context.Context, scope string, opts objectMapOptions) (*refresh.Snapshot, error) {
	if b.helmManifests == nil {
		return nil, fmt.Errorf("helm release maps are unavailable: no helm content provider")
	}
	if opts.identity.Namespace == "" {
		return nil, fmt.Errorf("helm release map scope for %s is missing the release namespace", opts.identity.Name)
	}
	meta := ClusterMetaFromContext(ctx)
	release, err := fetchHelmManifestResources(ctx, b.helmManifests, meta.ClusterID, opts.identity.Namespace, opts.identity.Name)
	if err != nil {
		return nil, err
	}
	assembler, err := b.newObjectMapAssembler(ctx)
	if err != nil {
		return nil, err
	}
	graph := assembler.index.buildHelmReleaseGraph(ctx, release.resources, opts.maxNodes)
	seed := ObjectMapReference{
		ClusterID:   meta.ClusterID,
		ClusterName: meta.ClusterName,
		Group:       resourcemodel.HelmReleaseGVK.Group,
		Version:     resourcemodel.HelmReleaseGVK.Version,
		Kind:        resourcemodel.HelmReleaseGVK.Kind,
		Namespace:   opts.identity.Namespace,
		Name:        opts.identity.Name,
	}
	return assembler.snapshot(scope, seed, graph, opts), nil
}

func (idx *objectMapIndex) buildHelmReleaseGraph(ctx context.Context, resources []resourcemodel.ResourceLink, maxNodes int) objectMapGraph {
	candidates := make(map[string]ObjectMapNode, len(resources))
	for _, link := range resources {
		if node, ok := idx.helmManifestNode(ctx, link); ok {
			candidates[node.ID] = node
		}
	}
	edges := newObjectMapAdjacency(idx.buildAllEdges(), nil).edgesBetween(candidates)
	return capObjectMapCandidates(candidates, edges, maxNodes)
}

// helmManifestNode returns the node for one object the manifest names: the
// live object, a Missing node when the cluster confirms it is absent, or no
// node when this build could not look for it.
func (idx *objectMapIndex) helmManifestNode(ctx context.Context, link resourcemodel.ResourceLink) (ObjectMapNode, bool) {
	if link.Ref == nil {
		idx.warnUnservedManifestObject(link.Display)
		return ObjectMapNode{}, false
	}
	record, presence := idx.findHelmManifestObject(ctx, *link.Ref)
	switch presence {
	case helmManifestObjectLive:
		return objectMapNodeFromRecord(objectMapNodeID(record.ref), 0, record), true
	case helmManifestObjectMissing:
		return idx.missingObjectMapNode(*link.Ref), true
	default:
		return ObjectMapNode{}, false
	}
}

// warnUnservedManifestObject reports a manifest object whose identity the
// resolver could not complete: the cluster does not serve its API version.
// Kubernetes may still hold the object under another API, so it is not missing.
func (idx *objectMapIndex) warnUnservedManifestObject(display *resourcemodel.DisplayRef) {
	if display == nil {
		return
	}
	apiVersion := schema.GroupVersion{Group: display.Group, Version: display.Version}.String()
	idx.warnOnce(fmt.Sprintf("skipped %s %s: %s is not served by the cluster",
		display.Kind, objectMapDisplayName(display.Namespace, display.Name), apiVersion))
}

func (idx *objectMapIndex) findHelmManifestObject(ctx context.Context, ref resourcemodel.ResourceRef) (*objectMapRecord, helmManifestPresence) {
	if record := idx.recordByIdentity(ref.Namespace, ref.Group, ref.Version, ref.Kind, ref.Name); record != nil {
		return record, helmManifestObjectLive
	}
	if ref.Namespace != "" && !idx.namespaceAllowed(ref.Namespace) {
		idx.warnOnce(fmt.Sprintf("skipped namespace %s: outside the cluster's namespace scope", ref.Namespace))
		return nil, helmManifestObjectUnchecked
	}
	if identity, collected := objectMapCollectedKinds[schema.GroupKind{Group: ref.Group, Kind: ref.Kind}]; collected {
		return idx.findCollectedManifestObject(ctx, ref, identity)
	}
	return idx.findCatalogManifestObject(ref)
}

// findCollectedManifestObject looks for an object of a kind the map collects.
// A manifest may name it by a served version other than the one the map
// collects; it is the same object.
func (idx *objectMapIndex) findCollectedManifestObject(
	ctx context.Context,
	ref resourcemodel.ResourceRef,
	identity resourcekind.Identity,
) (*objectMapRecord, helmManifestPresence) {
	if identity.Version != ref.Version {
		if record := idx.recordByIdentity(ref.Namespace, identity.Group, identity.Version, identity.Kind, ref.Name); record != nil {
			return record, helmManifestObjectLive
		}
	}
	if _, collected := idx.collectedResources[identity.GVR().GroupResource()]; !collected {
		// The build did not read this kind; collection reports permission and
		// list failures.
		return nil, helmManifestObjectUnchecked
	}
	if !readinessConfirmsAbsence(resourceReadinessFor(ctx, identity.Group, identity.Resource)) {
		idx.warnOnce(fmt.Sprintf("skipped %s: not loaded yet", identity.Resource))
		return nil, helmManifestObjectUnchecked
	}
	return nil, helmManifestObjectMissing
}

// readinessConfirmsAbsence reports whether a kind's data is complete enough
// that not finding an object means the cluster does not have it. Unknown means
// the hub reports no readiness detail, which keeps the existing behavior.
func readinessConfirmsAbsence(state refresh.ResourceReadiness) bool {
	return state == refresh.ResourceReadinessReady || state == refresh.ResourceReadinessUnknown
}

// findCatalogManifestObject looks for an object of a kind the map does not
// collect, such as a custom resource, in the object catalog.
func (idx *objectMapIndex) findCatalogManifestObject(ref resourcemodel.ResourceRef) (*objectMapRecord, helmManifestPresence) {
	notLoaded := fmt.Sprintf("skipped %s: not loaded yet", objectMapResourceName(ref.Group, ref.Resource))
	if idx.catalog == nil {
		idx.warnOnce(notLoaded)
		return nil, helmManifestObjectUnchecked
	}
	lookup := idx.catalog.LookupObject(ref.Namespace, ref.Group, ref.Kind, ref.Name)
	if lookup.Found {
		if record := idx.addCatalogRecord(lookup.Summary); record != nil {
			return record, helmManifestObjectLive
		}
	}
	if lookup.Denied != "" {
		idx.warnOnce(fmt.Sprintf("skipped %s: insufficient permissions", lookup.Denied))
		return nil, helmManifestObjectUnchecked
	}
	if lookup.Absent {
		return nil, helmManifestObjectMissing
	}
	idx.warnOnce(notLoaded)
	return nil, helmManifestObjectUnchecked
}

// missingObjectMapNode is the display-only node for a manifest object the
// cluster does not have: the manifest's identity and no live state.
func (idx *objectMapIndex) missingObjectMapNode(ref resourcemodel.ResourceRef) ObjectMapNode {
	mapRef := ObjectMapReference{
		ClusterID:   idx.meta.ClusterID,
		ClusterName: idx.meta.ClusterName,
		Group:       ref.Group,
		Version:     ref.Version,
		Kind:        ref.Kind,
		Resource:    ref.Resource,
		Namespace:   ref.Namespace,
		Name:        ref.Name,
	}
	return ObjectMapNode{ID: objectMapNodeID(mapRef), Ref: mapRef, Missing: true}
}

// objectMapResourceName is the kubectl-style resource[.group] name the object
// catalog uses in its permission reports.
func objectMapResourceName(group, resource string) string {
	if group == "" {
		return resource
	}
	return resource + "." + group
}

func objectMapDisplayName(namespace, name string) string {
	if namespace == "" {
		return name
	}
	return namespace + "/" + name
}
