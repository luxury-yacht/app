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

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/types"
	"gopkg.in/yaml.v2"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/cli"
)

// ReleaseDetails returns detailed information about a Helm release.
func (s *Service) ReleaseDetails(namespace, name string) (*HelmReleaseDetails, error) {
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
	opts := resourcemodel.ResourceModelBuildOptions{
		Materialization: resourcemodel.MaterializeSummaryFacts | resourcemodel.MaterializeRelationshipFacts | resourcemodel.MaterializeDetailFacts,
	}
	model := BuildResourceModel(s.deps.Common.ClusterID, release, namespace, resourceLinks, history, opts)
	facts := BuildFacts(release, resourceLinks, history, opts)

	details := &HelmReleaseDetails{
		Kind:             "helmrelease",
		Name:             model.Ref.Name,
		Namespace:        model.Ref.Namespace,
		Chart:            facts.Chart,
		Version:          facts.Version,
		AppVersion:       facts.AppVersion,
		StatusProjection: types.NewStatusProjection(model.Status),
		Revision:         facts.Revision,
		Updated:          helmUpdatedAge(facts),
		Description:      facts.Description,
		Notes:            facts.Notes,
		Values:           release.Config,
		Labels:           model.Metadata.Labels,
		Annotations:      model.Metadata.Annotations,
	}

	for _, h := range facts.History {
		status := statusPresentation(Facts{
			RawStatus:   h.Status,
			Description: h.Description,
		})
		details.History = append(details.History, HelmRevision{
			Revision:         h.Revision,
			Updated:          helmRevisionUpdatedAge(h),
			StatusProjection: types.NewStatusProjection(status),
			Chart:            h.Chart,
			AppVersion:       h.AppVersion,
			Description:      h.Description,
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
		err = s.logDeleteError(err, fmt.Sprintf("Failed to delete Helm release %s/%s", namespace, name), name)
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

func (s *Service) extractResourcesFromManifest(manifest, defaultNamespace string) []HelmResource {
	resources := newManifestResourceAccumulator(s, defaultNamespace)
	for _, document := range splitManifestDocuments(manifest) {
		if object, ok := parseManifestDocument(document); ok {
			resources.addObject(object)
		}
	}
	return resources.items
}

type manifestResourceKey struct {
	apiVersion string
	kind       string
	namespace  string
	name       string
}

type manifestResourceAccumulator struct {
	service          *Service
	defaultNamespace string
	seen             map[manifestResourceKey]struct{}
	items            []HelmResource
}

func newManifestResourceAccumulator(service *Service, defaultNamespace string) *manifestResourceAccumulator {
	return &manifestResourceAccumulator{
		service:          service,
		defaultNamespace: defaultNamespace,
		seen:             make(map[manifestResourceKey]struct{}),
	}
}

func splitManifestDocuments(manifest string) []string {
	trimmed := strings.TrimPrefix(strings.TrimSpace(manifest), "---")
	return strings.Split(trimmed, "\n---")
}

func parseManifestDocument(document string) (map[string]interface{}, bool) {
	document = strings.TrimSpace(document)
	if document == "" || document == "---" {
		return nil, false
	}
	var object map[string]interface{}
	if err := yaml.Unmarshal([]byte(document), &object); err != nil {
		return nil, false
	}
	return object, object != nil
}

func (resources *manifestResourceAccumulator) addObject(object map[string]interface{}) {
	kind, _ := object["kind"].(string)
	if kind == "" {
		return
	}
	// apiVersion is the wire-form "group/version" (or just "version" for core
	// resources), allowing Helm-managed CRDs to retain their complete GVK.
	apiVersion, _ := object["apiVersion"].(string)
	if strings.HasSuffix(kind, "List") {
		resources.addListItems(object, apiVersion)
		return
	}
	resources.addResource(object, apiVersion, kind)
}

func (resources *manifestResourceAccumulator) addListItems(object map[string]interface{}, inheritedAPIVersion string) {
	items, ok := object["items"].([]interface{})
	if !ok {
		return
	}
	for _, item := range items {
		resources.addListItem(item, inheritedAPIVersion)
	}
}

func (resources *manifestResourceAccumulator) addListItem(item interface{}, inheritedAPIVersion string) {
	object, ok := toStringMap(item)
	if !ok {
		return
	}
	kind, _ := object["kind"].(string)
	if kind == "" {
		return
	}
	apiVersion, _ := object["apiVersion"].(string)
	if apiVersion == "" {
		apiVersion = inheritedAPIVersion
	}
	resources.addResource(object, apiVersion, kind)
}

func (resources *manifestResourceAccumulator) addResource(object map[string]interface{}, apiVersion, kind string) {
	name, namespace, namespaceExplicit := extractNameNamespace(object, resources.defaultNamespace)
	if name == "" {
		return
	}
	key := manifestResourceKey{apiVersion: apiVersion, kind: kind, namespace: namespace, name: name}
	if _, exists := resources.seen[key]; exists {
		return
	}
	resources.seen[key] = struct{}{}
	identity := resourcemodel.ResolveHelmManifestResourceIdentityWithResolver(
		resources.service.deps.Common.Context,
		resources.service.deps.Common.ResourceResolver,
		apiVersion,
		kind,
		namespace,
		name,
		namespaceExplicit,
	)
	resources.items = append(resources.items, HelmResource{
		Kind:       kind,
		APIVersion: apiVersion,
		Name:       name,
		Namespace:  identity.Namespace,
		Scope:      string(identity.Scope),
	})
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

func helmUpdatedAge(facts Facts) string {
	if facts.Updated == nil || facts.Updated.IsZero() {
		return ""
	}
	return common.FormatAge(facts.Updated.Time)
}

func helmRevisionUpdatedAge(facts HelmRevisionFacts) string {
	if facts.Updated == nil || facts.Updated.IsZero() {
		return ""
	}
	return common.FormatAge(facts.Updated.Time)
}

func (s *Service) logDebug(msg string) {
	applog.Debug(s.deps.Common.Logger, msg, logsources.Helm)
}

func (s *Service) logDebugf(format string, args ...interface{}) {
	applog.Debug(s.deps.Common.Logger, fmt.Sprintf(format, args...), logsources.Helm)
}

func (s *Service) logWarn(msg string) {
	applog.Warn(s.deps.Common.Logger, msg, logsources.Helm)
}

func (s *Service) logDeleteError(err error, msg string, privateResourceNames ...string) error {
	operation := common.DynamicResourceRequestOperation(
		"delete",
		"helm.sh",
		"v3",
		"releases",
		"",
		true,
	).WithPrivateResourceNames(privateResourceNames...)
	return s.deps.Common.LogRequestFailure(
		err,
		msg,
		operation,
		logsources.Helm,
	)
}

func (s *Service) logInfo(msg string) {
	applog.Info(s.deps.Common.Logger, msg, logsources.Helm)
}
