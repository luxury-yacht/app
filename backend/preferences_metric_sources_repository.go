package backend

func (p *PreferencesService) readMetricSourceSettings() (MetricSourceSettings, error) {
	p.settingsMu.Lock()
	defer p.settingsMu.Unlock()
	settings, err := p.loadSettingsFile()
	if err != nil {
		return MetricSourceSettings{}, err
	}
	return metricSourceSettingsFromFile(settings), nil
}

func (p *PreferencesService) updateMetricSourceSettings(
	mutate func(*MetricSourceSettings) error,
) (MetricSourceSettings, error) {
	p.settingsMu.Lock()
	defer p.settingsMu.Unlock()
	settings, err := p.loadSettingsFile()
	if err != nil {
		return MetricSourceSettings{}, err
	}
	next := metricSourceSettingsFromFile(settings)
	if err := mutate(&next); err != nil {
		return MetricSourceSettings{}, err
	}
	writeMetricSourceSettings(settings, next)
	if err := p.saveSettingsFile(settings); err != nil {
		return MetricSourceSettings{}, err
	}
	return next, nil
}

func metricSourceSettingsFromFile(settings *settingsFile) MetricSourceSettings {
	result := MetricSourceSettings{Sources: []MetricSource{}, Assignments: map[string]MetricClusterAssignment{}}
	if settings.Metrics != nil {
		for _, source := range settings.Metrics.Sources {
			result.Sources = append(result.Sources, cloneMetricSource(source))
		}
	}
	for clusterID, section := range settings.Clusters {
		if section.Metrics != nil {
			result.Assignments[clusterID] = *section.Metrics
		}
	}
	return result
}

// writeMetricSourceSettings stores sources and assignments, pruning cluster sections that no
// longer hold any setting.
func writeMetricSourceSettings(settings *settingsFile, next MetricSourceSettings) {
	settings.Metrics = nil
	if len(next.Sources) > 0 {
		settings.Metrics = &settingsMetrics{Sources: next.Sources}
	}
	clusterIDs := make(map[string]struct{}, len(settings.Clusters)+len(next.Assignments))
	for clusterID := range settings.Clusters {
		clusterIDs[clusterID] = struct{}{}
	}
	for clusterID := range next.Assignments {
		clusterIDs[clusterID] = struct{}{}
	}
	for clusterID := range clusterIDs {
		section := settings.Clusters[clusterID]
		section.Metrics = nil
		if assignment, ok := next.Assignments[clusterID]; ok {
			section.Metrics = &assignment
		}
		if clusterSettingsSectionEmpty(section) {
			delete(settings.Clusters, clusterID)
			continue
		}
		if settings.Clusters == nil {
			settings.Clusters = make(map[string]settingsClusterSection)
		}
		settings.Clusters[clusterID] = section
	}
}

func cloneMetricSource(source MetricSource) MetricSource {
	if source.InCluster != nil {
		target := *source.InCluster
		source.InCluster = &target
	}
	return source
}
