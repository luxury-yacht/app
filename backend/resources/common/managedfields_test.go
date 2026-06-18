/*
 * backend/resources/common/managedfields_test.go
 *
 * Tests for managedFields-derived "last modified" computation.
 */

package common

import (
	"testing"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func mfEntry(manager, subresource string, t *time.Time) metav1.ManagedFieldsEntry {
	var mt *metav1.Time
	if t != nil {
		mt = &metav1.Time{Time: *t}
	}
	return metav1.ManagedFieldsEntry{Manager: manager, Subresource: subresource, Time: mt}
}

func TestLastModifiedTime(t *testing.T) {
	base := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	t1 := base
	t2 := base.Add(time.Hour)
	t3 := base.Add(2 * time.Hour)

	t.Run("returns the latest time across spec/metadata entries", func(t *testing.T) {
		obj := &metav1.ObjectMeta{ManagedFields: []metav1.ManagedFieldsEntry{
			mfEntry("kubectl", "", &t1),
			mfEntry("controller", "", &t3),
			mfEntry("other", "", &t2),
		}}
		got, ok := LastModifiedTime(obj)
		if !ok || !got.Equal(t3) {
			t.Fatalf("expected %v true, got %v %v", t3, got, ok)
		}
	})

	t.Run("ignores status-subresource entries (controller churn)", func(t *testing.T) {
		obj := &metav1.ObjectMeta{ManagedFields: []metav1.ManagedFieldsEntry{
			mfEntry("kubectl", "", &t1),
			// Newer, but a status write — must be ignored.
			mfEntry("kube-controller-manager", "status", &t3),
		}}
		got, ok := LastModifiedTime(obj)
		if !ok || !got.Equal(t1) {
			t.Fatalf("expected %v true, got %v %v", t1, got, ok)
		}
	})

	t.Run("returns false when only status or nil-time entries exist", func(t *testing.T) {
		obj := &metav1.ObjectMeta{ManagedFields: []metav1.ManagedFieldsEntry{
			mfEntry("kube-controller-manager", "status", &t3),
			mfEntry("nil-time", "", nil),
		}}
		if _, ok := LastModifiedTime(obj); ok {
			t.Fatalf("expected ok=false")
		}
	})

	t.Run("returns false when there are no managedFields", func(t *testing.T) {
		if _, ok := LastModifiedTime(&metav1.ObjectMeta{}); ok {
			t.Fatalf("expected ok=false")
		}
	})
}

func TestFormatLastModified(t *testing.T) {
	t.Run("empty string when unavailable", func(t *testing.T) {
		if got := FormatLastModified(&metav1.ObjectMeta{}); got != "" {
			t.Fatalf("expected empty, got %q", got)
		}
	})

	t.Run("uses FormatAge for consistency with the Age field", func(t *testing.T) {
		recent := time.Now().Add(-90 * time.Minute)
		obj := &metav1.ObjectMeta{ManagedFields: []metav1.ManagedFieldsEntry{
			mfEntry("kubectl", "", &recent),
		}}
		got := FormatLastModified(obj)
		if got == "" {
			t.Fatalf("expected non-empty formatted age")
		}
		if want := FormatAge(recent); got != want {
			t.Fatalf("expected %q, got %q", want, got)
		}
	})

	t.Run("returns Never when the only change is the object's creation", func(t *testing.T) {
		created := time.Now().Add(-72 * time.Hour).Truncate(time.Second)
		obj := &metav1.ObjectMeta{
			CreationTimestamp: metav1.Time{Time: created},
			ManagedFields: []metav1.ManagedFieldsEntry{
				// The creating manager's entry is stamped at creation time.
				mfEntry("kube-apiserver", "", &created),
			},
		}
		if got := FormatLastModified(obj); got != "Never" {
			t.Fatalf("expected Never, got %q", got)
		}
	})

	t.Run("returns a duration when modified after creation", func(t *testing.T) {
		created := time.Now().Add(-72 * time.Hour).Truncate(time.Second)
		modified := time.Now().Add(-time.Hour).Truncate(time.Second)
		obj := &metav1.ObjectMeta{
			CreationTimestamp: metav1.Time{Time: created},
			ManagedFields: []metav1.ManagedFieldsEntry{
				mfEntry("kube-apiserver", "", &created),
				mfEntry("kubectl", "", &modified),
			},
		}
		got := FormatLastModified(obj)
		if got == "Never" || got == "" {
			t.Fatalf("expected a duration, got %q", got)
		}
		if want := FormatAge(modified); got != want {
			t.Fatalf("expected %q, got %q", want, got)
		}
	})
}
