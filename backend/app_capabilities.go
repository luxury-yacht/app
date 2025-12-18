package backend

import (
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/backend/capabilities"
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

	service := capabilities.NewService(capabilities.Dependencies{
		Common: a.resourceDependencies(),
	})

	pending := make([]capabilities.ReviewAttributes, 0, len(checks))
	pendingMappings := make([][]int, 0, len(checks))
	uniqueIndexByKey := make(map[string]int, len(checks))
	ensuredClient := false

	for _, check := range checks {
		base := capabilities.CheckResult{
			ID:           strings.TrimSpace(check.ID),
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

		if !ensuredClient {
			if err := a.ensureClientInitialized("SelfSubjectAccessReview"); err != nil {
				base.Error = err.Error()
				results = append(results, base)
				continue
			}
			ensuredClient = true
		}

		gvr, _, err := a.getGVR(base.ResourceKind)
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
		uniqueIndex, exists := uniqueIndexByKey[key]
		if !exists {
			uniqueIndex = len(pending)
			uniqueIndexByKey[key] = uniqueIndex
			pending = append(pending, capabilities.ReviewAttributes{
				ID:         base.ID,
				Attributes: attr,
			})
			pendingMappings = append(pendingMappings, []int{len(results)})
		} else {
			pendingMappings[uniqueIndex] = append(pendingMappings[uniqueIndex], len(results))
		}

		results = append(results, base)
	}

	if len(pending) == 0 {
		return results, nil
	}

	evaluated, err := service.Evaluate(a.CtxOrBackground(), pending)
	if err != nil {
		return nil, err
	}

	for i, eval := range evaluated {
		if i >= len(pendingMappings) {
			break
		}
		for _, targetIdx := range pendingMappings[i] {
			if targetIdx >= len(results) {
				continue
			}
			results[targetIdx].Allowed = eval.Allowed
			results[targetIdx].DeniedReason = eval.DeniedReason
			results[targetIdx].EvaluationError = eval.EvaluationError
			results[targetIdx].Error = eval.Error
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
