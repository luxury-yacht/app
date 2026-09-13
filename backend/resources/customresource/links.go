package customresource

import "github.com/luxury-yacht/app/backend/resourcemodel"

// ResolveLinks enriches only versionless references through the caller's
// cluster catalog. Projection packages never import the catalog or do API IO.
func (details *Details) ResolveLinks(resolve func(*resourcemodel.ResourceLink) *resourcemodel.ResourceLink) {
	if details.Karpenter != nil {
		details.Karpenter.NodeClass = resolve(details.Karpenter.NodeClass)
	}
	if details.CertManager != nil {
		details.CertManager.Issuer = resolve(details.CertManager.Issuer)
	}
	if details.ExternalSecrets != nil {
		if secret := details.ExternalSecrets.ExternalSecret; secret != nil {
			secret.Store = resolve(secret.Store)
		}
		if clusterSecret := details.ExternalSecrets.ClusterExternalSecret; clusterSecret != nil && clusterSecret.Template != nil {
			clusterSecret.Template.Store = resolve(clusterSecret.Template.Store)
		}
	}
}
