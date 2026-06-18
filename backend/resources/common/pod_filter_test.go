/*
 * backend/resources/common/pod_filter_test.go
 *
 * Tests for shared pod-owner filtering.
 */

package common

import (
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestFilterPodsByControllerOwner(t *testing.T) {
	ctrl := true
	notCtrl := false
	ref := func(kind, name string, controller *bool) metav1.OwnerReference {
		return metav1.OwnerReference{Kind: kind, Name: name, Controller: controller}
	}
	pod := func(name string, owners ...metav1.OwnerReference) corev1.Pod {
		return corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: name, OwnerReferences: owners}}
	}
	list := &corev1.PodList{Items: []corev1.Pod{
		pod("match", ref("DaemonSet", "ds", &ctrl)),
		pod("wrongKind", ref("ReplicaSet", "ds", &ctrl)),
		pod("wrongName", ref("DaemonSet", "other", &ctrl)),
		pod("notController", ref("DaemonSet", "ds", &notCtrl)),
		pod("noOwner"),
	}}

	got := FilterPodsByControllerOwner(list, "DaemonSet", "ds")
	if len(got) != 1 || got[0].Name != "match" {
		names := make([]string, len(got))
		for i, p := range got {
			names[i] = p.Name
		}
		t.Fatalf("expected [match], got %v", names)
	}

	if FilterPodsByControllerOwner(nil, "DaemonSet", "ds") != nil {
		t.Fatal("nil podList should return nil")
	}
}
