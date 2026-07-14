package resourcemodel

import (
	"testing"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
)

func TestQuotaUsedPercentagesPreservesFractionalQuantities(t *testing.T) {
	percentages := QuotaUsedPercentages(
		corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("2400m")},
		corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("2")},
	)

	require.Equal(t, 120, percentages[string(corev1.ResourceCPU)])
}
