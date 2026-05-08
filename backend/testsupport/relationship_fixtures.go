package testsupport

import (
	"fmt"

	corev1 "k8s.io/api/core/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/utils/ptr"
)

const (
	ResourceRelationshipFixtureClusterID = "cluster-a"
	ResourceRelationshipFixtureNamespace = "team-00"
)

// ResourceRelationshipFixture contains a deterministic Kubernetes object graph
// large enough to benchmark shared resource model relationship materialization.
type ResourceRelationshipFixture struct {
	ClusterID             string
	Namespace             string
	Pods                  *corev1.PodList
	RoleBindings          *rbacv1.RoleBindingList
	ClusterRoleBindings   *rbacv1.ClusterRoleBindingList
	ConfigMap             *corev1.ConfigMap
	Secret                *corev1.Secret
	PersistentVolumeClaim *corev1.PersistentVolumeClaim
	ServiceAccount        *corev1.ServiceAccount
	Role                  *rbacv1.Role
	ClusterRole           *rbacv1.ClusterRole
	RoleBinding           *rbacv1.RoleBinding
	ClusterRoleBinding    *rbacv1.ClusterRoleBinding
}

// LargeResourceRelationshipFixture builds a shared synthetic dataset with
// 1,000 Pods, 500 RoleBindings, and 250 ClusterRoleBindings.
func LargeResourceRelationshipFixture() ResourceRelationshipFixture {
	pods := &corev1.PodList{Items: make([]corev1.Pod, 0, 1000)}
	for i := 0; i < 1000; i++ {
		ns := fmt.Sprintf("team-%02d", i%20)
		pods.Items = append(pods.Items, corev1.Pod{
			ObjectMeta: metav1.ObjectMeta{Name: fmt.Sprintf("pod-%04d", i), Namespace: ns, UID: types.UID(fmt.Sprintf("pod-%04d", i))},
			Spec: corev1.PodSpec{
				ServiceAccountName: fmt.Sprintf("sa-%02d", i%50),
				Volumes: []corev1.Volume{
					{
						Name: "config",
						VolumeSource: corev1.VolumeSource{ConfigMap: &corev1.ConfigMapVolumeSource{
							LocalObjectReference: corev1.LocalObjectReference{Name: fmt.Sprintf("config-%02d", i%100)},
						}},
					},
					{
						Name: "secret",
						VolumeSource: corev1.VolumeSource{Secret: &corev1.SecretVolumeSource{
							SecretName: fmt.Sprintf("secret-%02d", i%100),
						}},
					},
					{
						Name: "claim",
						VolumeSource: corev1.VolumeSource{PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{
							ClaimName: fmt.Sprintf("data-%02d", i%100),
						}},
					},
				},
			},
		})
	}

	roleBindings := &rbacv1.RoleBindingList{Items: make([]rbacv1.RoleBinding, 0, 500)}
	for i := 0; i < 500; i++ {
		ns := fmt.Sprintf("team-%02d", i%20)
		roleBindings.Items = append(roleBindings.Items, rbacv1.RoleBinding{
			ObjectMeta: metav1.ObjectMeta{Name: fmt.Sprintf("rb-%04d", i), Namespace: ns},
			RoleRef:    rbacv1.RoleRef{APIGroup: rbacv1.GroupName, Kind: "Role", Name: fmt.Sprintf("role-%02d", i%50)},
			Subjects:   []rbacv1.Subject{{Kind: "ServiceAccount", Name: fmt.Sprintf("sa-%02d", i%50)}},
		})
	}

	clusterRoleBindings := &rbacv1.ClusterRoleBindingList{Items: make([]rbacv1.ClusterRoleBinding, 0, 250)}
	for i := 0; i < 250; i++ {
		clusterRoleBindings.Items = append(clusterRoleBindings.Items, rbacv1.ClusterRoleBinding{
			ObjectMeta: metav1.ObjectMeta{Name: fmt.Sprintf("crb-%04d", i)},
			RoleRef:    rbacv1.RoleRef{APIGroup: rbacv1.GroupName, Kind: "ClusterRole", Name: fmt.Sprintf("cluster-role-%02d", i%50)},
			Subjects:   []rbacv1.Subject{{Kind: "ServiceAccount", Name: fmt.Sprintf("sa-%02d", i%50), Namespace: fmt.Sprintf("team-%02d", i%20)}},
		})
	}

	return ResourceRelationshipFixture{
		ClusterID:           ResourceRelationshipFixtureClusterID,
		Namespace:           ResourceRelationshipFixtureNamespace,
		Pods:                pods,
		RoleBindings:        roleBindings,
		ClusterRoleBindings: clusterRoleBindings,
		ConfigMap: &corev1.ConfigMap{
			ObjectMeta: metav1.ObjectMeta{Name: "config-00", Namespace: ResourceRelationshipFixtureNamespace, UID: types.UID("config-00")},
			Data:       map[string]string{"app.yaml": "enabled: true"},
		},
		Secret: &corev1.Secret{
			ObjectMeta: metav1.ObjectMeta{Name: "secret-00", Namespace: ResourceRelationshipFixtureNamespace, UID: types.UID("secret-00")},
			Type:       corev1.SecretTypeOpaque,
			Data:       map[string][]byte{"token": []byte("secret")},
		},
		PersistentVolumeClaim: &corev1.PersistentVolumeClaim{
			ObjectMeta: metav1.ObjectMeta{Name: "data-00", Namespace: ResourceRelationshipFixtureNamespace, UID: types.UID("pvc-00")},
			Spec: corev1.PersistentVolumeClaimSpec{
				Resources: corev1.VolumeResourceRequirements{Requests: corev1.ResourceList{corev1.ResourceStorage: resource.MustParse("10Gi")}},
			},
			Status: corev1.PersistentVolumeClaimStatus{Phase: corev1.ClaimBound},
		},
		ServiceAccount: &corev1.ServiceAccount{
			ObjectMeta:                   metav1.ObjectMeta{Name: "sa-00", Namespace: ResourceRelationshipFixtureNamespace, UID: types.UID("sa-00")},
			AutomountServiceAccountToken: ptr.To(true),
		},
		Role: &rbacv1.Role{
			ObjectMeta: metav1.ObjectMeta{Name: "role-00", Namespace: ResourceRelationshipFixtureNamespace, UID: types.UID("role-00")},
			Rules: []rbacv1.PolicyRule{{
				APIGroups: []string{""},
				Resources: []string{"pods"},
				Verbs:     []string{"get", "list"},
			}},
		},
		ClusterRole: &rbacv1.ClusterRole{
			ObjectMeta: metav1.ObjectMeta{Name: "cluster-role-00", UID: types.UID("cluster-role-00")},
			Rules: []rbacv1.PolicyRule{{
				APIGroups: []string{"apps"},
				Resources: []string{"deployments"},
				Verbs:     []string{"get", "list"},
			}},
		},
		RoleBinding:        &roleBindings.Items[0],
		ClusterRoleBinding: &clusterRoleBindings.Items[0],
	}
}
