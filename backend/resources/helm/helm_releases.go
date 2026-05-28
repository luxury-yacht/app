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

	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/types"
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

	resources := s.extractResourcesFromManifest(release.Manifest, namespace)
	resourceLinks := s.extractResourceLinksFromManifest(release.Manifest, namespace)
	model := resourcemodel.BuildHelmReleaseResourceModel(
		s.deps.Common.ClusterID,
		release,
		namespace,
		resourceLinks,
		history,
		resourcemodel.ResourceModelBuildOptions{
			Materialization: resourcemodel.MaterializeSummaryFacts | resourcemodel.MaterializeRelationshipFacts | resourcemodel.MaterializeDetailFacts,
		},
	)
	facts := model.Facts.HelmRelease

	details := &types.HelmReleaseDetails{
		Kind:               "helmrelease",
		Name:               model.Ref.Name,
		Namespace:          model.Ref.Namespace,
		Age:                helmAge(model),
		Chart:              facts.Chart,
		Version:            facts.Version,
		AppVersion:         facts.AppVersion,
		Status:             model.Status.Label,
		StatusState:        model.Status.State,
		StatusPresentation: model.Status.Presentation,
		StatusReason:       model.Status.Reason,
		Revision:           facts.Revision,
		Updated:            helmUpdatedAge(facts),
		Description:        facts.Description,
		Notes:              facts.Notes,
		Values:             release.Config,
		Labels:             model.Metadata.Labels,
		Annotations:        model.Metadata.Annotations,
	}

	for _, h := range facts.History {
		status := resourcemodel.BuildHelmReleaseStatusPresentation(resourcemodel.HelmReleaseFacts{
			RawStatus:   h.Status,
			Description: h.Description,
		})
		details.History = append(details.History, types.HelmRevision{
			Revision:           h.Revision,
			Updated:            helmRevisionUpdatedAge(h),
			Status:             status.Label,
			StatusState:        status.State,
			StatusPresentation: status.Presentation,
			StatusReason:       status.Reason,
			Chart:              h.Chart,
			AppVersion:         h.AppVersion,
			Description:        h.Description,
		})
	}

	s.logDebug(fmt.Sprintf("Release %s/%s manifest size: %d", namespace, name, len(release.Manifest)))
	details.Resources = resources
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
		// apiVersion is the wire-form "group/version" (or just "version"
		// for core resources). Captured here so the frontend can open
		// Helm-managed CRDs in the object panel with a fully-qualified
		// GVK. Optional in YAML in theory, but every real Kubernetes
		// manifest carries it.
		apiVersion, _ := obj["apiVersion"].(string)

		if strings.HasSuffix(kind, "List") {
			items, ok := obj["items"].([]interface{})
			if !ok {
				continue
			}
			// Items in a List inherit the List's apiVersion only if they
			// don't carry their own. Real lists from kubectl always set
			// items[*].apiVersion, but check both for safety.
			for _, item := range items {
				itemMap, ok := toStringMap(item)
				if !ok {
					continue
				}
				itemKind, ok := itemMap["kind"].(string)
				if !ok || itemKind == "" {
					continue
				}
				itemAPIVersion, _ := itemMap["apiVersion"].(string)
				if itemAPIVersion == "" {
					itemAPIVersion = apiVersion
				}
				name, namespace, namespaceExplicit := extractNameNamespace(itemMap, defaultNamespace)
				if name == "" {
					continue
				}
				identity := resourcemodel.ResolveHelmManifestResourceIdentityWithResolver(
					s.deps.Common.Context,
					s.deps.Common.ResourceResolver,
					itemAPIVersion,
					itemKind,
					namespace,
					name,
					namespaceExplicit,
				)
				key := fmt.Sprintf("%s/%s/%s/%s", itemAPIVersion, itemKind, namespace, name)
				if resourceMap[key] {
					continue
				}
				resourceMap[key] = true
				resources = append(resources, types.HelmResource{
					Kind:       itemKind,
					APIVersion: itemAPIVersion,
					Name:       name,
					Namespace:  identity.Namespace,
					Scope:      string(identity.Scope),
				})
			}
			continue
		}

		name, namespace, namespaceExplicit := extractNameNamespace(obj, defaultNamespace)
		if name == "" {
			continue
		}
		identity := resourcemodel.ResolveHelmManifestResourceIdentityWithResolver(
			s.deps.Common.Context,
			s.deps.Common.ResourceResolver,
			apiVersion,
			kind,
			namespace,
			name,
			namespaceExplicit,
		)

		key := fmt.Sprintf("%s/%s/%s/%s", apiVersion, kind, namespace, name)
		if resourceMap[key] {
			continue
		}
		resourceMap[key] = true
		resources = append(resources, types.HelmResource{
			Kind:       kind,
			APIVersion: apiVersion,
			Name:       name,
			Namespace:  identity.Namespace,
			Scope:      string(identity.Scope),
		})
	}

	return resources
}

func extractNameNamespace(obj map[string]interface{}, defaultNamespace string) (string, string, bool) {
	metadataRaw, ok := obj["metadata"]
	if !ok {
		return "", defaultNamespace, false
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
		return "", defaultNamespace, false
	}

	name, _ := metadata["name"].(string)
	namespace := defaultNamespace
	namespaceExplicit := false
	if ns, ok := metadata["namespace"].(string); ok && ns != "" {
		namespace = ns
		namespaceExplicit = true
	}
	return name, namespace, namespaceExplicit
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

func (s *Service) extractResourceLinksFromManifest(manifest, defaultNamespace string) []resourcemodel.ResourceLink {
	resources := s.extractResourcesFromManifest(manifest, defaultNamespace)
	if len(resources) == 0 {
		return nil
	}
	links := make([]resourcemodel.ResourceLink, 0, len(resources))
	for _, resource := range resources {
		link := resourcemodel.BuildHelmManifestResourceLinkWithNamespaceSourceAndResolver(
			s.deps.Common.Context,
			s.deps.Common.ResourceResolver,
			s.deps.Common.ClusterID,
			resource.APIVersion,
			resource.Kind,
			resource.Namespace,
			resource.Name,
			resource.Scope == string(resourcemodel.ResourceScopeNamespaced),
		)
		if link.Ref != nil || link.Display != nil {
			links = append(links, link)
		}
	}
	return links
}

func helmAge(model resourcemodel.ResourceModel) string {
	if model.Metadata.CreationTimestamp.IsZero() {
		return ""
	}
	return common.FormatAge(model.Metadata.CreationTimestamp.Time)
}

func helmUpdatedAge(facts *resourcemodel.HelmReleaseFacts) string {
	if facts == nil || facts.Updated == nil || facts.Updated.IsZero() {
		return ""
	}
	return common.FormatAge(facts.Updated.Time)
}

func helmRevisionUpdatedAge(facts resourcemodel.HelmRevisionFacts) string {
	if facts.Updated == nil || facts.Updated.IsZero() {
		return ""
	}
	return common.FormatAge(facts.Updated.Time)
}

func (s *Service) logDebug(msg string) {
	if s.deps.Common.Logger != nil {
		s.deps.Common.Logger.Debug(msg, logsources.Helm)
	}
}

func (s *Service) logDebugf(format string, args ...interface{}) {
	if s.deps.Common.Logger != nil {
		s.deps.Common.Logger.Debug(fmt.Sprintf(format, args...), logsources.Helm)
	}
}

func (s *Service) logWarn(msg string) {
	if s.deps.Common.Logger != nil {
		s.deps.Common.Logger.Warn(msg, logsources.Helm)
	}
}

func (s *Service) logError(msg string) {
	if s.deps.Common.Logger != nil {
		s.deps.Common.Logger.Error(msg, logsources.Helm)
	}
}

func (s *Service) logInfo(msg string) {
	if s.deps.Common.Logger != nil {
		s.deps.Common.Logger.Info(msg, logsources.Helm)
	}
}
