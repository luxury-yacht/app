package backend

import "slices"

func (p *PreferencesService) SetDiscoveredKubeconfigSearchPaths(paths []string) {
	p.settingsMu.Lock()
	p.kubeconfigSearchPaths = append([]string(nil), paths...)
	p.settingsMu.Unlock()
}

func (p *PreferencesService) DiscoveredKubeconfigSearchPaths() []string {
	p.settingsMu.Lock()
	defer p.settingsMu.Unlock()
	return append([]string(nil), p.kubeconfigSearchPaths...)
}

func (p *PreferencesService) MetricsRefreshIntervalMs() int {
	p.settingsMu.Lock()
	defer p.settingsMu.Unlock()
	if p.appSettings == nil || p.appSettings.MetricsRefreshIntervalMs <= 0 {
		return defaultMetricsIntervalMs()
	}
	return p.appSettings.MetricsRefreshIntervalMs
}

func (p *PreferencesService) exportSettingsDocument() (*settingsFile, error) {
	p.settingsMu.Lock()
	defer p.settingsMu.Unlock()
	return p.loadSettingsFile()
}

func (p *PreferencesService) importSettingsDocument(document *settingsDataFile, effects settingsSideEffects) error {
	if _, err := p.EnsureLoaded(); err != nil {
		return err
	}
	p.settingsMu.Lock()
	current, err := p.loadSettingsFile()
	if err != nil {
		p.settingsMu.Unlock()
		return err
	}
	previous := copyAppSettings(p.appSettings)
	previousProvenance := p.provenance
	current.Preferences = document.Preferences
	current.Kubeconfig.SearchPaths = append([]string(nil), document.KubeconfigSearchPaths...)
	next := appSettingsFromFile(current)
	p.appSettings = next
	p.provenance = PreferencesLoaded
	if err := p.saveSettingsFile(current); err != nil {
		p.appSettings = previous
		p.provenance = previousProvenance
		p.settingsMu.Unlock()
		return err
	}
	p.settingsMu.Unlock()
	if p.effects != nil {
		p.effects.Dispatch(copyAppSettings(next), effects)
	}
	return nil
}

func (p *PreferencesService) clusterAllowedNamespaces(clusterID string) ([]string, error) {
	p.settingsMu.Lock()
	defer p.settingsMu.Unlock()
	settings, err := p.loadSettingsFile()
	if err != nil {
		return nil, err
	}
	return append([]string(nil), settings.Clusters[clusterID].AllowedNamespaces...), nil
}

func (p *PreferencesService) saveClusterAllowedNamespaces(clusterID string, namespaces []string) ([]string, error) {
	p.settingsMu.Lock()
	defer p.settingsMu.Unlock()
	settings, err := p.loadSettingsFile()
	if err != nil {
		return nil, err
	}
	section := settings.Clusters[clusterID]
	previous := append([]string(nil), section.AllowedNamespaces...)
	if slices.Equal(previous, namespaces) {
		return previous, nil
	}
	section.AllowedNamespaces = append([]string(nil), namespaces...)
	if clusterSettingsSectionEmpty(section) {
		delete(settings.Clusters, clusterID)
	} else {
		if settings.Clusters == nil {
			settings.Clusters = make(map[string]settingsClusterSection)
		}
		settings.Clusters[clusterID] = section
	}
	if err := p.saveSettingsFile(settings); err != nil {
		return nil, err
	}
	return previous, nil
}

func (p *PreferencesService) KubeconfigSearchPaths() ([]string, error) {
	p.settingsMu.Lock()
	defer p.settingsMu.Unlock()
	settings, err := p.loadSettingsFile()
	if err != nil {
		return nil, err
	}
	return normalizeKubeconfigSearchPaths(settings.Kubeconfig.SearchPaths), nil
}

func (p *PreferencesService) GetKubeconfigSearchPaths() ([]string, error) {
	paths, err := p.KubeconfigSearchPaths()
	if err != nil {
		return nil, err
	}
	return append([]string(nil), paths...), nil
}

func (p *PreferencesService) SaveKubeconfigSearchPaths(paths []string) error {
	p.settingsMu.Lock()
	defer p.settingsMu.Unlock()
	settings, err := p.loadSettingsFile()
	if err != nil {
		return err
	}
	settings.Kubeconfig.SearchPaths = append([]string(nil), paths...)
	if err := p.saveSettingsFile(settings); err != nil {
		return err
	}
	p.kubeconfigSearchPaths = append([]string(nil), paths...)
	return nil
}

func (p *PreferencesService) SelectedKubeconfigs() []string {
	if p == nil {
		return nil
	}
	p.settingsMu.Lock()
	defer p.settingsMu.Unlock()
	if p.appSettings == nil {
		return nil
	}
	return append([]string(nil), p.appSettings.SelectedKubeconfigs...)
}

func (p *PreferencesService) SetSelectedKubeconfigsSnapshot(selections []string) {
	if p == nil {
		return
	}
	p.settingsMu.Lock()
	if p.appSettings != nil {
		p.appSettings.SelectedKubeconfigs = append([]string(nil), selections...)
	}
	p.settingsMu.Unlock()
}

func (p *PreferencesService) SaveSelectedKubeconfigs(selections []string) error {
	if _, err := p.EnsureLoadedForStartup(); err != nil {
		return err
	}
	p.settingsMu.Lock()
	defer p.settingsMu.Unlock()
	p.appSettings.SelectedKubeconfigs = append([]string(nil), selections...)
	return p.saveAppSettings()
}

func (p *PreferencesService) prepareInstallationTelemetry() (string, bool, error) {
	p.settingsMu.Lock()
	defer p.settingsMu.Unlock()
	settings, err := p.loadSettingsFile()
	if err != nil {
		return "", false, err
	}
	created, err := ensureAnonymizedID(settings)
	if err != nil {
		return "", false, err
	}
	if created {
		if err := p.saveSettingsFile(settings); err != nil {
			return "", false, err
		}
	}
	return settings.Telemetry.AnonymizedID, settings.Telemetry.InstallationMetricReported, nil
}

func (p *PreferencesService) acknowledgeInstallationTelemetry(anonymizedID string) error {
	p.settingsMu.Lock()
	defer p.settingsMu.Unlock()
	settings, err := p.loadSettingsFile()
	if err != nil {
		return err
	}
	if settings.Telemetry.AnonymizedID != anonymizedID {
		return nil
	}
	settings.Telemetry.InstallationMetricReported = true
	return p.saveSettingsFile(settings)
}
