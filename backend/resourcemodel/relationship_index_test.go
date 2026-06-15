package resourcemodel

import (
	"fmt"
	"testing"

	"github.com/luxury-yacht/app/backend/testsupport"
	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
)

func TestResourceRelationshipIndexMaterializesReverseLinksOnce(t *testing.T) {
	pods := &corev1.PodList{Items: []corev1.Pod{
		{
			ObjectMeta: metav1.ObjectMeta{Name: "api-0", Namespace: "team-a", UID: types.UID("pod-a")},
			Spec: corev1.PodSpec{
				ServiceAccountName: "builder",
				Volumes: []corev1.Volume{
					{
						Name: "config",
						VolumeSource: corev1.VolumeSource{ConfigMap: &corev1.ConfigMapVolumeSource{
							LocalObjectReference: corev1.LocalObjectReference{Name: "app-config"},
						}},
					},
					{
						Name: "claim",
						VolumeSource: corev1.VolumeSource{PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{
							ClaimName: "data",
						}},
					},
					{
						Name: "projected",
						VolumeSource: corev1.VolumeSource{Projected: &corev1.ProjectedVolumeSource{
							Sources: []corev1.VolumeProjection{
								{ConfigMap: &corev1.ConfigMapProjection{
									LocalObjectReference: corev1.LocalObjectReference{Name: "projected-config"},
								}},
								{Secret: &corev1.SecretProjection{
									LocalObjectReference: corev1.LocalObjectReference{Name: "projected-secret"},
								}},
							},
						}},
					},
				},
				ImagePullSecrets: []corev1.LocalObjectReference{{Name: "registry"}},
			},
		},
	}}
	roleBindings := &rbacv1.RoleBindingList{Items: []rbacv1.RoleBinding{{
		ObjectMeta: metav1.ObjectMeta{Name: "builder-edit", Namespace: "team-a", UID: types.UID("rb-a")},
		RoleRef:    rbacv1.RoleRef{APIGroup: rbacAPIGroup, Kind: "Role", Name: "editor"},
		Subjects:   []rbacv1.Subject{{Kind: "ServiceAccount", Name: "builder"}},
	}}}
	clusterRoleBindings := &rbacv1.ClusterRoleBindingList{Items: []rbacv1.ClusterRoleBinding{{
		ObjectMeta: metav1.ObjectMeta{Name: "builder-view", UID: types.UID("crb-a")},
		RoleRef:    rbacv1.RoleRef{APIGroup: rbacAPIGroup, Kind: "ClusterRole", Name: "view"},
		Subjects:   []rbacv1.Subject{{Kind: "ServiceAccount", Name: "builder", Namespace: "team-a"}},
	}}}

	idx := NewResourceRelationshipIndex("cluster-a", ResourceRelationshipIndexOptions{
		Pods:                pods,
		RoleBindings:        roleBindings,
		ClusterRoleBindings: clusterRoleBindings,
	})

	if got := ResourceLinkNames(idx.ConfigMapUsedBy("team-a", "app-config")); fmt.Sprint(got) != "[api-0]" {
		t.Fatalf("expected ConfigMap reverse link to api-0, got %v", got)
	}
	if got := ResourceLinkNames(idx.ConfigMapUsedBy("team-a", "projected-config")); fmt.Sprint(got) != "[api-0]" {
		t.Fatalf("expected projected ConfigMap reverse link to api-0, got %v", got)
	}
	if got := ResourceLinkNames(idx.SecretUsedBy("team-a", "registry")); fmt.Sprint(got) != "[api-0]" {
		t.Fatalf("expected Secret reverse link to api-0, got %v", got)
	}
	if got := ResourceLinkNames(idx.SecretUsedBy("team-a", "projected-secret")); fmt.Sprint(got) != "[api-0]" {
		t.Fatalf("expected projected Secret reverse link to api-0, got %v", got)
	}
	if got := ResourceLinkNames(idx.PersistentVolumeClaimMountedBy("team-a", "data")); fmt.Sprint(got) != "[api-0]" {
		t.Fatalf("expected PVC reverse link to api-0, got %v", got)
	}
	if got := ResourceLinkNames(idx.ServiceAccountUsedByPods("team-a", "builder")); fmt.Sprint(got) != "[api-0]" {
		t.Fatalf("expected ServiceAccount pod reverse link to api-0, got %v", got)
	}
	if got := ResourceLinkNames(idx.RoleUsedByBindings("team-a", "editor")); fmt.Sprint(got) != "[builder-edit]" {
		t.Fatalf("expected Role reverse link to builder-edit, got %v", got)
	}
	if got := ResourceLinkNames(idx.ClusterRoleUsedByClusterBindings("view")); fmt.Sprint(got) != "[builder-view]" {
		t.Fatalf("expected ClusterRoleBinding reverse link to builder-view, got %v", got)
	}
}

func BenchmarkResourceRelationshipIndexLargeSnapshot(b *testing.B) {
	fixture := testsupport.LargeResourceRelationshipFixture()

	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		idx := NewResourceRelationshipIndex(fixture.ClusterID, resourceRelationshipIndexOptions(fixture))
		if len(idx.ConfigMapUsedBy(fixture.Namespace, fixture.ConfigMap.Name)) == 0 {
			b.Fatal("benchmark fixture did not produce expected reverse links")
		}
	}
}

func BenchmarkResourceRelationshipDetailMaterialization(b *testing.B) {
	fixture := testsupport.LargeResourceRelationshipFixture()
	relationships := NewResourceRelationshipIndex(fixture.ClusterID, resourceRelationshipIndexOptions(fixture))
	options := ResourceModelBuildOptions{Materialization: MaterializeSummaryFacts | MaterializeReverseLinks}

	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		linkCount := benchmarkReverseLinkDetails(fixture, relationships, options)
		if linkCount == 0 {
			b.Fatal("benchmark fixture did not produce expected reverse links")
		}
	}
}

func BenchmarkResourceRelationshipIndexAndReverseLinkDetails(b *testing.B) {
	fixture := testsupport.LargeResourceRelationshipFixture()
	options := ResourceModelBuildOptions{Materialization: MaterializeSummaryFacts | MaterializeReverseLinks}

	b.ReportAllocs()
	for i := 0; i < b.N; i++ {
		relationships := NewResourceRelationshipIndex(fixture.ClusterID, resourceRelationshipIndexOptions(fixture))
		linkCount := benchmarkReverseLinkDetails(fixture, relationships, options)
		if linkCount == 0 {
			b.Fatal("benchmark fixture did not produce expected reverse links")
		}
	}
}

func benchmarkReverseLinkDetails(
	fixture testsupport.ResourceRelationshipFixture,
	relationships *ResourceRelationshipIndex,
	options ResourceModelBuildOptions,
) int {
	// ConfigMap/Secret models moved to resources/{configmap,secret}; their reverse
	// links are produced by these ResourceRelationshipIndex methods (which stay here).
	configMapUsedBy := relationships.ConfigMapUsedBy(fixture.ConfigMap.Namespace, fixture.ConfigMap.Name)
	secretUsedBy := relationships.SecretUsedBy(fixture.Secret.Namespace, fixture.Secret.Name)
	pvcMountedBy := relationships.PersistentVolumeClaimMountedBy(fixture.PersistentVolumeClaim.Namespace, fixture.PersistentVolumeClaim.Name)
	role := BuildRoleResourceModel(fixture.ClusterID, fixture.Role, relationships, options)
	clusterRole := BuildClusterRoleResourceModel(fixture.ClusterID, fixture.ClusterRole, relationships, options)
	serviceAccount := BuildServiceAccountResourceModel(fixture.ClusterID, fixture.ServiceAccount, relationships, options)

	return len(configMapUsedBy) +
		len(secretUsedBy) +
		len(pvcMountedBy) +
		len(role.Facts.Role.UsedByRoleBindings) +
		len(clusterRole.Facts.ClusterRole.ClusterRoleBindings) +
		len(clusterRole.Facts.ClusterRole.RoleBindings) +
		len(serviceAccount.Facts.ServiceAccount.UsedByPods) +
		len(serviceAccount.Facts.ServiceAccount.RoleBindings) +
		len(serviceAccount.Facts.ServiceAccount.ClusterRoleBindings)
}

func resourceRelationshipIndexOptions(fixture testsupport.ResourceRelationshipFixture) ResourceRelationshipIndexOptions {
	return ResourceRelationshipIndexOptions{
		Pods:                fixture.Pods,
		RoleBindings:        fixture.RoleBindings,
		ClusterRoleBindings: fixture.ClusterRoleBindings,
	}
}
