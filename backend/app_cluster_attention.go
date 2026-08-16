package backend

import (
	"fmt"
	"slices"
	"strings"

	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/luxury-yacht/app/backend/resourcemodel"
)

// GetClusterAttentionIgnoreRules returns the effective suppression rules for
// exactly one cluster, including rules that apply to every cluster.
func (a *App) GetClusterAttentionIgnoreRules(clusterID string) (*snapshot.AttentionIgnoreRules, error) {
	clusterID = strings.TrimSpace(clusterID)
	if clusterID == "" {
		return nil, fmt.Errorf("clusterID is required")
	}
	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()
	settings, err := a.loadSettingsFile()
	if err != nil {
		return nil, err
	}
	rules := effectiveAttentionIgnoreRules(settings.Clusters[clusterID], settings.Attention)
	return &rules, nil
}

func (a *App) IgnoreClusterAttentionObjectFinding(clusterID string, ref resourcemodel.ResourceRef, findingType string) (*snapshot.AttentionIgnoreRules, error) {
	if err := validateAttentionIgnoredObject(clusterID, ref); err != nil {
		return nil, err
	}
	if err := validateAttentionFindingType(clusterID, findingType); err != nil {
		return nil, err
	}
	findingType = strings.TrimSpace(findingType)
	ignore := snapshot.AttentionObjectFindingIgnore{Ref: ref, FindingType: findingType}
	return a.mutateClusterAttentionIgnoreRules(clusterID, func(rules *settingsClusterAttentionRules) {
		if !slices.Contains(rules.ObjectFindings, ignore) {
			rules.ObjectFindings = append(rules.ObjectFindings, ignore)
		}
	})
}

func (a *App) RestoreClusterAttentionObjectFinding(clusterID string, ref resourcemodel.ResourceRef, findingType string) (*snapshot.AttentionIgnoreRules, error) {
	if err := validateAttentionIgnoredObject(clusterID, ref); err != nil {
		return nil, err
	}
	if strings.TrimSpace(findingType) == "" {
		return nil, fmt.Errorf("attention finding type is required")
	}
	findingType = strings.TrimSpace(findingType)
	return a.mutateClusterAttentionIgnoreRules(clusterID, func(rules *settingsClusterAttentionRules) {
		rules.ObjectFindings = slices.DeleteFunc(rules.ObjectFindings, func(candidate snapshot.AttentionObjectFindingIgnore) bool {
			return candidate.Ref == ref && candidate.FindingType == findingType
		})
	})
}

func (a *App) IgnoreClusterAttentionFindingType(clusterID, findingType string) (*snapshot.AttentionIgnoreRules, error) {
	if err := validateAttentionFindingType(clusterID, findingType); err != nil {
		return nil, err
	}
	findingType = strings.TrimSpace(findingType)
	return a.mutateClusterAttentionIgnoreRules(clusterID, func(rules *settingsClusterAttentionRules) {
		if !slices.Contains(rules.FindingTypes, findingType) {
			rules.FindingTypes = append(rules.FindingTypes, findingType)
		}
	})
}

func (a *App) RestoreClusterAttentionFindingType(clusterID, findingType string) (*snapshot.AttentionIgnoreRules, error) {
	if strings.TrimSpace(clusterID) == "" {
		return nil, fmt.Errorf("clusterID is required")
	}
	if strings.TrimSpace(findingType) == "" {
		return nil, fmt.Errorf("attention finding type is required")
	}
	findingType = strings.TrimSpace(findingType)
	return a.mutateClusterAttentionIgnoreRules(clusterID, func(rules *settingsClusterAttentionRules) {
		rules.FindingTypes = slices.DeleteFunc(rules.FindingTypes, func(candidate string) bool {
			return candidate == findingType
		})
	})
}

func (a *App) IgnoreGlobalAttentionFindingType(clusterID, findingType string) (*snapshot.AttentionIgnoreRules, error) {
	if err := validateAttentionFindingType(clusterID, findingType); err != nil {
		return nil, err
	}
	findingType = strings.TrimSpace(findingType)
	return a.mutateGlobalAttentionIgnoreRules(clusterID, func(rules *settingsGlobalAttentionRules) {
		if !slices.Contains(rules.FindingTypes, findingType) {
			rules.FindingTypes = append(rules.FindingTypes, findingType)
		}
	})
}

func (a *App) RestoreGlobalAttentionFindingType(clusterID, findingType string) (*snapshot.AttentionIgnoreRules, error) {
	if strings.TrimSpace(clusterID) == "" {
		return nil, fmt.Errorf("clusterID is required")
	}
	if strings.TrimSpace(findingType) == "" {
		return nil, fmt.Errorf("attention finding type is required")
	}
	findingType = strings.TrimSpace(findingType)
	return a.mutateGlobalAttentionIgnoreRules(clusterID, func(rules *settingsGlobalAttentionRules) {
		rules.FindingTypes = slices.DeleteFunc(rules.FindingTypes, func(candidate string) bool {
			return candidate == findingType
		})
	})
}

func (a *App) mutateClusterAttentionIgnoreRules(
	clusterID string,
	mutate func(*settingsClusterAttentionRules),
) (*snapshot.AttentionIgnoreRules, error) {
	return a.persistClusterAttentionIgnoreRules(clusterID, mutate, true)
}

func (a *App) persistClusterAttentionIgnoreRules(
	clusterID string,
	mutate func(*settingsClusterAttentionRules),
	applyLive bool,
) (*snapshot.AttentionIgnoreRules, error) {
	clusterID = strings.TrimSpace(clusterID)
	if clusterID == "" {
		return nil, fmt.Errorf("clusterID is required")
	}
	a.attentionRulesMu.Lock()
	defer a.attentionRulesMu.Unlock()
	a.settingsMu.Lock()
	settings, err := a.loadSettingsFile()
	if err != nil {
		a.settingsMu.Unlock()
		return nil, err
	}
	section := settings.Clusters[clusterID]
	rules := clusterAttentionIgnoreRulesFromSection(section)
	mutate(&rules)
	if clusterAttentionIgnoreRulesEmpty(rules) {
		section.Attention = nil
	} else {
		copy := cloneClusterAttentionIgnoreRules(rules)
		section.Attention = &copy
	}
	if settings.Clusters == nil {
		settings.Clusters = make(map[string]settingsClusterSection)
	}
	if clusterSettingsSectionEmpty(section) {
		delete(settings.Clusters, clusterID)
	} else {
		settings.Clusters[clusterID] = section
	}
	if err := a.saveSettingsFile(settings); err != nil {
		a.settingsMu.Unlock()
		return nil, err
	}
	effective := effectiveAttentionIgnoreRules(section, settings.Attention)
	a.settingsMu.Unlock()

	if applyLive {
		a.applyClusterAttentionIgnoreRules(clusterID, effective)
	}
	result := cloneAttentionIgnoreRules(effective)
	return &result, nil
}

func (a *App) mutateGlobalAttentionIgnoreRules(
	resultClusterID string,
	mutate func(*settingsGlobalAttentionRules),
) (*snapshot.AttentionIgnoreRules, error) {
	resultClusterID = strings.TrimSpace(resultClusterID)
	if resultClusterID == "" {
		return nil, fmt.Errorf("clusterID is required")
	}
	a.attentionRulesMu.Lock()
	defer a.attentionRulesMu.Unlock()
	a.settingsMu.Lock()
	settings, err := a.loadSettingsFile()
	if err != nil {
		a.settingsMu.Unlock()
		return nil, err
	}
	globalRules := globalAttentionIgnoreRulesFromSettings(settings.Attention)
	mutate(&globalRules)
	if len(globalRules.FindingTypes) == 0 {
		settings.Attention = nil
	} else {
		copy := cloneGlobalAttentionIgnoreRules(globalRules)
		settings.Attention = &copy
	}
	if err := a.saveSettingsFile(settings); err != nil {
		a.settingsMu.Unlock()
		return nil, err
	}
	result := effectiveAttentionIgnoreRules(settings.Clusters[resultClusterID], settings.Attention)
	a.settingsMu.Unlock()

	effectiveByCluster := make(map[string]snapshot.AttentionIgnoreRules)
	for clusterID := range a.snapshotRefreshSubsystems() {
		effectiveByCluster[clusterID] = effectiveAttentionIgnoreRules(settings.Clusters[clusterID], settings.Attention)
	}

	for clusterID, rules := range effectiveByCluster {
		a.applyClusterAttentionIgnoreRules(clusterID, rules)
	}
	cloned := cloneAttentionIgnoreRules(result)
	return &cloned, nil
}

func (a *App) applyClusterAttentionIgnoreRules(clusterID string, rules snapshot.AttentionIgnoreRules) {
	a.applyAttentionIgnoreRulesToSubsystem(a.getRefreshSubsystem(clusterID), rules)
}

func (a *App) applyAttentionIgnoreRulesToSubsystem(subsystem *system.Subsystem, rules snapshot.AttentionIgnoreRules) {
	if subsystem != nil && subsystem.AttentionIndex != nil {
		subsystem.AttentionIndex.SetIgnoreRules(rules)
	}
}

func (a *App) syncAttentionIgnoreRulesForSubsystem(clusterID string, subsystem *system.Subsystem) {
	if subsystem == nil || subsystem.AttentionIndex == nil {
		return
	}
	a.attentionRulesMu.Lock()
	defer a.attentionRulesMu.Unlock()
	rules, err := a.GetClusterAttentionIgnoreRules(clusterID)
	if err != nil {
		a.logger.Warn(fmt.Sprintf("Could not read Attention ignores for cluster %s: %v", clusterID, err), logsources.Settings, clusterID, clusterID)
		return
	}
	a.applyAttentionIgnoreRulesToSubsystem(subsystem, *rules)
}

func (a *App) pruneClusterAttentionIgnoredObject(clusterID string, ref resourcemodel.ResourceRef) error {
	if err := validateAttentionIgnoredObject(clusterID, ref); err != nil {
		return err
	}
	_, err := a.persistClusterAttentionIgnoreRules(clusterID, func(rules *settingsClusterAttentionRules) {
		rules.ObjectFindings = slices.DeleteFunc(rules.ObjectFindings, func(candidate snapshot.AttentionObjectFindingIgnore) bool {
			return candidate.Ref == ref
		})
	}, false)
	return err
}

func (a *App) attentionIgnoreRulesForCluster(clusterID string) snapshot.AttentionIgnoreRules {
	rules, err := a.GetClusterAttentionIgnoreRules(clusterID)
	if err != nil {
		a.logger.Warn(fmt.Sprintf("Could not read Attention ignores for cluster %s: %v", clusterID, err), logsources.Settings, clusterID, clusterID)
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
