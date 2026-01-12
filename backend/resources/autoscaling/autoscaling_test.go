/*
 * backend/resources/autoscaling/autoscaling_test.go
 *
 * Test helpers for autoscaling resources.
 * - Provides shared helpers for autoscaling tests.
 */

package autoscaling

import "k8s.io/apimachinery/pkg/api/resource"

func resourcePtr(value string) *resource.Quantity {
	q := resource.MustParse(value)
	return &q
}

func ptrToInt32(v int32) *int32 {
	return &v
}
