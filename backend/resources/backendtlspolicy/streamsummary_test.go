package backendtlspolicy

import (
	"testing"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

func TestSummaryKeepsFirstTargetIdentityAndOtherTargetsSearchable(t *testing.T) {
	policy := &gatewayv1.BackendTLSPolicy{ObjectMeta: metav1.ObjectMeta{Name: "tls", Namespace: "apps"}}
	for _, name := range []string{"api", "worker"} {
		policy.Spec.TargetRefs = append(policy.Spec.TargetRefs, gatewayv1.LocalPolicyTargetReferenceWithSectionName{
			LocalPolicyTargetReference: gatewayv1.LocalPolicyTargetReference{Kind: "Service", Name: gatewayv1.ObjectName(name)},
		})
	}
	row := BuildStreamSummary(streamrows.ClusterMeta{ClusterID: "cluster-a"}, policy)
	require.Len(t, row.Details, 2)
	link := row.Details[0].Link
	require.NotNil(t, link)
	require.Equal(t, "api", link.Ref.Name)
	require.Equal(t, "apps", link.Ref.Namespace)
	require.Equal(t, "cluster-a", link.Ref.ClusterID)
	require.Equal(t, "v1", link.Ref.Version)
	require.Contains(t, resourcemodel.DetailSegmentsSearchText(row.Details), "worker")

	policy.Spec.TargetRefs[0].Name = ""
	row = BuildStreamSummary(streamrows.ClusterMeta{ClusterID: "cluster-a"}, policy)
	require.Len(t, row.Details, 1, "a nameless first target does not promote a different target to the primary link")
	require.Equal(t, "2", row.Details[0].Value)
}
