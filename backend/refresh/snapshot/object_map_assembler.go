// Package snapshot assembles object-map graph snapshots from collected records.
package snapshot

import (
	"context"
	"fmt"

	"github.com/luxury-yacht/app/backend/refresh"
)

type objectMapAssembler struct {
	meta  ClusterMeta
	index *objectMapIndex
}

func (b *objectMapBuilder) newObjectMapAssembler(ctx context.Context) *objectMapAssembler {
	meta := ClusterMetaFromContext(ctx)
	index := newObjectMapIndex(meta, b.allowedNamespaces)
	index.catalog = b.catalog()
	index.collectTyped(objectMapTypedSource{
		permissions: b.permissions,
		ingest:      b.ingest,
	})
	index.enrichActionFacts(b.ingest)
	return &objectMapAssembler{
		meta:  meta,
		index: index,
	}
}

func (a *objectMapAssembler) buildObjectSnapshot(scope string, opts objectMapOptions) (*refresh.Snapshot, error) {
	seed, ok := a.index.findIdentity(opts.identity.Namespace, opts.identity.GVK, opts.identity.Name)
	if !ok {
		return nil, fmt.Errorf("object-map seed not found: %s/%s %s/%s", opts.identity.GVK.Group, opts.identity.GVK.Version, opts.identity.GVK.Kind, opts.identity.Name)
	}

	graph := a.index.buildGraph(seed, opts.maxNodes)
	return a.snapshot(scope, seed.ref, graph, opts), nil
}

func (a *objectMapAssembler) buildNamespaceSnapshot(scope string, opts objectMapOptions) (*refresh.Snapshot, error) {
	graph := a.index.buildNamespaceGraph(opts.namespace, opts.maxNodes)
	seed := ObjectMapReference{
		ClusterID:   a.meta.ClusterID,
		ClusterName: a.meta.ClusterName,
		Group:       "",
		Version:     "v1",
		Kind:        "Namespace",
		Resource:    "namespaces",
		Name:        opts.namespace,
	}
	return a.snapshot(scope, seed, graph, opts), nil
}

func (a *objectMapAssembler) snapshot(
	scope string,
	seed ObjectMapReference,
	graph objectMapGraph,
	opts objectMapOptions,
) *refresh.Snapshot {
	nodes := sortedObjectMapNodes(graph.nodes)
	edges := sortedObjectMapEdges(graph.edges)
	payload := ObjectMapSnapshotPayload{
		ClusterMeta: a.meta,
		Seed:        seed,
		Nodes:       nodes,
		Edges:       edges,
		MaxNodes:    opts.maxNodes,
		Truncated:   graph.truncated,
		Warnings:    a.index.warnings,
	}

	return &refresh.Snapshot{
		Domain:  objectMapDomain,
		Scope:   scope,
		Version: 0,
		Payload: payload,
		Stats: refresh.SnapshotStats{
			ItemCount:    len(nodes),
			TotalItems:   len(nodes),
			Truncated:    graph.truncated,
			Warnings:     a.index.warnings,
			IsFinalBatch: true,
			BatchSize:    len(nodes),
			TotalBatches: 1,
		},
	}
}
