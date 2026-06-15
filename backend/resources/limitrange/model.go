/*
 * backend/resources/limitrange/model.go
 *
 * LimitRange resource model: the single definition of a LimitRange's intrinsic
 * fields + status presentation. Shared model + quantity helpers from resourcemodel.
 */

package limitrange

import (
	"fmt"
	"strconv"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	corev1 "k8s.io/api/core/v1"
)

// BuildResourceModel builds the LimitRange resource model. Facts are owned by
// this package; the shared ResourceModel carries identity + status.
func BuildResourceModel(clusterID string, limitRange *corev1.LimitRange) resourcemodel.ResourceModel {
	facts := BuildFacts(limitRange)
	status := statusPresentation(limitRange, facts)
	return resourcemodel.PolicyResourceModel(clusterID, "", "v1", "LimitRange", "limitranges", limitRange.ObjectMeta, status, resourcemodel.ResourceFacts{})
}

// BuildFacts extracts the LimitRange facts from the raw object.
func BuildFacts(limitRange *corev1.LimitRange) Facts {
	facts := Facts{}
	for _, limit := range limitRange.Spec.Limits {
		facts.Limits = append(facts.Limits, LimitRangeItemFacts{
			Kind:                 string(limit.Type),
			Max:                  resourcemodel.QuantityMapFacts(limit.Max),
			Min:                  resourcemodel.QuantityMapFacts(limit.Min),
			Default:              resourcemodel.QuantityMapFacts(limit.Default),
			DefaultRequest:       resourcemodel.QuantityMapFacts(limit.DefaultRequest),
			MaxLimitRequestRatio: resourcemodel.QuantityMapFacts(limit.MaxLimitRequestRatio),
		})
	}
	return facts
}

func statusPresentation(limitRange *corev1.LimitRange, facts Facts) resourcemodel.ResourceStatusPresentation {
	state := strconv.Itoa(len(facts.Limits))
	signals := []resourcemodel.ResourceStatusSignal{{
		Type:   resourcemodel.StatusSignalResourceState,
		Name:   "spec.limits.count",
		Status: state,
	}}
	lifecycle := resourcemodel.NetworkLifecycle(limitRange.ObjectMeta)
	if status, ok := resourcemodel.DeletingNetworkStatus(limitRange.ObjectMeta, state, signals, lifecycle); ok {
		return status
	}
	return resourcemodel.NetworkSourceStatus(summary(facts), state, "", "ready", signals, lifecycle)
}

func summary(facts Facts) string {
	out := fmt.Sprintf("%d limit(s)", len(facts.Limits))
	if len(facts.Limits) > 0 {
		out += fmt.Sprintf(" - Type: %s", facts.Limits[0].Kind)
	}
	return out
}
