package pods

import (
	"testing"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// TestResolvePodOwnerThreadsCRDOwnerAPIVersion guards that the controlling
// owner's apiVersion is threaded through (CRD owners), that the
// ReplicaSet->Deployment collapse hardcodes apps/v1, and that the direct
// owner always preserves the pod's own ownerRef (equal to the collapsed
// owner except across the collapse).
func TestResolvePodOwnerThreadsCRDOwnerAPIVersion(t *testing.T) {
	owner := func() *bool { b := true; return &b }()

	t.Run("Argo Rollout owner", func(t *testing.T) {
		pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{OwnerReferences: []metav1.OwnerReference{{
			APIVersion: "argoproj.io/v1alpha1", Kind: "Rollout", Name: "canary", Controller: owner,
		}}}}
		resolved := resolvePodOwner(pod, map[string]string{})
		require.Equal(t, "Rollout", resolved.kind)
		require.Equal(t, "canary", resolved.name)
		require.Equal(t, "argoproj.io/v1alpha1", resolved.apiVersion)
		require.Equal(t, "Rollout", resolved.directKind)
		require.Equal(t, "canary", resolved.directName)
		require.Equal(t, "argoproj.io/v1alpha1", resolved.directAPIVersion)
	})

	t.Run("KubeVirt VirtualMachineInstance owner", func(t *testing.T) {
		pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{OwnerReferences: []metav1.OwnerReference{{
			APIVersion: "kubevirt.io/v1", Kind: "VirtualMachineInstance", Name: "vmi-test", Controller: owner,
		}}}}
		resolved := resolvePodOwner(pod, map[string]string{})
		require.Equal(t, "VirtualMachineInstance", resolved.kind)
		require.Equal(t, "vmi-test", resolved.name)
		require.Equal(t, "kubevirt.io/v1", resolved.apiVersion)
	})

	t.Run("ReplicaSet collapse hardcodes apps/v1 and keeps the direct RS owner", func(t *testing.T) {
		pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{OwnerReferences: []metav1.OwnerReference{{
			APIVersion: "apps/v1", Kind: "ReplicaSet", Name: "demo-rs", Controller: owner,
		}}}}
		resolved := resolvePodOwner(pod, map[string]string{"demo-rs": "demo-deploy"})
		require.Equal(t, "Deployment", resolved.kind)
		require.Equal(t, "demo-deploy", resolved.name)
		require.Equal(t, "apps/v1", resolved.apiVersion)
		// The collapse must not erase the direct owner: the ReplicaSet-scoped
		// Pods window matches rows by these fields.
		require.Equal(t, "ReplicaSet", resolved.directKind)
		require.Equal(t, "demo-rs", resolved.directName)
		require.Equal(t, "apps/v1", resolved.directAPIVersion)
	})

	t.Run("ownerless pod returns empty apiVersion", func(t *testing.T) {
		pod := &corev1.Pod{}
		resolved := resolvePodOwner(pod, map[string]string{})
		require.Equal(t, "None", resolved.kind)
		require.Equal(t, "None", resolved.name)
		require.Empty(t, resolved.apiVersion)
		require.Empty(t, resolved.directKind)
		require.Empty(t, resolved.directName)
	})
}
