package backend

import (
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/backend/capabilities"
	"github.com/luxury-yacht/app/backend/resources/common"
	authorizationv1 "k8s.io/api/authorization/v1"
)

// EvaluateCapabilities returns capability information for the supplied checks.
//
// The method accepts a batch of capability requests so callers can deduplicate
// round-trips to the cluster and keep UI updates consistent. Each request must
// provide an ID (used to correlate results), a Kubernetes verb, and a resource
// kind. Namespace/name/subresource are optional.
func (a *App) EvaluateCapabilities(checks []capabilities.CheckRequest) ([]capabilities.CheckResult, error) {
	results := make([]capabilities.CheckResult, 0, len(checks))
	if len(checks) == 0 {
		return results, nil
	}

	type capabilityBatch struct {
		deps             common.Dependencies
		selectionKey     string
		service          *capabilities.Service
		pending          []capabilities.ReviewAttributes
		pendingMappings  [][]int
		uniqueIndexByKey map[string]int
	}

	batches := make(map[string]*capabilityBatch)

	for _, check := range checks {
		base := capabilities.CheckResult{
			ID:           strings.TrimSpace(check.ID),
			ClusterID:    strings.TrimSpace(check.ClusterID),
			Verb:         strings.ToLower(strings.TrimSpace(check.Verb)),
			ResourceKind: strings.TrimSpace(check.ResourceKind),
			Namespace:    strings.TrimSpace(check.Namespace),
			Name:         strings.TrimSpace(check.Name),
			Subresource:  strings.TrimSpace(check.Subresource),
		}

		if base.ID == "" || base.Verb == "" || base.ResourceKind == "" {
			base.Error = "id, verb, and resourceKind are required"
			results = append(results, base)
			continue
		}

		if base.ClusterID == "" {
			base.Error = "clusterId is required"
			results = append(results, base)
			continue
		}

		batch, ok := batches[base.ClusterID]
		if !ok {
			deps, selectionKey, err := a.resolveClusterDependencies(base.ClusterID)
			if err != nil {
				base.Error = err.Error()
				results = append(results, base)
				continue
			}
			batch = &capabilityBatch{
				deps:             deps,
				selectionKey:     selectionKey,
				service:          capabilities.NewService(capabilities.Dependencies{Common: deps}),
				uniqueIndexByKey: make(map[string]int),
			}
			batches[base.ClusterID] = batch
		}

		if batch.deps.KubernetesClient == nil {
			base.Error = "kubernetes client not initialized"
			results = append(results, base)
			continue
		}

		gvr, _, err := getGVRForDependencies(batch.deps, batch.selectionKey, base.ResourceKind)
		if err != nil {
			base.Error = fmt.Sprintf("failed to resolve resource kind %s: %v", base.ResourceKind, err)
			results = append(results, base)
			continue
		}

		attr := &authorizationv1.ResourceAttributes{
			Group:       gvr.Group,
			Version:     gvr.Version,
			Resource:    gvr.Resource,
			Verb:        base.Verb,
			Namespace:   base.Namespace,
			Name:        base.Name,
			Subresource: base.Subresource,
		}

		key := capabilityAttributesKey(attr)
		uniqueIndex, exists := batch.uniqueIndexByKey[key]
		if !exists {
			uniqueIndex = len(batch.pending)
			batch.uniqueIndexByKey[key] = uniqueIndex
			batch.pending = append(batch.pending, capabilities.ReviewAttributes{
				ID:         base.ID,
				Attributes: attr,
			})
			batch.pendingMappings = append(batch.pendingMappings, []int{len(results)})
		} else {
			batch.pendingMappings[uniqueIndex] = append(batch.pendingMappings[uniqueIndex], len(results))
		}

		results = append(results, base)
	}

	for _, batch := range batches {
		if len(batch.pending) == 0 {
			continue
		}
		evaluated, err := batch.service.Evaluate(a.CtxOrBackground(), batch.pending)
		if err != nil {
			return nil, err
		}

		for i, eval := range evaluated {
			if i >= len(batch.pendingMappings) {
				break
			}
			for _, targetIdx := range batch.pendingMappings[i] {
				if targetIdx >= len(results) {
					continue
				}
				results[targetIdx].Allowed = eval.Allowed
				results[targetIdx].DeniedReason = eval.DeniedReason
				results[targetIdx].EvaluationError = eval.EvaluationError
				results[targetIdx].Error = eval.Error
			}
		}
	}

	return results, nil
}

func capabilityAttributesKey(attr *authorizationv1.ResourceAttributes) string {
	if attr == nil {
		return ""
	}
	return strings.Join([]string{
		attr.Group,
		attr.Version,
		attr.Resource,
		attr.Verb,
		attr.Namespace,
		attr.Name,
		attr.Subresource,
	}, "|")
}
