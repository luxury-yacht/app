/*
 * backend/resources/secret/streamsummary.go
 *
 * Secret's stream-summary builder, owned by the kind's package. Produces the
 * neutral streamrows.ConfigSummary row (the namespace-config domain is shared by
 * ConfigMap and Secret). Returns a leaf type, so no snapshot import (no cycle).
 */

package secret

import (
	"github.com/luxury-yacht/app/backend/refresh/streamrows"
	corev1 "k8s.io/api/core/v1"
)

// BuildStreamSummary builds the namespace-config row for one Secret.
func BuildStreamSummary(meta streamrows.ClusterMeta, sec *corev1.Secret) streamrows.ConfigSummary {
	if sec == nil {
		return streamrows.ConfigSummary{ClusterMeta: meta, Kind: "Secret"}
	}
	facts := BuildFacts(sec, nil)
	return streamrows.ConfigSummary{
		ClusterMeta:  meta,
		Kind:         "Secret",
		TypeAlias:    streamSummaryTypeAlias(sec),
		Name:         sec.GetName(),
		Namespace:    sec.GetNamespace(),
		Data:         facts.DataCount,
		Age:          streamrows.FormatAge(sec.GetCreationTimestamp().Time),
		AgeTimestamp: streamrows.CreationMillis(sec),
	}
}

// streamSummaryTypeAlias renders the short Secret type label shown in the config
// table (TLS/SA/Docker/Auth/Opaque, else the raw type).
func streamSummaryTypeAlias(sec *corev1.Secret) string {
	switch sec.Type {
	case corev1.SecretTypeTLS:
		return "TLS"
	case corev1.SecretTypeServiceAccountToken:
		return "SA"
	case corev1.SecretTypeDockercfg, corev1.SecretTypeDockerConfigJson:
		return "Docker"
	case corev1.SecretTypeBasicAuth:
		return "Auth"
	case corev1.SecretTypeOpaque:
		return "Opaque"
	default:
		return string(sec.Type)
	}
}
