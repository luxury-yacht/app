/*
 * backend/resources/common/format_test.go
 *
 * Tests for Formatting helpers for resource fields.
 * - Covers Formatting helpers for resource fields behavior and edge cases.
 */

package common

import (
	"testing"
	"time"

	"k8s.io/apimachinery/pkg/api/resource"

	"github.com/luxury-yacht/app/backend/internal/timeutil"
)

func TestFormatCPU(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		qty  *resource.Quantity
		want string
	}{
		{"NilQuantity", nil, "-"},
		{"Zero", resource.NewMilliQuantity(0, resource.DecimalSI), "-"},
		{"Milli", resource.NewMilliQuantity(500, resource.DecimalSI), "500m"},
		{"Cores", resource.NewMilliQuantity(1500, resource.DecimalSI), "1.50"},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			got := FormatCPU(tc.qty)
			if got != tc.want {
				t.Fatalf("FormatCPU(%v) = %q, want %q", tc.qty, got, tc.want)
			}
		})
	}
}

func TestFormatMemory(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		qty  *resource.Quantity
		want string
	}{
		{"NilQuantity", nil, "-"},
		{"Zero", resource.NewQuantity(0, resource.BinarySI), "-"},
		{"Bytes", resource.NewQuantity(512, resource.BinarySI), "512"},
		{"Ki", resource.NewQuantity(2*1024, resource.BinarySI), "2Ki"},
		{"Mi", resource.NewQuantity(64*1024*1024, resource.BinarySI), "64Mi"},
		{"Gi", resource.NewQuantity(2*1024*1024*1024, resource.BinarySI), "2.00Gi"},
	}

	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			got := FormatMemory(tc.qty)
			if got != tc.want {
				t.Fatalf("FormatMemory(%v) = %q, want %q", tc.qty, got, tc.want)
			}
		})
	}
}

func TestFormatAgeDelegatesToTimeutil(t *testing.T) {
	t.Parallel()

	ts := time.Now().Add(-3 * time.Hour)
	want := timeutil.FormatAge(ts)
	got := FormatAge(ts)
	if got != want {
		t.Fatalf("expected FormatAge to match timeutil.FormatAge output %q, got %q", want, got)
	}
}
