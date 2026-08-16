package backend

import "github.com/luxury-yacht/app/backend/refresh/snapshot"

func (p *PreferencesService) readAttentionRules(clusterID string) (snapshot.AttentionIgnoreRules, error) {
	p.settingsMu.Lock()
	defer p.settingsMu.Unlock()
	settings, err := p.loadSettingsFile()
	if err != nil {
		return snapshot.AttentionIgnoreRules{}, err
	}
	return effectiveAttentionIgnoreRules(settings.Clusters[clusterID], settings.Attention), nil
}

func (p *PreferencesService) updateClusterAttentionRules(
	clusterID string,
	mutate func(*settingsClusterAttentionRules),
) (snapshot.AttentionIgnoreRules, error) {
	p.settingsMu.Lock()
	defer p.settingsMu.Unlock()
	settings, err := p.loadSettingsFile()
	if err != nil {
		return snapshot.AttentionIgnoreRules{}, err
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
	if err := p.saveSettingsFile(settings); err != nil {
		return snapshot.AttentionIgnoreRules{}, err
	}
	return effectiveAttentionIgnoreRules(section, settings.Attention), nil
}

func (p *PreferencesService) updateGlobalAttentionRules(
	resultClusterID string,
	clusterIDs []string,
	mutate func(*settingsGlobalAttentionRules),
) (snapshot.AttentionIgnoreRules, map[string]snapshot.AttentionIgnoreRules, error) {
	p.settingsMu.Lock()
	defer p.settingsMu.Unlock()
	settings, err := p.loadSettingsFile()
	if err != nil {
		return snapshot.AttentionIgnoreRules{}, nil, err
	}
	globalRules := globalAttentionIgnoreRulesFromSettings(settings.Attention)
	mutate(&globalRules)
	if len(globalRules.FindingTypes) == 0 {
		settings.Attention = nil
	} else {
		copy := cloneGlobalAttentionIgnoreRules(globalRules)
		settings.Attention = &copy
	}
	if err := p.saveSettingsFile(settings); err != nil {
		return snapshot.AttentionIgnoreRules{}, nil, err
	}
	result := effectiveAttentionIgnoreRules(settings.Clusters[resultClusterID], settings.Attention)
	effective := make(map[string]snapshot.AttentionIgnoreRules, len(clusterIDs))
	for _, clusterID := range clusterIDs {
		effective[clusterID] = effectiveAttentionIgnoreRules(settings.Clusters[clusterID], settings.Attention)
	}
	return result, effective, nil
}
