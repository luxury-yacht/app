package objectcatalog

import (
	"strings"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

func enrichCatalogActionFacts(items map[string]Summary, allowed map[string]Descriptor, failed map[string]error) {
	hpaCoverageKnown := catalogHPACoverageKnown(allowed, failed)
	managedTargets := catalogManagedTargets(items, hpaCoverageKnown)

	for key, item := range items {
		if enriched, changed := enrichScalableWorkloadActionFacts(item, hpaCoverageKnown, managedTargets); changed {
			items[key] = enriched
		}
	}
}

func catalogManagedTargets(items map[string]Summary, coverageKnown bool) map[string]struct{} {
	managedTargets := make(map[string]struct{})
	if !coverageKnown {
		return managedTargets
	}
	for _, item := range items {
		if item.ActionFacts == nil || item.ActionFacts.ScaleTarget == nil {
			continue
		}
		target := item.ActionFacts.ScaleTarget
		managedTargets[actionTargetKey(target.Namespace, target.Group, target.Version, target.Kind, target.Name)] = struct{}{}
	}
	return managedTargets
}

func enrichScalableWorkloadActionFacts(item Summary, coverageKnown bool, managedTargets map[string]struct{}) (Summary, bool) {
	if !isCatalogScalableWorkload(item) {
		return item, false
	}
	if !coverageKnown {
		if item.ActionFacts == nil {
			return item, false
		}
		item.ActionFacts.HPAManaged = nil
		return item, true
	}
	_, managed := managedTargets[actionTargetKey(item.Ref.Namespace, item.Ref.Group, item.Ref.Version, item.Ref.Kind, item.Ref.Name)]
	if item.ActionFacts == nil {
		item.ActionFacts = &ActionFacts{}
	}
	item.ActionFacts.HPAManaged = &managed
	return item, true
}

func catalogHPACoverageKnown(allowed map[string]Descriptor, failed map[string]error) bool {
	for gvr, desc := range allowed {
		if desc.Group != "autoscaling" || desc.Resource != "horizontalpodautoscalers" {
			continue
		}
		if _, failed := failed[gvr]; failed {
			continue
		}
		return true
	}
	return false
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

func actionTargetKey(namespace, group, version, kind, name string) string {
	return strings.Join([]string{
		strings.TrimSpace(namespace),
		strings.TrimSpace(group),
		strings.TrimSpace(version),
		strings.TrimSpace(kind),
		strings.TrimSpace(name),
	}, "\x00")
}
