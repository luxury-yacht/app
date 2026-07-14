package configmap

import (
	"testing"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestConfigMapAggregateProjectsLegacyHelmStorageMetadata(t *testing.T) {
	configMap := &corev1.ConfigMap{ObjectMeta: metav1.ObjectMeta{
		Namespace: "payments",
		Name:      "sh.helm.release.v1.payments.v2",
		Labels: map[string]string{
			"owner": "helm", "name": "payments", "version": "2", "status": "deployed",
		},
	}}

	got, ok := StreamDescriptor.AggregateRow(configMap).(resourcemodel.HelmReleaseStorageCandidate)
	if !ok || got.Namespace != "payments" || got.Name != "payments" || got.Revision != 2 || got.Status != "deployed" {
		t.Fatalf("AggregateRow = %#v, want payments revision 2 deployed", got)
	}
}
