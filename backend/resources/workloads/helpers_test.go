package workloads

import (
	"testing"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"

	"github.com/luxury-yacht/app/backend/resources/common"
)

func TestDescribeContainers(t *testing.T) {
	cpuReq := resource.MustParse("100m")
	cpuLim := resource.MustParse("500m")
	memReq := resource.MustParse("64Mi")
	memLim := resource.MustParse("256Mi")

	containers := []corev1.Container{
		{
			Name:            "app",
			Image:           "nginx:1.2",
			ImagePullPolicy: corev1.PullIfNotPresent,
			Command:         []string{"run"},
			Args:            []string{"--flag"},
			Resources: corev1.ResourceRequirements{
				Requests: corev1.ResourceList{
					corev1.ResourceCPU:    cpuReq,
					corev1.ResourceMemory: memReq,
				},
				Limits: corev1.ResourceList{
					corev1.ResourceCPU:    cpuLim,
					corev1.ResourceMemory: memLim,
				},
			},
			Ports: []corev1.ContainerPort{
				{ContainerPort: 80, Name: "http"},
				{ContainerPort: 53, Protocol: corev1.ProtocolUDP},
			},
			VolumeMounts: []corev1.VolumeMount{
				{Name: "config", MountPath: "/etc/config", ReadOnly: true},
			},
			Env: []corev1.EnvVar{
				{Name: "PLAIN", Value: "value"},
				{Name: "FROM_SOURCE", ValueFrom: &corev1.EnvVarSource{FieldRef: &corev1.ObjectFieldSelector{FieldPath: "metadata.name"}}},
			},
		},
	}

	details := describeContainers(containers)
	if len(details) != 1 {
		t.Fatalf("expected 1 container detail, got %d", len(details))
	}

	got := details[0]
	if got.Name != "app" || got.Image != "nginx:1.2" || got.ImagePullPolicy != string(corev1.PullIfNotPresent) {
		t.Fatalf("unexpected identity: %+v", got)
	}
	if got.CPURequest != common.FormatCPU(&cpuReq) || got.CPULimit != common.FormatCPU(&cpuLim) {
		t.Fatalf("unexpected cpu formatting: req=%s lim=%s", got.CPURequest, got.CPULimit)
	}
	if got.MemRequest != common.FormatMemory(&memReq) || got.MemLimit != common.FormatMemory(&memLim) {
		t.Fatalf("unexpected mem formatting: req=%s lim=%s", got.MemRequest, got.MemLimit)
	}
	if len(got.Ports) != 2 || got.Ports[0] != "80 (http)" || got.Ports[1] != "53/UDP" {
		t.Fatalf("unexpected ports: %#v", got.Ports)
	}
	if len(got.VolumeMounts) != 1 || got.VolumeMounts[0] != "config -> /etc/config (ro)" {
		t.Fatalf("unexpected volume mounts: %#v", got.VolumeMounts)
	}
	if got.Environment["PLAIN"] != "value" || got.Environment["FROM_SOURCE"] != "<from source>" {
		t.Fatalf("unexpected env: %#v", got.Environment)
	}
	if len(got.Command) != 1 || got.Command[0] != "run" || len(got.Args) != 1 || got.Args[0] != "--flag" {
		t.Fatalf("unexpected command/args: %v %v", got.Command, got.Args)
	}
}
