/*
 * backend/resources/policy/poddisruptionbudgets.go
 *
 * PodDisruptionBudget resource handlers.
 * - Builds detail and list views for the frontend.
 */

package policy

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/types"
	policyv1 "k8s.io/api/policy/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// PodDisruptionBudget returns a detailed description for a single PDB.
func (s *Service) PodDisruptionBudget(namespace, name string) (*types.PodDisruptionBudgetDetails, error) {
	client := s.deps.KubernetesClient
	if client == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	pdb, err := client.PolicyV1().PodDisruptionBudgets(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.logError(fmt.Sprintf("Failed to get pod disruption budget %s/%s: %v", namespace, name, err))
		return nil, fmt.Errorf("failed to get pod disruption budget: %v", err)
	}

	return s.buildPodDisruptionBudgetDetails(pdb), nil
}

// PodDisruptionBudgets returns detailed descriptions for all PDBs in the namespace.
func (s *Service) PodDisruptionBudgets(namespace string) ([]*types.PodDisruptionBudgetDetails, error) {
	client := s.deps.KubernetesClient
	if client == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	pdbs, err := client.PolicyV1().PodDisruptionBudgets(namespace).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.logError(fmt.Sprintf("Failed to list pod disruption budgets in namespace %s: %v", namespace, err))
		return nil, fmt.Errorf("failed to list pod disruption budgets: %v", err)
	}

	result := make([]*types.PodDisruptionBudgetDetails, 0, len(pdbs.Items))
	for i := range pdbs.Items {
		result = append(result, s.buildPodDisruptionBudgetDetails(&pdbs.Items[i]))
	}

	return result, nil
}

func (s *Service) buildPodDisruptionBudgetDetails(pdb *policyv1.PodDisruptionBudget) *types.PodDisruptionBudgetDetails {
	model := resourcemodel.BuildPodDisruptionBudgetResourceModel(s.deps.ClusterID, pdb)
	facts := model.Facts.PodDisruptionBudget
	details := &types.PodDisruptionBudgetDetails{
		Kind:               "PodDisruptionBudget",
		Name:               pdb.Name,
		Namespace:          pdb.Namespace,
		Age:                common.FormatAge(pdb.CreationTimestamp.Time),
		Details:            pdbDetailsSummary(facts),
		MinAvailable:       pdbIntOrStringValue(facts.MinAvailable),
		MaxUnavailable:     pdbIntOrStringValue(facts.MaxUnavailable),
		Selector:           facts.Selector,
		CurrentHealthy:     facts.CurrentHealthy,
		DesiredHealthy:     facts.DesiredHealthy,
		DisruptionsAllowed: facts.AllowedDisruptions,
		ExpectedPods:       facts.ExpectedPods,
		ObservedGeneration: facts.ObservedGeneration,
		DisruptedPods:      pdb.Status.DisruptedPods,
		Conditions:         types.FormatConditions(facts.Conditions),
		Labels:             pdb.Labels,
		Annotations:        pdb.Annotations,
	}
	return details
}

func (s *Service) logError(msg string) {
	applog.Error(s.deps.Logger, msg, logsources.ResourceLoader)
}
