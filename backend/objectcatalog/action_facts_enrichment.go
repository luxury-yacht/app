package objectcatalog

import (
	"strings"
)

func enrichCatalogActionFacts(items map[string]Summary, allowed map[string]resourceDescriptor, failed map[string]error) {
	hpaCoverageKnown := catalogHPACoverageKnown(allowed, failed)
	managedTargets := make(map[string]struct{})
	if hpaCoverageKnown {
		for _, item := range items {
			if item.ActionFacts == nil || item.ActionFacts.ScaleTarget == nil {
				continue
			}
			managedTargets[actionTargetKey(
				item.ActionFacts.ScaleTarget.Namespace,
				item.ActionFacts.ScaleTarget.Group,
				item.ActionFacts.ScaleTarget.Version,
				item.ActionFacts.ScaleTarget.Kind,
				item.ActionFacts.ScaleTarget.Name,
			)] = struct{}{}
		}
	}

	for key, item := range items {
		if !isCatalogScalableWorkload(item) {
			continue
		}
		if !hpaCoverageKnown {
			if item.ActionFacts != nil {
				item.ActionFacts.HPAManaged = nil
				items[key] = item
			}
			continue
		}
		managed := false
		if _, ok := managedTargets[actionTargetKey(item.Namespace, item.Group, item.Version, item.Kind, item.Name)]; ok {
			managed = true
		}
		if item.ActionFacts == nil {
			item.ActionFacts = &ActionFacts{}
		}
		item.ActionFacts.HPAManaged = &managed
		items[key] = item
	}
}

func catalogHPACoverageKnown(allowed map[string]resourceDescriptor, failed map[string]error) bool {
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

func isCatalogScalableWorkload(item Summary) bool {
	return item.Group == "apps" &&
		item.Version == "v1" &&
		(item.Kind == "Deployment" || item.Kind == "StatefulSet" || item.Kind == "ReplicaSet")
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
