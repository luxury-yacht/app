package policy

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	policyv1 "k8s.io/api/policy/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// PodDisruptionBudget returns a detailed description for a single PDB.
func (s *Service) PodDisruptionBudget(namespace, name string) (*restypes.PodDisruptionBudgetDetails, error) {
	client := s.deps.Common.KubernetesClient
	if client == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	pdb, err := client.PolicyV1().PodDisruptionBudgets(namespace).Get(s.deps.Common.Context, name, metav1.GetOptions{})
	if err != nil {
		s.logError(fmt.Sprintf("Failed to get pod disruption budget %s/%s: %v", namespace, name, err))
		return nil, fmt.Errorf("failed to get pod disruption budget: %v", err)
	}

	return s.buildPodDisruptionBudgetDetails(pdb), nil
}

// PodDisruptionBudgets returns detailed descriptions for all PDBs in the namespace.
func (s *Service) PodDisruptionBudgets(namespace string) ([]*restypes.PodDisruptionBudgetDetails, error) {
	client := s.deps.Common.KubernetesClient
	if client == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	pdbs, err := client.PolicyV1().PodDisruptionBudgets(namespace).List(s.deps.Common.Context, metav1.ListOptions{})
	if err != nil {
		s.logError(fmt.Sprintf("Failed to list pod disruption budgets in namespace %s: %v", namespace, err))
		return nil, fmt.Errorf("failed to list pod disruption budgets: %v", err)
	}

	result := make([]*restypes.PodDisruptionBudgetDetails, 0, len(pdbs.Items))
	for i := range pdbs.Items {
		result = append(result, s.buildPodDisruptionBudgetDetails(&pdbs.Items[i]))
	}

	return result, nil
}

func (s *Service) buildPodDisruptionBudgetDetails(pdb *policyv1.PodDisruptionBudget) *restypes.PodDisruptionBudgetDetails {
	details := &restypes.PodDisruptionBudgetDetails{
		Kind:               "PodDisruptionBudget",
		Name:               pdb.Name,
		Namespace:          pdb.Namespace,
		Age:                common.FormatAge(pdb.CreationTimestamp.Time),
		CurrentHealthy:     pdb.Status.CurrentHealthy,
		DesiredHealthy:     pdb.Status.DesiredHealthy,
		DisruptionsAllowed: pdb.Status.DisruptionsAllowed,
		ExpectedPods:       pdb.Status.ExpectedPods,
		ObservedGeneration: pdb.Status.ObservedGeneration,
		DisruptedPods:      pdb.Status.DisruptedPods,
		Labels:             pdb.Labels,
		Annotations:        pdb.Annotations,
	}

	if pdb.Spec.MinAvailable != nil {
		value := pdb.Spec.MinAvailable.String()
		details.MinAvailable = &value
	}
	if pdb.Spec.MaxUnavailable != nil {
		value := pdb.Spec.MaxUnavailable.String()
		details.MaxUnavailable = &value
	}
	if pdb.Spec.Selector != nil {
		details.Selector = pdb.Spec.Selector.MatchLabels
	}

	for _, condition := range pdb.Status.Conditions {
		desc := fmt.Sprintf("%s: %s", condition.Type, condition.Status)
		if condition.Reason != "" {
			desc += fmt.Sprintf(" (%s)", condition.Reason)
		}
		if condition.Message != "" {
			desc += fmt.Sprintf(" - %s", condition.Message)
		}
		details.Conditions = append(details.Conditions, desc)
	}

	selectorSummary := "No selector"
	if len(details.Selector) > 0 {
		selectorSummary = fmt.Sprintf("Selector: %d labels", len(details.Selector))
	}

	availability := ""
	if details.MinAvailable != nil {
		availability = fmt.Sprintf(", MinAvailable: %s", *details.MinAvailable)
	}
	if details.MaxUnavailable != nil {
		availability += fmt.Sprintf(", MaxUnavailable: %s", *details.MaxUnavailable)
	}

	status := fmt.Sprintf(", Healthy: %d/%d, Disruptions Allowed: %d",
		details.CurrentHealthy, details.DesiredHealthy, details.DisruptionsAllowed)

	details.Details = selectorSummary + availability + status

	return details
}

func (s *Service) logError(msg string) {
	if s.deps.Common.Logger != nil {
		s.deps.Common.Logger.Error(msg, "ResourceLoader")
	}
}
