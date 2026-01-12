package autoscaling

import "k8s.io/apimachinery/pkg/api/resource"

type noopLogger struct{}

func (noopLogger) Debug(string, ...string) {}
func (noopLogger) Info(string, ...string)  {}
func (noopLogger) Warn(string, ...string)  {}
func (noopLogger) Error(string, ...string) {}

func resourcePtr(value string) *resource.Quantity {
	q := resource.MustParse(value)
	return &q
}

func ptrToInt32(v int32) *int32 {
	return &v
}
