package backend

import (
	"fmt"
	"slices"
	"strings"

	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/resourcemodel"
)

// GetClusterAttentionIgnoreRules returns the persisted suppression rules for
// exactly one cluster.
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
	rules := attentionIgnoreRulesFromSection(settings.Clusters[clusterID])
	return &rules, nil
}

func (a *App) IgnoreClusterAttentionObject(clusterID string, ref resourcemodel.ResourceRef) (*snapshot.AttentionIgnoreRules, error) {
	if err := validateAttentionIgnoredObject(clusterID, ref); err != nil {
		return nil, err
	}
	return a.mutateClusterAttentionIgnoreRules(clusterID, func(rules *snapshot.AttentionIgnoreRules) {
		if !slices.Contains(rules.IgnoredObjects, ref) {
			rules.IgnoredObjects = append(rules.IgnoredObjects, ref)
		}
	})
}

func (a *App) RestoreClusterAttentionObject(clusterID string, ref resourcemodel.ResourceRef) (*snapshot.AttentionIgnoreRules, error) {
	if err := validateAttentionIgnoredObject(clusterID, ref); err != nil {
		return nil, err
	}
	return a.mutateClusterAttentionIgnoreRules(clusterID, func(rules *snapshot.AttentionIgnoreRules) {
		rules.IgnoredObjects = slices.DeleteFunc(rules.IgnoredObjects, func(candidate resourcemodel.ResourceRef) bool {
			return candidate == ref
		})
	})
}

func (a *App) IgnoreClusterAttentionFindingType(clusterID, findingType string) (*snapshot.AttentionIgnoreRules, error) {
	if err := validateAttentionFindingType(clusterID, findingType); err != nil {
		return nil, err
	}
	findingType = strings.TrimSpace(findingType)
	return a.mutateClusterAttentionIgnoreRules(clusterID, func(rules *snapshot.AttentionIgnoreRules) {
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
	return a.mutateClusterAttentionIgnoreRules(clusterID, func(rules *snapshot.AttentionIgnoreRules) {
		if index := slices.Index(rules.FindingTypes, findingType); index >= 0 {
			rules.FindingTypes = slices.Delete(rules.FindingTypes, index, index+1)
		}
	})
}

func (a *App) mutateClusterAttentionIgnoreRules(
	clusterID string,
	mutate func(*snapshot.AttentionIgnoreRules),
) (*snapshot.AttentionIgnoreRules, error) {
	return a.persistClusterAttentionIgnoreRules(clusterID, mutate, true)
}

func (a *App) persistClusterAttentionIgnoreRules(
	clusterID string,
	mutate func(*snapshot.AttentionIgnoreRules),
	applyLive bool,
) (*snapshot.AttentionIgnoreRules, error) {
	clusterID = strings.TrimSpace(clusterID)
	if clusterID == "" {
		return nil, fmt.Errorf("clusterID is required")
	}
	a.settingsMu.Lock()
	settings, err := a.loadSettingsFile()
	if err != nil {
		a.settingsMu.Unlock()
		return nil, err
	}
	section := settings.Clusters[clusterID]
	rules := attentionIgnoreRulesFromSection(section)
	mutate(&rules)
	if len(rules.IgnoredObjects) == 0 && len(rules.FindingTypes) == 0 {
		section.Attention = nil
	} else {
		copy := cloneAttentionIgnoreRules(rules)
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
	a.settingsMu.Unlock()

	if applyLive {
		a.applyClusterAttentionIgnoreRules(clusterID, rules)
	}
	result := cloneAttentionIgnoreRules(rules)
	return &result, nil
}

func (a *App) applyClusterAttentionIgnoreRules(clusterID string, rules snapshot.AttentionIgnoreRules) {
	subsystem := a.getRefreshSubsystem(clusterID)
	if subsystem != nil && subsystem.AttentionIndex != nil {
		subsystem.AttentionIndex.SetIgnoreRules(rules)
	}
}

func (a *App) pruneClusterAttentionIgnoredObject(clusterID string, ref resourcemodel.ResourceRef) error {
	if err := validateAttentionIgnoredObject(clusterID, ref); err != nil {
		return err
	}
	_, err := a.persistClusterAttentionIgnoreRules(clusterID, func(rules *snapshot.AttentionIgnoreRules) {
		rules.IgnoredObjects = slices.DeleteFunc(rules.IgnoredObjects, func(candidate resourcemodel.ResourceRef) bool {
			return candidate == ref
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

func attentionIgnoreRulesFromSection(section settingsClusterSection) snapshot.AttentionIgnoreRules {
	if section.Attention == nil {
		return snapshot.AttentionIgnoreRules{}
	}
	return cloneAttentionIgnoreRules(*section.Attention)
}

func cloneAttentionIgnoreRules(rules snapshot.AttentionIgnoreRules) snapshot.AttentionIgnoreRules {
	return snapshot.AttentionIgnoreRules{
		IgnoredObjects: append([]resourcemodel.ResourceRef(nil), rules.IgnoredObjects...),
		FindingTypes:   append([]string(nil), rules.FindingTypes...),
	}
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
