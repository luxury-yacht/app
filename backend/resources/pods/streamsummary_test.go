package pods

import (
	"testing"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// TestResolvePodOwnerThreadsCRDOwnerAPIVersion guards that the controlling
// owner's apiVersion is threaded through (CRD owners) and that the
// ReplicaSet->Deployment collapse hardcodes apps/v1.
func TestResolvePodOwnerThreadsCRDOwnerAPIVersion(t *testing.T) {
	owner := func() *bool { b := true; return &b }()

	t.Run("Argo Rollout owner", func(t *testing.T) {
		pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{OwnerReferences: []metav1.OwnerReference{{
			APIVersion: "argoproj.io/v1alpha1", Kind: "Rollout", Name: "canary", Controller: owner,
		}}}}
		kind, name, apiVersion := resolvePodOwner(pod, map[string]string{})
		require.Equal(t, "Rollout", kind)
		require.Equal(t, "canary", name)
		require.Equal(t, "argoproj.io/v1alpha1", apiVersion)
	})

	t.Run("KubeVirt VirtualMachineInstance owner", func(t *testing.T) {
		pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{OwnerReferences: []metav1.OwnerReference{{
			APIVersion: "kubevirt.io/v1", Kind: "VirtualMachineInstance", Name: "vmi-test", Controller: owner,
		}}}}
		kind, name, apiVersion := resolvePodOwner(pod, map[string]string{})
		require.Equal(t, "VirtualMachineInstance", kind)
		require.Equal(t, "vmi-test", name)
		require.Equal(t, "kubevirt.io/v1", apiVersion)
	})

	t.Run("ReplicaSet collapse hardcodes apps/v1", func(t *testing.T) {
		pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{OwnerReferences: []metav1.OwnerReference{{
			Kind: "ReplicaSet", Name: "demo-rs", Controller: owner,
		}}}}
		kind, name, apiVersion := resolvePodOwner(pod, map[string]string{"demo-rs": "demo-deploy"})
		require.Equal(t, "Deployment", kind)
		require.Equal(t, "demo-deploy", name)
		require.Equal(t, "apps/v1", apiVersion)
	})

	t.Run("ownerless pod returns empty apiVersion", func(t *testing.T) {
		pod := &corev1.Pod{}
		kind, name, apiVersion := resolvePodOwner(pod, map[string]string{})
		require.Equal(t, "None", kind)
		require.Equal(t, "None", name)
		require.Empty(t, apiVersion)
	})
}
