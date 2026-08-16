package backend

import (
	"fmt"
	"slices"
	"strings"

	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/resourcemodel"
)

// GetClusterAttentionIgnoreRules returns the effective suppression rules for
// exactly one cluster, including rules that apply to every cluster.
func (s *ClusterAttentionService) GetClusterAttentionIgnoreRules(clusterID string) (*snapshot.AttentionIgnoreRules, error) {
	clusterID = strings.TrimSpace(clusterID)
	if clusterID == "" {
		return nil, fmt.Errorf("clusterID is required")
	}
	rules, err := s.preferences.readAttentionRules(clusterID)
	if err != nil {
		return nil, err
	}
	return &rules, nil
}

func (s *ClusterAttentionService) IgnoreClusterAttentionObjectFinding(clusterID string, ref resourcemodel.ResourceRef, findingType string) (*snapshot.AttentionIgnoreRules, error) {
	if err := validateAttentionIgnoredObject(clusterID, ref); err != nil {
		return nil, err
	}
	if err := validateAttentionFindingType(clusterID, findingType); err != nil {
		return nil, err
	}
	findingType = strings.TrimSpace(findingType)
	ignore := snapshot.AttentionObjectFindingIgnore{Ref: ref, FindingType: findingType}
	return s.mutateClusterAttentionIgnoreRules(clusterID, func(rules *settingsClusterAttentionRules) {
		if !slices.Contains(rules.ObjectFindings, ignore) {
			rules.ObjectFindings = append(rules.ObjectFindings, ignore)
		}
	})
}

func (s *ClusterAttentionService) RestoreClusterAttentionObjectFinding(clusterID string, ref resourcemodel.ResourceRef, findingType string) (*snapshot.AttentionIgnoreRules, error) {
	if err := validateAttentionIgnoredObject(clusterID, ref); err != nil {
		return nil, err
	}
	if strings.TrimSpace(findingType) == "" {
		return nil, fmt.Errorf("attention finding type is required")
	}
	findingType = strings.TrimSpace(findingType)
	return s.mutateClusterAttentionIgnoreRules(clusterID, func(rules *settingsClusterAttentionRules) {
		rules.ObjectFindings = slices.DeleteFunc(rules.ObjectFindings, func(candidate snapshot.AttentionObjectFindingIgnore) bool {
			return candidate.Ref == ref && candidate.FindingType == findingType
		})
	})
}

func (s *ClusterAttentionService) IgnoreClusterAttentionFindingType(clusterID, findingType string) (*snapshot.AttentionIgnoreRules, error) {
	if err := validateAttentionFindingType(clusterID, findingType); err != nil {
		return nil, err
	}
	findingType = strings.TrimSpace(findingType)
	return s.mutateClusterAttentionIgnoreRules(clusterID, func(rules *settingsClusterAttentionRules) {
		if !slices.Contains(rules.FindingTypes, findingType) {
			rules.FindingTypes = append(rules.FindingTypes, findingType)
		}
	})
}

func (s *ClusterAttentionService) RestoreClusterAttentionFindingType(clusterID, findingType string) (*snapshot.AttentionIgnoreRules, error) {
	if strings.TrimSpace(clusterID) == "" {
		return nil, fmt.Errorf("clusterID is required")
	}
	if strings.TrimSpace(findingType) == "" {
		return nil, fmt.Errorf("attention finding type is required")
	}
	findingType = strings.TrimSpace(findingType)
	return s.mutateClusterAttentionIgnoreRules(clusterID, func(rules *settingsClusterAttentionRules) {
		rules.FindingTypes = slices.DeleteFunc(rules.FindingTypes, func(candidate string) bool {
			return candidate == findingType
		})
	})
}

func (s *ClusterAttentionService) IgnoreGlobalAttentionFindingType(clusterID, findingType string) (*snapshot.AttentionIgnoreRules, error) {
	if err := validateAttentionFindingType(clusterID, findingType); err != nil {
		return nil, err
	}
	findingType = strings.TrimSpace(findingType)
	return s.mutateGlobalAttentionIgnoreRules(clusterID, func(rules *settingsGlobalAttentionRules) {
		if !slices.Contains(rules.FindingTypes, findingType) {
			rules.FindingTypes = append(rules.FindingTypes, findingType)
		}
	})
}

func (s *ClusterAttentionService) RestoreGlobalAttentionFindingType(clusterID, findingType string) (*snapshot.AttentionIgnoreRules, error) {
	if strings.TrimSpace(clusterID) == "" {
		return nil, fmt.Errorf("clusterID is required")
	}
	if strings.TrimSpace(findingType) == "" {
		return nil, fmt.Errorf("attention finding type is required")
	}
	findingType = strings.TrimSpace(findingType)
	return s.mutateGlobalAttentionIgnoreRules(clusterID, func(rules *settingsGlobalAttentionRules) {
		rules.FindingTypes = slices.DeleteFunc(rules.FindingTypes, func(candidate string) bool {
			return candidate == findingType
		})
	})
}

func (s *ClusterAttentionService) mutateClusterAttentionIgnoreRules(
	clusterID string,
	mutate func(*settingsClusterAttentionRules),
) (*snapshot.AttentionIgnoreRules, error) {
	return s.persistClusterAttentionIgnoreRules(clusterID, mutate, true)
}

func (s *ClusterAttentionService) persistClusterAttentionIgnoreRules(
	clusterID string,
	mutate func(*settingsClusterAttentionRules),
	applyLive bool,
) (*snapshot.AttentionIgnoreRules, error) {
	clusterID = strings.TrimSpace(clusterID)
	if clusterID == "" {
		return nil, fmt.Errorf("clusterID is required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	effective, err := s.preferences.updateClusterAttentionRules(clusterID, mutate)
	if err != nil {
		return nil, err
	}

	if applyLive {
		s.applyAttentionIgnoreRulesToTarget(s.targets[clusterID], effective)
	}
	result := cloneAttentionIgnoreRules(effective)
	return &result, nil
}

func (s *ClusterAttentionService) mutateGlobalAttentionIgnoreRules(
	resultClusterID string,
	mutate func(*settingsGlobalAttentionRules),
) (*snapshot.AttentionIgnoreRules, error) {
	resultClusterID = strings.TrimSpace(resultClusterID)
	if resultClusterID == "" {
		return nil, fmt.Errorf("clusterID is required")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	clusterIDs := make([]string, 0, len(s.targets))
	for clusterID := range s.targets {
		clusterIDs = append(clusterIDs, clusterID)
	}
	result, effectiveByCluster, err := s.preferences.updateGlobalAttentionRules(resultClusterID, clusterIDs, mutate)
	if err != nil {
		return nil, err
	}
	for clusterID, rules := range effectiveByCluster {
		s.applyAttentionIgnoreRulesToTarget(s.targets[clusterID], rules)
	}
	cloned := cloneAttentionIgnoreRules(result)
	return &cloned, nil
}

func (s *ClusterAttentionService) applyAttentionIgnoreRulesToTarget(target attentionIndexTarget, rules snapshot.AttentionIgnoreRules) {
	if target != nil {
		target.SetIgnoreRules(rules)
	}
}

func (s *ClusterAttentionService) syncTarget(clusterID string, target attentionIndexTarget) {
	rules, err := s.GetClusterAttentionIgnoreRules(clusterID)
	if err != nil {
		if s.logger != nil {
			s.logger.Warn(fmt.Sprintf("Could not read Attention ignores for cluster %s: %v", clusterID, err), logsources.Settings, clusterID, clusterID)
		}
		return
	}
	s.applyAttentionIgnoreRulesToTarget(target, *rules)
}

func (s *ClusterAttentionService) pruneClusterAttentionIgnoredObject(clusterID string, ref resourcemodel.ResourceRef) error {
	if err := validateAttentionIgnoredObject(clusterID, ref); err != nil {
		return err
	}
	_, err := s.persistClusterAttentionIgnoreRules(clusterID, func(rules *settingsClusterAttentionRules) {
		rules.ObjectFindings = slices.DeleteFunc(rules.ObjectFindings, func(candidate snapshot.AttentionObjectFindingIgnore) bool {
			return candidate.Ref == ref
		})
	}, false)
	return err
}

func (s *ClusterAttentionService) attentionIgnoreRulesForCluster(clusterID string) snapshot.AttentionIgnoreRules {
	rules, err := s.GetClusterAttentionIgnoreRules(clusterID)
	if err != nil {
		if s.logger != nil {
			s.logger.Warn(fmt.Sprintf("Could not read Attention ignores for cluster %s: %v", clusterID, err), logsources.Settings, clusterID, clusterID)
		}
		return snapshot.AttentionIgnoreRules{}
	}
	return *rules
}

func clusterAttentionIgnoreRulesFromSection(section settingsClusterSection) settingsClusterAttentionRules {
	if section.Attention == nil {
		return settingsClusterAttentionRules{}
	}
	return cloneClusterAttentionIgnoreRules(*section.Attention)
}

func globalAttentionIgnoreRulesFromSettings(rules *settingsGlobalAttentionRules) settingsGlobalAttentionRules {
	if rules == nil {
		return settingsGlobalAttentionRules{}
	}
	return cloneGlobalAttentionIgnoreRules(*rules)
}

func effectiveAttentionIgnoreRules(section settingsClusterSection, global *settingsGlobalAttentionRules) snapshot.AttentionIgnoreRules {
	clusterRules := clusterAttentionIgnoreRulesFromSection(section)
	globalRules := globalAttentionIgnoreRulesFromSettings(global)
	return snapshot.AttentionIgnoreRules{
		ObjectFindings:      append([]snapshot.AttentionObjectFindingIgnore(nil), clusterRules.ObjectFindings...),
		ClusterFindingTypes: append([]string(nil), clusterRules.FindingTypes...),
		GlobalFindingTypes:  append([]string(nil), globalRules.FindingTypes...),
	}
}

func cloneClusterAttentionIgnoreRules(rules settingsClusterAttentionRules) settingsClusterAttentionRules {
	return settingsClusterAttentionRules{
		ObjectFindings: append([]snapshot.AttentionObjectFindingIgnore(nil), rules.ObjectFindings...),
		FindingTypes:   append([]string(nil), rules.FindingTypes...),
	}
}

func cloneGlobalAttentionIgnoreRules(rules settingsGlobalAttentionRules) settingsGlobalAttentionRules {
	return settingsGlobalAttentionRules{FindingTypes: append([]string(nil), rules.FindingTypes...)}
}

func cloneAttentionIgnoreRules(rules snapshot.AttentionIgnoreRules) snapshot.AttentionIgnoreRules {
	return snapshot.AttentionIgnoreRules{
		ObjectFindings:      append([]snapshot.AttentionObjectFindingIgnore(nil), rules.ObjectFindings...),
		ClusterFindingTypes: append([]string(nil), rules.ClusterFindingTypes...),
		GlobalFindingTypes:  append([]string(nil), rules.GlobalFindingTypes...),
	}
}

func clusterAttentionIgnoreRulesEmpty(rules settingsClusterAttentionRules) bool {
	return len(rules.ObjectFindings) == 0 && len(rules.FindingTypes) == 0
}

func validateAttentionIgnoredObject(clusterID string, ref resourcemodel.ResourceRef) error {
	clusterID = strings.TrimSpace(clusterID)
	if clusterID == "" {
		return fmt.Errorf("clusterID is required")
	}
	if ref.ClusterID != clusterID {
		return fmt.Errorf("object clusterId %q does not match clusterID %q", ref.ClusterID, clusterID)
	}
	for field, value := range map[string]string{
		"version": ref.Version, "kind": ref.Kind, "resource": ref.Resource, "name": ref.Name, "uid": ref.UID,
	} {
		if strings.TrimSpace(value) == "" {
			return fmt.Errorf("object %s is required", field)
		}
	}
	return nil
}

func validateAttentionFindingType(clusterID, findingType string) error {
	if strings.TrimSpace(clusterID) == "" {
		return fmt.Errorf("clusterID is required")
	}
	if !snapshot.IsAttentionFindingType(findingType) {
		return fmt.Errorf("unknown Attention finding type %q", findingType)
	}
	return nil
}
