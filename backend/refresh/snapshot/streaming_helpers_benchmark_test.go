package snapshot

import (
	"testing"

	"github.com/luxury-yacht/app/backend/testsupport"
)

func BenchmarkSharedModelStreamSummaries(b *testing.B) {
	fixture := testsupport.LargeResourceRelationshipFixture()
	meta := ClusterMeta{ClusterID: fixture.ClusterID, ClusterName: "Cluster A"}

	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		nameLength := len(BuildConfigMapSummary(meta, fixture.ConfigMap).Name) +
			len(BuildSecretSummary(meta, fixture.Secret).Name) +
			len(BuildRoleSummary(meta, fixture.Role).Name) +
			len(BuildRoleBindingSummary(meta, fixture.RoleBinding).Name) +
			len(BuildServiceAccountSummary(meta, fixture.ServiceAccount).Name)
		if nameLength == 0 {
			b.Fatal("benchmark fixture did not produce expected summaries")
		}
	}
}
