/*
 * backend/resources/poddisruptionbudget/model.go
 *
 * PodDisruptionBudget resource model: the single definition of a PDB's intrinsic
 * fields + status presentation. Detail/object-map/streaming projections derive
 * from it. Shared model helpers are reused from resourcemodel (exported base).
 */

package poddisruptionbudget

import (
	"strconv"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	policyv1 "k8s.io/api/policy/v1"
)

// BuildResourceModel builds the PodDisruptionBudget resource model. Facts are
// owned by this package (poddisruptionbudget.Facts); the shared ResourceModel
// carries identity + status, and callers needing facts use BuildFacts.
func BuildResourceModel(clusterID string, pdb *policyv1.PodDisruptionBudget) resourcemodel.ResourceModel {
	facts := BuildFacts(clusterID, pdb)
	status := statusPresentation(pdb, facts)
	return resourcemodel.PolicyResourceModel(clusterID, "policy", "v1", "PodDisruptionBudget", "poddisruptionbudgets", pdb.ObjectMeta, status, resourcemodel.ResourceFacts{})
}

// BuildFacts extracts the PodDisruptionBudget facts from the raw object.
func BuildFacts(clusterID string, pdb *policyv1.PodDisruptionBudget) Facts {
	facts := Facts{
		AllowedDisruptions: pdb.Status.DisruptionsAllowed,
		CurrentHealthy:     pdb.Status.CurrentHealthy,
		DesiredHealthy:     pdb.Status.DesiredHealthy,
		ExpectedPods:       pdb.Status.ExpectedPods,
		ObservedGeneration: pdb.Status.ObservedGeneration,
		DisruptedPods:      resourcemodel.DisruptedPodsFromMap(clusterID, pdb.Namespace, pdb.Status.DisruptedPods),
		Conditions:         resourcemodel.ConditionFactsFromMetav1(pdb.Status.Conditions),
	}
	if pdb.Spec.Selector != nil {
		facts.Selector = resourcemodel.CopyStringMap(pdb.Spec.Selector.MatchLabels)
	}
	if pdb.Spec.MinAvailable != nil {
		next := resourcemodel.NewIntOrStringFacts(*pdb.Spec.MinAvailable)
		facts.MinAvailable = &next
	}
	if pdb.Spec.MaxUnavailable != nil {
		next := resourcemodel.NewIntOrStringFacts(*pdb.Spec.MaxUnavailable)
		facts.MaxUnavailable = &next
	}
	return facts
}

func statusPresentation(pdb *policyv1.PodDisruptionBudget, facts Facts) resourcemodel.ResourceStatusPresentation {
	state := stringInt32(facts.AllowedDisruptions)
	signals := []resourcemodel.ResourceStatusSignal{
		{Type: resourcemodel.StatusSignalResourceState, Name: "status.disruptionsAllowed", Status: state},
		{Type: resourcemodel.StatusSignalResourceState, Name: "status.currentHealthy", Status: stringInt32(facts.CurrentHealthy)},
		{Type: resourcemodel.StatusSignalResourceState, Name: "status.desiredHealthy", Status: stringInt32(facts.DesiredHealthy)},
	}
	for _, condition := range facts.Conditions {
		signals = append(signals, resourcemodel.ResourceStatusSignal{
			Type:    resourcemodel.StatusSignalCondition,
			Name:    condition.Type,
			Status:  condition.Status,
			Reason:  condition.Reason,
			Message: condition.Message,
		})
	}
	lifecycle := resourcemodel.ObjectLifecycle(pdb.ObjectMeta)
	if status, ok := resourcemodel.DeletingObjectStatus(pdb.ObjectMeta, state, signals, lifecycle); ok {
		return status
	}
	presentation := "ready"
	if facts.CurrentHealthy < facts.DesiredHealthy || facts.AllowedDisruptions == 0 {
		presentation = "warning"
	}
	return resourcemodel.ObjectSourceStatus(summary(facts), state, "", "", presentation, signals, lifecycle)
}

// summary is the short status-label string ("MinAvailable: x, Disruptions Allowed: y").
func summary(facts Facts) string {
	if facts.MinAvailable != nil {
		return "MinAvailable: " + facts.MinAvailable.Value + ", Disruptions Allowed: " + stringInt32(facts.AllowedDisruptions)
	}
	if facts.MaxUnavailable != nil {
		return "MaxUnavailable: " + facts.MaxUnavailable.Value + ", Disruptions Allowed: " + stringInt32(facts.AllowedDisruptions)
	}
	return "Disruptions Allowed: " + stringInt32(facts.AllowedDisruptions)
}

func stringInt32(value int32) string {
	return strconv.Itoa(int(value))
}
