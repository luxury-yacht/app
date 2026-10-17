/*
 * backend/resources/helm/helm_releases.go
 *
 * Helm release operations.
 * - Fetches release details, manifests, and values.
 */

package helm

import (
	"context"
	"errors"
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/errorstatus"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/types"
	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/chartutil"
	"helm.sh/helm/v3/pkg/cli"
	"helm.sh/helm/v3/pkg/release"
	"helm.sh/helm/v3/pkg/storage/driver"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// ReleaseDetails returns detailed information about a Helm release.
func (s *Service) ReleaseDetails(ctx context.Context, namespace, name string) (*HelmReleaseDetails, error) {
	actionConfig, release, err := s.getRelease(namespace, name)
	if err != nil {
		return nil, err
	}

	historyClient := action.NewHistory(actionConfig)
	history, err := historyClient.Run(name)
	if err != nil {
		s.logWarn(fmt.Sprintf("Failed to get Helm history for %s/%s: %v", namespace, name, err))
	}

	resources := s.extractResourcesFromManifest(ctx, release.Manifest, namespace)
	opts := resourcemodel.ResourceModelBuildOptions{
		Materialization: resourcemodel.MaterializeSummaryFacts | resourcemodel.MaterializeDetailFacts,
	}
	model := BuildResourceModel(s.deps.Common.ClusterID, release, namespace)
	facts := BuildFacts(release, history, opts)

	details := &HelmReleaseDetails{
		Kind:             "helmrelease",
		Name:             model.Ref.Name,
		Namespace:        model.Ref.Namespace,
		Chart:            facts.Chart,
		Version:          facts.Version,
		AppVersion:       facts.AppVersion,
		StatusProjection: types.NewStatusProjection(model.Status),
		Revision:         facts.Revision,
		Updated:          helmUpdatedAge(facts.Updated),
		Description:      facts.Description,
		Notes:            facts.Notes,
		Values:           release.Config,
		Labels:           model.Metadata.Labels,
		Annotations:      model.Metadata.Annotations,
	}

	for _, h := range facts.History {
		status := statusPresentation(h.Status, h.Description)
		details.History = append(details.History, HelmRevision{
			Revision:         h.Revision,
			Updated:          helmUpdatedAge(h.Updated),
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

// ReleaseManifest returns the rendered manifest and revision of a Helm release.
func (s *Service) ReleaseManifest(namespace, name string) (string, int, error) {
	_, release, err := s.getRelease(namespace, name)
	if err != nil {
		return "", 0, err
	}

	return release.Manifest, release.Version, nil
}

// HelmReleaseValues holds the Values tab's three views of one release revision.
type HelmReleaseValues struct {
	// Defaults are the chart's own values, including subchart defaults.
	Defaults map[string]interface{}
	// Merged are the values Helm rendered with (`helm get values --all`).
	Merged map[string]interface{}
	// Overrides are the user-supplied values (`helm get values`).
	Overrides map[string]interface{}
	// SubchartPaths locate each subchart's values, nested subcharts included.
	// Helm copies the parent's `global` values into every one of them.
	SubchartPaths [][]string
}

// ReleaseValues returns a release's chart defaults, merged values, and user
// overrides, all computed from the single stored revision it reads.
func (s *Service) ReleaseValues(namespace, name string) (HelmReleaseValues, int, error) {
	_, release, err := s.getRelease(namespace, name)
	if err != nil {
		return HelmReleaseValues{}, 0, err
	}

	defaults, err := chartutil.CoalesceValues(release.Chart, map[string]interface{}{})
	if err != nil {
		return HelmReleaseValues{}, 0, fmt.Errorf("failed to compute chart defaults for release %s: %w", name, err)
	}
	merged, err := chartutil.CoalesceValues(release.Chart, release.Config)
	if err != nil {
		return HelmReleaseValues{}, 0, fmt.Errorf("failed to get values for release %s: %w", name, err)
	}

	return HelmReleaseValues{
		Defaults:      defaults,
		Merged:        merged,
		Overrides:     release.Config,
		SubchartPaths: subchartPaths(release.Chart, nil),
	}, release.Version, nil
}

// subchartPaths lists dependency value paths in the order Helm coalesces them:
// a subchart's values live under its name inside its parent's values.
func subchartPaths(ch *chart.Chart, parent []string) [][]string {
	var paths [][]string
	for _, dependency := range ch.Dependencies() {
		path := append(append([]string{}, parent...), dependency.Name())
		paths = append(paths, path)
		paths = append(paths, subchartPaths(dependency, path)...)
	}
	return paths
}

// getRelease keeps the client, configuration, and release-read policy shared by
// the object panel's detail, manifest, and values reads.
func (s *Service) getRelease(namespace, name string) (*action.Configuration, *release.Release, error) {
	if err := s.ensureClient(); err != nil {
		return nil, nil, err
	}
	actionConfig, err := s.initActionConfig(s.helmSettings(), namespace)
	if err != nil {
		return nil, nil, err
	}
	value, err := action.NewGet(actionConfig).Run(name)
	if err != nil {
		err = fmt.Errorf("failed to get release %s: %w", name, err)
		if IsReleaseNotFound(err) {
			err = errorstatus.NotFound(err)
		}
		return nil, nil, err
	}
	return actionConfig, value, nil
}

// IsReleaseNotFound reports that Helm storage has no record of the release:
// it was uninstalled. Failures reaching the cluster, even API 404s, are not.
func IsReleaseNotFound(err error) bool {
	return errors.Is(err, driver.ErrReleaseNotFound)
}

// DeleteRelease removes a Helm release.
func (s *Service) DeleteRelease(namespace, name string) error {
	failure := fmt.Sprintf("Failed to delete Helm release %s/%s", namespace, name)
	if err := s.ensureClient(); err != nil {
		return s.logDeleteError(err, failure, name)
	}

	settings := s.helmSettings()
	actionConfig, err := s.initActionConfig(settings, namespace)
	if err != nil {
		return s.logDeleteError(err, failure, name)
	}

	client := action.NewUninstall(actionConfig)
	if _, err := client.Run(name); err != nil {
		err = s.logDeleteError(err, failure, name)
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

func (s *Service) extractResourcesFromManifest(ctx context.Context, manifest, defaultNamespace string) []HelmResource {
	var resources []HelmResource
	for _, resource := range ParseManifestResources(manifest, defaultNamespace) {
		identity := resourcemodel.ResolveHelmManifestResourceIdentityWithResolver(
			ctx,
			s.deps.Common.ResourceResolver,
			resource.APIVersion,
			resource.Kind,
			resource.Namespace,
			resource.Name,
			resource.NamespaceExplicit,
		)
		resources = append(resources, HelmResource{
			Kind:       resource.Kind,
			APIVersion: resource.APIVersion,
			Name:       resource.Name,
			Namespace:  identity.Namespace,
			Scope:      string(identity.Scope),
		})
	}
	return resources
}

func helmUpdatedAge(updated *metav1.Time) string {
	if updated == nil || updated.IsZero() {
		return ""
	}
	return common.FormatAge(updated.Time)
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
	operation := common.DynamicResourceRequestOperation(common.DynamicResourceRequestSpec{
		Action: "delete", Group: resourcemodel.HelmReleaseGVK.Group, Version: resourcemodel.HelmReleaseGVK.Version, Resource: releaseResource, Namespaced: true,
	}).WithPrivateResourceNames(privateResourceNames...)
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
