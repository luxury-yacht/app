package backend

import "github.com/luxury-yacht/app/backend/resources/admission"

func (a *App) GetMutatingWebhookConfiguration(name string) (*MutatingWebhookConfigurationDetails, error) {
	deps := a.resourceDependencies()
	return FetchClusterResource(a, "MutatingWebhookConfiguration", name, func() (*MutatingWebhookConfigurationDetails, error) {
		return admission.NewService(deps).MutatingWebhookConfiguration(name)
	})
}

// Deprecated legacy signature retained for backwards compatibility with older clients.
func (a *App) GetValidatingWebhookConfiguration(name string) (*ValidatingWebhookConfigurationDetails, error) {
	deps := a.resourceDependencies()
	return FetchClusterResource(a, "ValidatingWebhookConfiguration", name, func() (*ValidatingWebhookConfigurationDetails, error) {
		return admission.NewService(deps).ValidatingWebhookConfiguration(name)
	})
}
