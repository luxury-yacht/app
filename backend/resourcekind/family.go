package resourcekind

import "strings"

const (
	KarpenterFamily       = "karpenter"
	ArgoCDFamily          = "argocd"
	CertManagerFamily     = "cert-manager"
	ExternalSecretsFamily = "external-secrets"
	PrometheusFamily      = "prometheus"
)

type familyDefinition struct {
	family string
	kinds  map[string]bool // true for namespaced resources
}

var discoveredFamilies = map[string]familyDefinition{
	"argoproj.io":           {ArgoCDFamily, map[string]bool{"application": true, "applicationset": true, "appproject": true}},
	"cert-manager.io":       {CertManagerFamily, map[string]bool{"certificate": true, "certificaterequest": true, "issuer": true, "clusterissuer": false}},
	"acme.cert-manager.io":  {CertManagerFamily, map[string]bool{"order": true, "challenge": true}},
	"external-secrets.io":   {ExternalSecretsFamily, map[string]bool{"externalsecret": true, "secretstore": true, "clustersecretstore": false, "clusterexternalsecret": false}},
	"monitoring.coreos.com": {PrometheusFamily, map[string]bool{"servicemonitor": true, "podmonitor": true, "prometheusrule": true, "prometheus": true, "alertmanager": true}},
}

// FamilyForResource classifies discovered APIs without pinning served versions.
// Argo products share a group, so Argo CD also requires an explicit kind match.
func FamilyForResource(group, kind string, namespaced bool) string {
	if !namespaced && strings.HasPrefix(group, "karpenter.") {
		return KarpenterFamily
	}
	definition := discoveredFamilies[group]
	if scope, found := definition.kinds[strings.ToLower(kind)]; found && scope == namespaced {
		return definition.family
	}
	return ""
}

func IsResourceFamily(family string) bool {
	switch family {
	case KarpenterFamily, ArgoCDFamily, CertManagerFamily, ExternalSecretsFamily, PrometheusFamily:
		return true
	default:
		return false
	}
}
