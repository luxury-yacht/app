/*
 * backend/resources/admission/streamsummary.go
 *
 * Webhook-configuration stream-summary builders, owned by the admission package.
 * Both produce the neutral streamrows.ClusterConfigEntry row (cluster-config). No
 * snapshot import.
 */

package admission

import (
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	admissionregistrationv1 "k8s.io/api/admissionregistration/v1"
)

// BuildValidatingStreamSummary builds the cluster-config row for one
// ValidatingWebhookConfiguration.
func BuildValidatingStreamSummary(meta streamrows.ClusterMeta, webhook *admissionregistrationv1.ValidatingWebhookConfiguration) streamrows.ClusterConfigEntry {
	if webhook == nil {
		return streamrows.ClusterConfigEntry{}
	}
	count := len(BuildValidatingFacts(meta.ClusterID, webhook).Webhooks)
	return streamrows.NewClusterConfigEntry(meta, ValidatingIdentity, webhook, WebhookCountDetails(count), false)
}

// BuildMutatingStreamSummary builds the cluster-config row for one
// MutatingWebhookConfiguration.
func BuildMutatingStreamSummary(meta streamrows.ClusterMeta, webhook *admissionregistrationv1.MutatingWebhookConfiguration) streamrows.ClusterConfigEntry {
	if webhook == nil {
		return streamrows.ClusterConfigEntry{}
	}
	count := len(BuildMutatingFacts(meta.ClusterID, webhook).Webhooks)
	return streamrows.NewClusterConfigEntry(meta, MutatingIdentity, webhook, WebhookCountDetails(count), false)
}
