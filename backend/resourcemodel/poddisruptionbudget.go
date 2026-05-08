package resourcemodel

import (
	"strconv"

	policyv1 "k8s.io/api/policy/v1"
)

func BuildPodDisruptionBudgetResourceModel(clusterID string, pdb *policyv1.PodDisruptionBudget) ResourceModel {
	facts := BuildPodDisruptionBudgetFacts(clusterID, pdb)
	status := podDisruptionBudgetStatusPresentation(pdb, facts)
	return policyResourceModel(clusterID, "policy", "v1", "PodDisruptionBudget", "poddisruptionbudgets", pdb.ObjectMeta, status, ResourceFacts{PodDisruptionBudget: &facts})
}

func BuildPodDisruptionBudgetFacts(clusterID string, pdb *policyv1.PodDisruptionBudget) PodDisruptionBudgetFacts {
	facts := PodDisruptionBudgetFacts{
		AllowedDisruptions: pdb.Status.DisruptionsAllowed,
		CurrentHealthy:     pdb.Status.CurrentHealthy,
		DesiredHealthy:     pdb.Status.DesiredHealthy,
		ExpectedPods:       pdb.Status.ExpectedPods,
		ObservedGeneration: pdb.Status.ObservedGeneration,
		DisruptedPods:      disruptedPodsFromMap(clusterID, pdb.Namespace, pdb.Status.DisruptedPods),
		Conditions:         conditionFactsFromMetav1(pdb.Status.Conditions),
	}
	if pdb.Spec.Selector != nil {
		facts.Selector = copyStringMap(pdb.Spec.Selector.MatchLabels)
	}
	if pdb.Spec.MinAvailable != nil {
		next := intOrStringFacts(*pdb.Spec.MinAvailable)
		facts.MinAvailable = &next
	}
	if pdb.Spec.MaxUnavailable != nil {
		next := intOrStringFacts(*pdb.Spec.MaxUnavailable)
		facts.MaxUnavailable = &next
	}
	return facts
}

func podDisruptionBudgetStatusPresentation(pdb *policyv1.PodDisruptionBudget, facts PodDisruptionBudgetFacts) ResourceStatusPresentation {
	state := stringInt32(facts.AllowedDisruptions)
	signals := []ResourceStatusSignal{
		{Type: StatusSignalResourceState, Name: "status.disruptionsAllowed", Status: state},
		{Type: StatusSignalResourceState, Name: "status.currentHealthy", Status: stringInt32(facts.CurrentHealthy)},
		{Type: StatusSignalResourceState, Name: "status.desiredHealthy", Status: stringInt32(facts.DesiredHealthy)},
	}
	for _, condition := range facts.Conditions {
		signals = append(signals, ResourceStatusSignal{
			Type:    StatusSignalCondition,
			Name:    condition.Type,
			Status:  condition.Status,
			Reason:  condition.Reason,
			Message: condition.Message,
		})
	}
	lifecycle := networkLifecycle(pdb.ObjectMeta)
	if status, ok := deletingNetworkStatus(pdb.ObjectMeta, state, signals, lifecycle); ok {
		return status
	}
	presentation := "ready"
	if facts.CurrentHealthy < facts.DesiredHealthy || facts.AllowedDisruptions == 0 {
		presentation = "warning"
	}
	return networkSourceStatus(podDisruptionBudgetSummary(facts), state, "", presentation, signals, lifecycle)
}

func podDisruptionBudgetSummary(facts PodDisruptionBudgetFacts) string {
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
