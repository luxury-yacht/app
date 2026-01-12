/*
 * backend/resources/helm/helm_releases.go
 *
 * Helm release operations.
 * - Fetches release details, manifests, and values.
 */

package helm

import (
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/types"
	"golang.org/x/text/cases"
	"golang.org/x/text/language"
	"gopkg.in/yaml.v2"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/cli"
)

// ReleaseDetails returns detailed information about a Helm release.
func (s *Service) ReleaseDetails(namespace, name string) (*types.HelmReleaseDetails, error) {
	if err := s.ensureClient(); err != nil {
		return nil, err
	}

	settings := s.helmSettings()
	actionConfig, err := s.initActionConfig(settings, namespace)
	if err != nil {
		return nil, err
	}

	client := action.NewGet(actionConfig)
	release, err := client.Run(name)
	if err != nil {
		return nil, fmt.Errorf("failed to get release %s: %w", name, err)
	}

	historyClient := action.NewHistory(actionConfig)
	history, err := historyClient.Run(name)
	if err != nil {
		s.logWarn(fmt.Sprintf("Failed to get Helm history for %s/%s: %v", namespace, name, err))
	}

	details := &types.HelmReleaseDetails{
		Kind:        "helmrelease",
		Name:        release.Name,
		Namespace:   release.Namespace,
		Age:         common.FormatAge(release.Info.FirstDeployed.Time),
		Chart:       fmt.Sprintf("%s-%s", release.Chart.Name(), release.Chart.Metadata.Version),
		Version:     release.Chart.Metadata.Version,
		AppVersion:  release.Chart.Metadata.AppVersion,
		Status:      cases.Title(language.English).String(strings.ToLower(release.Info.Status.String())),
		Revision:    release.Version,
		Updated:     common.FormatAge(release.Info.LastDeployed.Time),
		Description: release.Info.Description,
		Notes:       release.Info.Notes,
		Values:      release.Config,
		Labels:      release.Labels,
		Annotations: release.Chart.Metadata.Annotations,
	}

	for _, h := range history {
		details.History = append(details.History, types.HelmRevision{
			Revision:    h.Version,
			Updated:     common.FormatAge(h.Info.LastDeployed.Time),
			Status:      cases.Title(language.English).String(strings.ToLower(h.Info.Status.String())),
			Chart:       fmt.Sprintf("%s-%s", h.Chart.Name(), h.Chart.Metadata.Version),
			AppVersion:  h.Chart.Metadata.AppVersion,
			Description: h.Info.Description,
		})
	}

	s.logDebug(fmt.Sprintf("Release %s/%s manifest size: %d", namespace, name, len(release.Manifest)))
	details.Resources = s.extractResourcesFromManifest(release.Manifest, namespace)
	s.logDebug(fmt.Sprintf("Extracted %d resources for release %s/%s", len(details.Resources), namespace, name))

	return details, nil
}

// ReleaseManifest returns the rendered manifest for a Helm release.
func (s *Service) ReleaseManifest(namespace, name string) (string, error) {
	if err := s.ensureClient(); err != nil {
		return "", err
	}

	settings := s.helmSettings()
	actionConfig, err := s.initActionConfig(settings, namespace)
	if err != nil {
		return "", err
	}

	client := action.NewGet(actionConfig)
	release, err := client.Run(name)
	if err != nil {
		return "", fmt.Errorf("failed to get release %s: %w", name, err)
	}

	return release.Manifest, nil
}

// ReleaseValues returns chart defaults, merged values, and user overrides for a Helm release.
func (s *Service) ReleaseValues(namespace, name string) (map[string]interface{}, error) {
	if err := s.ensureClient(); err != nil {
		return nil, err
	}

	settings := s.helmSettings()
	actionConfig, err := s.initActionConfig(settings, namespace)
	if err != nil {
		return nil, err
	}

	getClient := action.NewGet(actionConfig)
	release, err := getClient.Run(name)
	if err != nil {
		return nil, fmt.Errorf("failed to get release %s: %w", name, err)
	}

	defaults := release.Chart.Values

	valuesClient := action.NewGetValues(actionConfig)
	valuesClient.AllValues = true
	mergedValues, err := valuesClient.Run(name)
	if err != nil {
		return nil, fmt.Errorf("failed to get values for release %s: %w", name, err)
	}

	userClient := action.NewGetValues(actionConfig)
	userClient.AllValues = false
	userValues, err := userClient.Run(name)
	if err != nil {
		userValues = map[string]interface{}{}
	}

	return map[string]interface{}{
		"defaultValues": defaults,
		"allValues":     mergedValues,
		"userValues":    userValues,
	}, nil
}

// DeleteRelease removes a Helm release.
func (s *Service) DeleteRelease(namespace, name string) error {
	if err := s.ensureClient(); err != nil {
		return err
	}

	settings := s.helmSettings()
	actionConfig, err := s.initActionConfig(settings, namespace)
	if err != nil {
		return err
	}

	client := action.NewUninstall(actionConfig)
	if _, err := client.Run(name); err != nil {
		s.logError(fmt.Sprintf("Failed to delete Helm release %s/%s: %v", namespace, name, err))
		return fmt.Errorf("failed to delete Helm release: %w", err)
	}

	s.logInfo(fmt.Sprintf("Deleted Helm release %s/%s", namespace, name))
	return nil
}

func (s *Service) ensureClient() error {
	if s.deps.Common.EnsureClient != nil {
		if err := s.deps.Common.EnsureClient("HelmRelease"); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) helmSettings() *cli.EnvSettings {
	settings := cli.New()
	if cfg := s.deps.Common.SelectedKubeconfig; cfg != "" {
		settings.KubeConfig = cfg
	}
	if ctx := s.deps.Common.SelectedContext; ctx != "" {
		settings.KubeContext = ctx
	}
	return settings
}

func (s *Service) initActionConfig(settings *cli.EnvSettings, namespace string) (*action.Configuration, error) {
	if s.deps.ActionConfigFactory != nil {
		return s.deps.ActionConfigFactory(settings, namespace)
	}
	actionConfig := new(action.Configuration)
	if err := actionConfig.Init(settings.RESTClientGetter(), namespace, "secret", s.logDebugf); err != nil {
		return nil, fmt.Errorf("failed to initialize Helm configuration: %w", err)
	}
	return actionConfig, nil
}

func (s *Service) extractResourcesFromManifest(manifest, defaultNamespace string) []types.HelmResource {
	var resources []types.HelmResource
	resourceMap := make(map[string]bool)

	trimmed := strings.TrimPrefix(strings.TrimSpace(manifest), "---")
	docs := strings.Split(trimmed, "\n---")

	for _, doc := range docs {
		doc = strings.TrimSpace(doc)
		if doc == "" || doc == "---" {
			continue
		}

		var obj map[string]interface{}
		if err := yaml.Unmarshal([]byte(doc), &obj); err != nil || obj == nil {
			continue
		}

		kind, ok := obj["kind"].(string)
		if !ok || kind == "" {
			continue
		}

		if strings.HasSuffix(kind, "List") {
			items, ok := obj["items"].([]interface{})
			if !ok {
				continue
			}
			for _, item := range items {
				itemMap, ok := toStringMap(item)
				if !ok {
					continue
				}
				itemKind, ok := itemMap["kind"].(string)
				if !ok || itemKind == "" {
					continue
				}
				name, namespace := extractNameNamespace(itemMap, defaultNamespace)
				if name == "" {
					continue
				}
				key := fmt.Sprintf("%s/%s/%s", itemKind, namespace, name)
				if resourceMap[key] {
					continue
				}
				resourceMap[key] = true
				resources = append(resources, types.HelmResource{Kind: itemKind, Name: name, Namespace: namespace})
			}
			continue
		}

		name, namespace := extractNameNamespace(obj, defaultNamespace)
		if name == "" {
			continue
		}

		key := fmt.Sprintf("%s/%s/%s", kind, namespace, name)
		if resourceMap[key] {
			continue
		}
		resourceMap[key] = true
		resources = append(resources, types.HelmResource{Kind: kind, Name: name, Namespace: namespace})
	}

	return resources
}

func extractNameNamespace(obj map[string]interface{}, defaultNamespace string) (string, string) {
	metadataRaw, ok := obj["metadata"]
	if !ok {
		return "", defaultNamespace
	}

	metadata := make(map[string]interface{})
	switch m := metadataRaw.(type) {
	case map[string]interface{}:
		metadata = m
	case map[interface{}]interface{}:
		for k, v := range m {
			if keyStr, ok := k.(string); ok {
				metadata[keyStr] = v
			}
		}
	default:
		return "", defaultNamespace
	}

	name, _ := metadata["name"].(string)
	namespace := defaultNamespace
	if ns, ok := metadata["namespace"].(string); ok && ns != "" {
		namespace = ns
	}
	return name, namespace
}

func toStringMap(value interface{}) (map[string]interface{}, bool) {
	switch typed := value.(type) {
	case map[string]interface{}:
		return typed, true
	case map[interface{}]interface{}:
		result := make(map[string]interface{}, len(typed))
		for k, v := range typed {
			key, ok := k.(string)
			if !ok {
				continue
			}
			result[key] = v
		}
		return result, true
	default:
		return nil, false
	}
}

func (s *Service) logDebug(msg string) {
	if s.deps.Common.Logger != nil {
		s.deps.Common.Logger.Debug(msg, "Helm")
	}
}

func (s *Service) logDebugf(format string, args ...interface{}) {
	if s.deps.Common.Logger != nil {
		s.deps.Common.Logger.Debug(fmt.Sprintf(format, args...), "Helm")
	}
}

func (s *Service) logWarn(msg string) {
	if s.deps.Common.Logger != nil {
		s.deps.Common.Logger.Warn(msg, "Helm")
	}
}

func (s *Service) logError(msg string) {
	if s.deps.Common.Logger != nil {
		s.deps.Common.Logger.Error(msg, "Helm")
	}
}

func (s *Service) logInfo(msg string) {
	if s.deps.Common.Logger != nil {
		s.deps.Common.Logger.Info(msg, "Helm")
	}
}
