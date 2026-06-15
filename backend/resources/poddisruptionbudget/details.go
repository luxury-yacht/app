/*
 * backend/resources/poddisruptionbudget/details.go
 *
 * PodDisruptionBudget resource handlers, co-located in the per-kind package.
 * Intrinsic fields come from the single model (poddisruptionbudget.Facts).
 */

package poddisruptionbudget

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	policyv1 "k8s.io/api/policy/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Service provides detailed PodDisruptionBudget views backed by shared dependencies.
type Service struct {
	deps common.Dependencies
}

// NewService constructs a PodDisruptionBudget service using the supplied dependencies bundle.
func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}

// PodDisruptionBudget returns a detailed description for a single PDB.
func (s *Service) PodDisruptionBudget(namespace, name string) (*PodDisruptionBudgetDetails, error) {
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
func (s *Service) PodDisruptionBudgets(namespace string) ([]*PodDisruptionBudgetDetails, error) {
	client := s.deps.KubernetesClient
	if client == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	pdbs, err := client.PolicyV1().PodDisruptionBudgets(namespace).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.logError(fmt.Sprintf("Failed to list pod disruption budgets in namespace %s: %v", namespace, err))
		return nil, fmt.Errorf("failed to list pod disruption budgets: %v", err)
	}

	result := make([]*PodDisruptionBudgetDetails, 0, len(pdbs.Items))
	for i := range pdbs.Items {
		result = append(result, s.buildPodDisruptionBudgetDetails(&pdbs.Items[i]))
	}

	return result, nil
}

func (s *Service) buildPodDisruptionBudgetDetails(pdb *policyv1.PodDisruptionBudget) *PodDisruptionBudgetDetails {
	facts := BuildFacts(s.deps.ClusterID, pdb)
	details := &PodDisruptionBudgetDetails{
		Kind:               "PodDisruptionBudget",
		Name:               pdb.Name,
		Namespace:          pdb.Namespace,
		Age:                common.FormatAge(pdb.CreationTimestamp.Time),
		Details:            detailsSummary(facts),
		MinAvailable:       pdbIntOrStringValue(facts.MinAvailable),
		MaxUnavailable:     pdbIntOrStringValue(facts.MaxUnavailable),
		Selector:           facts.Selector,
		CurrentHealthy:     facts.CurrentHealthy,
		DesiredHealthy:     facts.DesiredHealthy,
		DisruptionsAllowed: facts.AllowedDisruptions,
		ExpectedPods:       facts.ExpectedPods,
		ObservedGeneration: facts.ObservedGeneration,
		DisruptedPods:      pdb.Status.DisruptedPods,
		Conditions:         restypes.FormatConditions(facts.Conditions),
		Labels:             pdb.Labels,
		Annotations:        pdb.Annotations,
	}
	return details
}

func (s *Service) logError(msg string) {
	applog.Error(s.deps.Logger, msg, logsources.ResourceLoader)
}

func pdbIntOrStringValue(facts *resourcemodel.IntOrStringFacts) *string {
	if facts == nil {
		return nil
	}
	value := facts.Value
	return &value
}

// detailsSummary is the detail-view summary string (selector + availability + health).
func detailsSummary(facts Facts) string {
	selectorSummary := "No selector"
	if len(facts.Selector) > 0 {
		selectorSummary = fmt.Sprintf("Selector: %d labels", len(facts.Selector))
	}
	availability := ""
	if facts.MinAvailable != nil {
		availability = fmt.Sprintf(", MinAvailable: %s", facts.MinAvailable.Value)
	}
	if facts.MaxUnavailable != nil {
		availability += fmt.Sprintf(", MaxUnavailable: %s", facts.MaxUnavailable.Value)
	}
	status := fmt.Sprintf(", Healthy: %d/%d, Disruptions Allowed: %d",
		facts.CurrentHealthy, facts.DesiredHealthy, facts.AllowedDisruptions)
	return selectorSummary + availability + status
}
