package secret

import (
	"testing"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestSecretAggregateProjectsHelmStorageMetadata(t *testing.T) {
	secret := &corev1.Secret{
		ObjectMeta: metav1.ObjectMeta{
			Namespace: "payments",
			Name:      "sh.helm.release.v1.payments.v3",
			Labels: map[string]string{
				"owner": "helm", "name": "payments", "version": "3", "status": "deployed",
			},
		},
		Type: "helm.sh/release.v1",
	}

	got, ok := StreamDescriptor.AggregateRow(secret).(resourcemodel.HelmReleaseStorageCandidate)
	if !ok || got.Namespace != "payments" || got.Name != "payments" || got.Revision != 3 || got.Status != "deployed" {
		t.Fatalf("AggregateRow = %#v, want payments revision 3 deployed", got)
	}
}
