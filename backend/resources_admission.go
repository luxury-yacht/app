/*
 * backend/resources_admission.go
 *
 * App-level admission resource wrappers.
 * - Exposes mutating and validating webhook handlers.
 */

package backend

import "github.com/luxury-yacht/app/backend/resources/admission"

func (a *App) GetMutatingWebhookConfiguration(clusterID, name string) (*MutatingWebhookConfigurationDetails, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return FetchClusterResource(a, deps, selectionKey, "MutatingWebhookConfiguration", name, func() (*MutatingWebhookConfigurationDetails, error) {
		return admission.NewService(deps).MutatingWebhookConfiguration(name)
	})
}

func (a *App) GetValidatingWebhookConfiguration(clusterID, name string) (*ValidatingWebhookConfigurationDetails, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	return FetchClusterResource(a, deps, selectionKey, "ValidatingWebhookConfiguration", name, func() (*ValidatingWebhookConfigurationDetails, error) {
		return admission.NewService(deps).ValidatingWebhookConfiguration(name)
	})
}
