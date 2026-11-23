package objectcatalog

import (
	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	hpapkg "github.com/luxury-yacht/app/backend/resources/hpa"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

func (idx *catalogIndex) countHPATarget(row Summary, delta int) {
	if row.ActionFacts == nil || row.ActionFacts.ScaleTarget == nil {
		return
	}
	target := row.ActionFacts.ScaleTarget
	adjustCatalogCount(idx.hpaTargets, hpapkg.TargetKey(target.Namespace, target.Group, target.Kind, target.Name), delta)
}

// Enrich only the returned page. Watch updates publish their target counts in
// the same lock as their rows, and facts already handed to readers stay immutable.
func (idx *catalogIndex) enrichPageActionFacts(rows []Summary, scope []string) {
	_, hpa := idx.resourceForGroupResource(hpapkg.Identity.Group, hpapkg.Identity.Resource)
	for i, row := range rows {
		if isCatalogScalableWorkload(row) {
			rows[i] = idx.withHPAOwnership(row, hpa, scope)
		}
	}
}

func (idx *catalogIndex) withHPAOwnership(row Summary, hpa *Descriptor, scope []string) Summary {
	var managed *bool
	if hpa != nil && idx.scopeConfirmed(*hpa, row.Ref.Namespace, scope) {
		target := hpapkg.TargetKey(row.Ref.Namespace, row.Ref.Group, row.Ref.Kind, row.Ref.Name)
		value := idx.hpaTargets[target] > 0
		managed = &value
	}
	if row.ActionFacts == nil && managed == nil {
		return row
	}
	var facts ActionFacts
	if row.ActionFacts != nil {
		facts = *row.ActionFacts
	}
	facts.HPAManaged = managed
	row.ActionFacts = &facts
	return row
}

// catalogScalableWorkloadKinds is the set of scalable-workload kinds from the single
// registry (the Graph.ScalableWorkload facet), keyed by group+kind.
var catalogScalableWorkloadKinds = func() map[schema.GroupKind]bool {
	m := map[schema.GroupKind]bool{}
	for _, d := range kindregistry.All {
		if d.Graph.ScalableWorkload {
			m[schema.GroupKind{Group: d.Identity.Group, Kind: d.Identity.Kind}] = true
		}
	}
	return m
}()

func isCatalogScalableWorkload(item Summary) bool {
	return item.Ref.Version == "v1" && catalogScalableWorkloadKinds[schema.GroupKind{Group: item.Ref.Group, Kind: item.Ref.Kind}]
}
