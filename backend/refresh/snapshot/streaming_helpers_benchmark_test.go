package snapshot

import (
	"testing"

	"github.com/luxury-yacht/app/backend/resources/configmap"
	rolepkg "github.com/luxury-yacht/app/backend/resources/role"
	"github.com/luxury-yacht/app/backend/resources/rolebinding"
	secretpkg "github.com/luxury-yacht/app/backend/resources/secret"
	"github.com/luxury-yacht/app/backend/resources/serviceaccount"
	"github.com/luxury-yacht/app/backend/testsupport"
)

func BenchmarkSharedModelStreamSummaries(b *testing.B) {
	fixture := testsupport.LargeResourceRelationshipFixture()
	meta := ClusterMeta{ClusterID: fixture.ClusterID, ClusterName: "Cluster A"}

	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		nameLength := len(configmap.BuildStreamSummary(meta, fixture.ConfigMap).Ref.Name) +
			len(secretpkg.BuildStreamSummary(meta, fixture.Secret).Ref.Name) +
			len(rolepkg.BuildStreamSummary(meta, fixture.Role).Ref.Name) +
			len(rolebinding.BuildStreamSummary(meta, fixture.RoleBinding).Ref.Name) +
			len(serviceaccount.BuildStreamSummary(meta, fixture.ServiceAccount).Ref.Name)
		if nameLength == 0 {
			b.Fatal("benchmark fixture did not produce expected summaries")
		}
	}
}
