/*
 * backend/resources/pods/pods_test.go
 *
 * Tests for Pod resource handlers.
 * - Covers Pod resource handlers behavior and edge cases.
 */

package pods

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/kubernetes/fake"
	cgotesting "k8s.io/client-go/testing"
	metricsv1beta1 "k8s.io/metrics/pkg/apis/metrics/v1beta1"
	metricsfake "k8s.io/metrics/pkg/client/clientset/versioned/fake"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
)

func TestGetPodRequiresTargetIdentity(t *testing.T) {
	service := NewService(common.Dependencies{
		Context:          context.Background(),
		Logger:           applog.Noop,
		KubernetesClient: fake.NewClientset(),
	})

	_, err := service.GetPod("", "demo-pod", false)
	require.EqualError(t, err, "namespace is required")

	_, err = service.GetPod("team-a", "", false)
	require.EqualError(t, err, "pod name is required")
}

func TestGetPodPropagatesError(t *testing.T) {
	client := fake.NewClientset()
	client.PrependReactor("get", "pods", func(action cgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("boom")
	})

	deps := common.Dependencies{
		Context:          context.Background(),
		Logger:           applog.Noop,
		KubernetesClient: client,
	}

	if _, err := GetPod(deps, "ns", "name", false); err == nil {
		t.Fatalf("expected error from GetPod when API fails")
	}
}

func TestDeletePodSucceeds(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "delete-me",
			Namespace: "team-a",
		},
	}
	client := fake.NewClientset(pod)

	deps := common.Dependencies{
		Context:          context.Background(),
		Logger:           applog.Noop,
		KubernetesClient: client,
	}

	if err := DeletePod(deps, "team-a", "delete-me"); err != nil {
		t.Fatalf("DeletePod returned error: %v", err)
	}

	var deleteFound bool
	for _, action := range client.Actions() {
		if action.Matches("delete", "pods") {
			deleteFound = true
			break
		}
	}
	if !deleteFound {
		t.Fatalf("expected delete action to be issued")
	}
}

func TestDeletePodRequiresTargetIdentity(t *testing.T) {
	service := NewService(common.Dependencies{
		Context:          context.Background(),
		Logger:           applog.Noop,
		KubernetesClient: fake.NewClientset(),
	})

	err := service.DeletePod("", "delete-me")
	require.EqualError(t, err, "namespace is required")

	err = service.DeletePod("team-a", "")
	require.EqualError(t, err, "pod name is required")
}

func TestDeletePodReturnsErrorWhenAPIFails(t *testing.T) {
	client := fake.NewClientset(&corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "delete-me", Namespace: "team-a"},
	})
	client.PrependReactor("delete", "pods", func(action cgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("cannot delete")
	})

	deps := common.Dependencies{
		Context:          context.Background(),
		Logger:           applog.Noop,
		KubernetesClient: client,
	}

	if err := DeletePod(deps, "team-a", "delete-me"); err == nil {
		t.Fatalf("expected DeletePod to surface API error")
	}
}

func TestDeletePodReturnsErrorWhenContextMissing(t *testing.T) {
	client := fake.NewClientset(&corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "delete-me", Namespace: "team-a"},
	})

	deps := common.Dependencies{
		Context:          nil,
		Logger:           applog.Noop,
		KubernetesClient: client,
	}

	err := DeletePod(deps, "team-a", "delete-me")
	require.Error(t, err)
	require.Contains(t, err.Error(), "kubernetes client not initialized")
}

func TestCalculatePodResourcesAggregates(t *testing.T) {
	pod := corev1.Pod{
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{{
				Resources: corev1.ResourceRequirements{
					Requests: corev1.ResourceList{
						corev1.ResourceCPU:    resource.MustParse("100m"),
						corev1.ResourceMemory: resource.MustParse("64Mi"),
					},
					Limits: corev1.ResourceList{
						corev1.ResourceCPU:    resource.MustParse("200m"),
						corev1.ResourceMemory: resource.MustParse("128Mi"),
					},
				},
			}},
			InitContainers: []corev1.Container{{
				Resources: corev1.ResourceRequirements{
					Requests: corev1.ResourceList{
						corev1.ResourceCPU:    resource.MustParse("250m"),
						corev1.ResourceMemory: resource.MustParse("256Mi"),
					},
					Limits: corev1.ResourceList{
						corev1.ResourceCPU:    resource.MustParse("500m"),
						corev1.ResourceMemory: resource.MustParse("512Mi"),
					},
				},
			}},
		},
	}

	cpuReq, cpuLim, memReq, memLim := calculatePodResources(pod)
	require.Equal(t, "250m", cpuReq.String())
	require.Equal(t, "500m", cpuLim.String())
	require.Equal(t, "256Mi", memReq.String())
	require.Equal(t, "512Mi", memLim.String())
}

func TestCalculatePodResourcesVariants(t *testing.T) {
	restartAlways := corev1.ContainerRestartPolicyAlways
	tests := []struct {
		name string
		pod  corev1.Pod
		want [4]string
	}{
		{name: "empty", pod: corev1.Pod{}, want: [4]string{"0", "0", "0", "0"}},
		{
			name: "regular container sums exceed init maxima",
			pod: corev1.Pod{Spec: corev1.PodSpec{
				Containers: []corev1.Container{
					{Resources: testResourceRequirements("100m", "200m", "64Mi", "128Mi")},
					{Resources: testResourceRequirements("150m", "100m", "96Mi", "64Mi")},
				},
				InitContainers: []corev1.Container{{Resources: testResourceRequirements("200m", "250m", "80Mi", "160Mi")}},
			}},
			want: [4]string{"250m", "300m", "160Mi", "192Mi"},
		},
		{
			name: "independent init and sidecar maxima",
			pod: corev1.Pod{Spec: corev1.PodSpec{
				Containers: []corev1.Container{{Resources: testResourceRequirements("50m", "50m", "32Mi", "32Mi")}},
				InitContainers: []corev1.Container{
					{Resources: testResourceRequirements("400m", "100m", "64Mi", "512Mi")},
					{RestartPolicy: &restartAlways, Resources: testResourceRequirements("200m", "600m", "256Mi", "128Mi")},
				},
			}},
			want: [4]string{"400m", "600m", "256Mi", "512Mi"},
		},
		{
			name: "missing resource dimensions stay zero",
			pod: corev1.Pod{Spec: corev1.PodSpec{Containers: []corev1.Container{{
				Resources: corev1.ResourceRequirements{Requests: corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("25m")}},
			}}}},
			want: [4]string{"25m", "0", "0", "0"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cpuReq, cpuLim, memReq, memLim := calculatePodResources(tt.pod)
			require.Equal(t, tt.want, [4]string{cpuReq.String(), cpuLim.String(), memReq.String(), memLim.String()})
		})
	}
}

func testResourceRequirements(cpuRequest, cpuLimit, memoryRequest, memoryLimit string) corev1.ResourceRequirements {
	return corev1.ResourceRequirements{
		Requests: corev1.ResourceList{
			corev1.ResourceCPU:    resource.MustParse(cpuRequest),
			corev1.ResourceMemory: resource.MustParse(memoryRequest),
		},
		Limits: corev1.ResourceList{
			corev1.ResourceCPU:    resource.MustParse(cpuLimit),
			corev1.ResourceMemory: resource.MustParse(memoryLimit),
		},
	}
}

func TestBuildReplicaSetToDeploymentMap(t *testing.T) {
	controller := true
	rs := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "demo-rs",
			Namespace: "team-a",
			OwnerReferences: []metav1.OwnerReference{{
				Kind:       "Deployment",
				Name:       "demo-deploy",
				Controller: &controller,
			}},
		},
	}

	client := fake.NewClientset(rs)
	service := NewService(common.Dependencies{
		Context:          context.Background(),
		KubernetesClient: client,
	})

	mapping := service.buildReplicaSetToDeploymentMap("team-a")
	require.Equal(t, "demo-deploy", mapping["demo-rs"])
}

func TestBuildReplicaSetToDeploymentMapExported(t *testing.T) {
	controller := true
	rs := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "demo-rs",
			Namespace: "team-a",
			OwnerReferences: []metav1.OwnerReference{{
				Kind:       "Deployment",
				Name:       "demo-deploy",
				Controller: &controller,
			}},
		},
	}

	client := fake.NewClientset(rs)
	service := NewService(common.Dependencies{
		Context:          context.Background(),
		KubernetesClient: client,
	})

	mapping := service.BuildReplicaSetToDeploymentMap("team-a")
	require.Equal(t, "demo-deploy", mapping["demo-rs"])
}

func TestGetPodOwnerWithMap(t *testing.T) {
	controller := true
	pod := corev1.Pod{ObjectMeta: metav1.ObjectMeta{
		Name:      "pod",
		Namespace: "team-a",
		OwnerReferences: []metav1.OwnerReference{{
			Kind:       "ReplicaSet",
			Name:       "demo-rs",
			APIVersion: "apps/v1",
			Controller: &controller,
		}},
	}}
	mapping := map[string]string{"demo-rs": "demo-deploy"}
	kind, name, apiVersion := getPodOwnerWithMap(pod, mapping)
	require.Equal(t, "Deployment", kind)
	require.Equal(t, "demo-deploy", name)
	require.Equal(t, "apps/v1", apiVersion, "ReplicaSet→Deployment collapse must produce apps/v1")

	pod.ObjectMeta.OwnerReferences = []metav1.OwnerReference{{Kind: "Job", Name: "work", APIVersion: "batch/v1", Controller: &controller}}
	kind, name, apiVersion = getPodOwnerWithMap(pod, mapping)
	require.Equal(t, "Job", kind)
	require.Equal(t, "work", name)
	require.Equal(t, "batch/v1", apiVersion, "non-collapsed owner must use owner.APIVersion verbatim")

	// CRD-as-Pod-owner case (Argo Rollout / KubeVirt VMI / Tekton TaskRun
	// shape). The apiVersion must come from the OwnerReference verbatim so
	// the panel can open the CRD with a fully-qualified GVK.
	pod.ObjectMeta.OwnerReferences = []metav1.OwnerReference{{
		Kind:       "Rollout",
		Name:       "canary",
		APIVersion: "argoproj.io/v1alpha1",
		Controller: &controller,
	}}
	kind, name, apiVersion = getPodOwnerWithMap(pod, mapping)
	require.Equal(t, "Rollout", kind)
	require.Equal(t, "canary", name)
	require.Equal(t, "argoproj.io/v1alpha1", apiVersion, "CRD-as-Pod-owner must thread owner.APIVersion through")
}

func TestGetNodeIP(t *testing.T) {
	node := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{Name: "node-1"},
		Status:     corev1.NodeStatus{Addresses: []corev1.NodeAddress{{Type: corev1.NodeInternalIP, Address: "10.0.0.1"}}},
	}
	client := fake.NewClientset(node)
	service := NewService(common.Dependencies{
		Context:          context.Background(),
		KubernetesClient: client,
	})

	require.Equal(t, "10.0.0.1", service.getNodeIP("node-1"))
	require.Equal(t, "", service.getNodeIP("missing"))
}

func TestGetNodeIPReturnsEmptyOnError(t *testing.T) {
	service := NewService(common.Dependencies{
		Context:          context.Background(),
		KubernetesClient: fake.NewClientset(),
	})

	require.Equal(t, "", service.getNodeIP("node-does-not-exist"))
}

func TestGetPodMetricsFallbackWhenClientMissing(t *testing.T) {
	service := NewService(common.Dependencies{
		Context: context.Background(),
		Logger:  applog.Noop,
	})

	metrics := service.getPodMetrics("team-a")
	require.Empty(t, metrics)
}

func TestGetPodMetricsForPodsUsesIndividualFetchForSmallSets(t *testing.T) {
	ctx := context.Background()
	var getCalls int
	metricsClient := metricsfake.NewSimpleClientset()
	metricsClient.PrependReactor("get", "pods", func(action cgotesting.Action) (bool, runtime.Object, error) {
		getCalls++
		getAction, ok := action.(cgotesting.GetAction)
		require.True(t, ok)
		name := getAction.GetName()
		return true, buildPodMetrics("team-a", name), nil
	})

	service := NewService(common.Dependencies{
		Context:          ctx,
		Logger:           applog.Noop,
		KubernetesClient: fake.NewClientset(),
		MetricsClient:    metricsClient,
	})

	pods := []corev1.Pod{{
		ObjectMeta: metav1.ObjectMeta{Name: "pod-a", Namespace: "team-a"},
	}}

	metrics := service.getPodMetricsForPods("team-a", pods)
	require.Len(t, metrics, len(pods))

	require.Equal(t, len(pods), getCalls)
}

func TestGetPodMetricsForPodsListsForLargeSets(t *testing.T) {
	ctx := context.Background()
	var listCalls int
	metricsClient := metricsfake.NewSimpleClientset()
	metricsClient.PrependReactor("list", "pods", func(action cgotesting.Action) (bool, runtime.Object, error) {
		listCalls++
		list := &metricsv1beta1.PodMetricsList{}
		for _, name := range []string{"pod-a", "pod-b", "pod-c", "pod-d"} {
			list.Items = append(list.Items, *buildPodMetrics("team-a", name))
		}
		return true, list, nil
	})

	service := NewService(common.Dependencies{
		Context:          ctx,
		Logger:           applog.Noop,
		KubernetesClient: fake.NewClientset(),
		MetricsClient:    metricsClient,
	})

	pods := []corev1.Pod{
		{ObjectMeta: metav1.ObjectMeta{Name: "pod-a", Namespace: "team-a"}},
		{ObjectMeta: metav1.ObjectMeta{Name: "pod-b", Namespace: "team-a"}},
		{ObjectMeta: metav1.ObjectMeta{Name: "pod-c", Namespace: "team-a"}},
		{ObjectMeta: metav1.ObjectMeta{Name: "pod-d", Namespace: "team-a"}},
	}

	metrics := service.getPodMetricsForPods("team-a", pods)
	require.Len(t, metrics, len(pods))

	require.Equal(t, 1, listCalls)
}

func TestGetPodMetricsListErrorReturnsEmpty(t *testing.T) {
	ctx := context.Background()
	metricsClient := metricsfake.NewSimpleClientset()
	metricsClient.PrependReactor("list", "podmetricses", func(action cgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, fmt.Errorf("metrics unavailable")
	})

	service := NewService(common.Dependencies{
		Context:          ctx,
		Logger:           applog.Noop,
		KubernetesClient: fake.NewClientset(),
		MetricsClient:    metricsClient,
	})

	values := service.getPodMetrics("team-a")
	require.Empty(t, values)
}

func TestBuildContainerDetailsFormatsPortsAndVolumes(t *testing.T) {
	container := corev1.Container{
		Name:  "web",
		Image: "demo:latest",
		Ports: []corev1.ContainerPort{{
			Name:          "http",
			ContainerPort: 8080,
			Protocol:      corev1.ProtocolTCP,
		}, {
			ContainerPort: 9090,
			Protocol:      corev1.ProtocolUDP,
		}},
		VolumeMounts: []corev1.VolumeMount{{
			Name:      "cfg",
			MountPath: "/etc/config",
			ReadOnly:  true,
			SubPath:   "default",
		}},
		Env: []corev1.EnvVar{{
			Name:  "ENV",
			Value: "prod",
		}, {
			Name: "FROM_SECRET",
			ValueFrom: &corev1.EnvVarSource{
				SecretKeyRef: &corev1.SecretKeySelector{LocalObjectReference: corev1.LocalObjectReference{Name: "secret"}, Key: "token"},
			},
		}},
	}

	statuses := []corev1.ContainerStatus{{
		Name:  "web",
		Ready: true,
		State: corev1.ContainerState{
			Running: &corev1.ContainerStateRunning{StartedAt: metav1.Time{Time: time.Now().Add(-10 * time.Minute)}},
		},
	}}

	detail := buildContainerDetails(container, statuses, 0)
	require.Equal(t, []string{"8080 (http)", "9090/UDP"}, detail.Ports)
	require.Equal(t, []string{"cfg -> /etc/config (ro) [default]"}, detail.VolumeMounts)
	require.Equal(t, map[string]string{"ENV": "prod", "FROM_SECRET": "secret:secret/token"}, detail.Environment)
}

func TestBuildContainerDetailsStatusVariants(t *testing.T) {
	tests := []struct {
		name     string
		statuses []corev1.ContainerStatus
		index    int
		want     restypes.PodDetailInfoContainer
	}{
		{name: "missing status", want: restypes.PodDetailInfoContainer{}},
		{
			name: "running",
			statuses: []corev1.ContainerStatus{{
				Ready: true, RestartCount: 3,
				State: corev1.ContainerState{Running: &corev1.ContainerStateRunning{}},
			}},
			want: restypes.PodDetailInfoContainer{Ready: true, RestartCount: 3, State: "running"},
		},
		{
			name: "waiting",
			statuses: []corev1.ContainerStatus{{}, {
				RestartCount: 4,
				State:        corev1.ContainerState{Waiting: &corev1.ContainerStateWaiting{Reason: "BackOff", Message: "retrying"}},
			}},
			index: 1,
			want:  restypes.PodDetailInfoContainer{RestartCount: 4, State: "waiting", StateReason: "BackOff", StateMessage: "retrying"},
		},
		{
			name: "terminated",
			statuses: []corev1.ContainerStatus{{
				State: corev1.ContainerState{Terminated: &corev1.ContainerStateTerminated{Reason: "Completed", Message: "done"}},
			}},
			want: restypes.PodDetailInfoContainer{State: "terminated", StateReason: "Completed", StateMessage: "done"},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := buildContainerDetails(corev1.Container{}, tt.statuses, tt.index)
			require.Equal(t, tt.want.Ready, got.Ready)
			require.Equal(t, tt.want.RestartCount, got.RestartCount)
			require.Equal(t, tt.want.State, got.State)
			require.Equal(t, tt.want.StateReason, got.StateReason)
			require.Equal(t, tt.want.StateMessage, got.StateMessage)
			require.Empty(t, got.StartedAt)
		})
	}
}

func TestBuildContainerDetailsRunningStartTime(t *testing.T) {
	startedAt := metav1.NewTime(time.Now().Add(-time.Minute))
	detail := buildContainerDetails(corev1.Container{}, []corev1.ContainerStatus{{
		State: corev1.ContainerState{Running: &corev1.ContainerStateRunning{StartedAt: startedAt}},
	}}, 0)

	require.Equal(t, "running", detail.State)
	require.NotEmpty(t, detail.StartedAt)
}

func TestBuildContainerDetailsFormatsEveryEnvironmentSource(t *testing.T) {
	container := corev1.Container{Env: []corev1.EnvVar{
		{Name: "LITERAL", Value: "value"},
		{Name: "CONFIG", ValueFrom: &corev1.EnvVarSource{ConfigMapKeyRef: &corev1.ConfigMapKeySelector{LocalObjectReference: corev1.LocalObjectReference{Name: "settings"}, Key: "mode"}}},
		{Name: "SECRET", ValueFrom: &corev1.EnvVarSource{SecretKeyRef: &corev1.SecretKeySelector{LocalObjectReference: corev1.LocalObjectReference{Name: "credentials"}, Key: "token"}}},
		{Name: "FIELD", ValueFrom: &corev1.EnvVarSource{FieldRef: &corev1.ObjectFieldSelector{FieldPath: "metadata.name"}}},
		{Name: "UNSUPPORTED", ValueFrom: &corev1.EnvVarSource{ResourceFieldRef: &corev1.ResourceFieldSelector{Resource: "limits.cpu"}}},
		{Name: "EMPTY"},
	}}

	detail := buildContainerDetails(container, nil, 0)

	require.Equal(t, map[string]string{
		"LITERAL": "value",
		"CONFIG":  "configmap:settings/mode",
		"SECRET":  "secret:credentials/token",
		"FIELD":   "field:metadata.name",
	}, detail.Environment)
}

func TestResolveOwnerFallsBackToNone(t *testing.T) {
	pod := corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "lonely",
			Namespace: "team-a",
		},
	}

	kind, name, apiVersion := ResolveOwner(pod, map[string]string{})
	require.Equal(t, "None", kind)
	require.Equal(t, "None", name)
	require.Empty(t, apiVersion, "ownerless pod produces empty apiVersion")
}

func TestFormatHelpersHandleEmptyInputs(t *testing.T) {
	require.Empty(t, formatPodVolumes(nil))
	require.Empty(t, FormatPodTolerations(nil))
	require.Nil(t, buildAffinityMap(nil))
	require.Nil(t, buildSecurityContextMap(nil))
}

func TestFormatPodTolerationsIncludesSeconds(t *testing.T) {
	seconds := int64(30)
	result := FormatPodTolerations([]corev1.Toleration{{
		Key:               "taint",
		Operator:          corev1.TolerationOpEqual,
		Value:             "value",
		Effect:            corev1.TaintEffectNoExecute,
		TolerationSeconds: &seconds,
	}})
	require.Equal(t, []string{"taint Equal value (NoExecute) for 30s"}, result)
}

func TestBuildAffinityAndSecurityContextMaps(t *testing.T) {
	runAsUser := int64(1000)
	runAsNonRoot := true
	affinity := &corev1.Affinity{
		NodeAffinity:    &corev1.NodeAffinity{},
		PodAffinity:     &corev1.PodAffinity{},
		PodAntiAffinity: &corev1.PodAntiAffinity{},
	}
	securityContext := &corev1.PodSecurityContext{
		RunAsUser:    &runAsUser,
		RunAsNonRoot: &runAsNonRoot,
	}

	affinityMap := buildAffinityMap(affinity)
	require.Equal(t, map[string]any{
		"nodeAffinity":    "configured",
		"podAffinity":     "configured",
		"podAntiAffinity": "configured",
	}, affinityMap)

	securityMap := buildSecurityContextMap(securityContext)
	require.Equal(t, map[string]any{
		"runAsUser":    runAsUser,
		"runAsNonRoot": runAsNonRoot,
	}, securityMap)
}

func TestBuildContainerDetailsFormatsProbes(t *testing.T) {
	container := corev1.Container{
		Name: "probe",
		ReadinessProbe: &corev1.Probe{
			ProbeHandler: corev1.ProbeHandler{
				HTTPGet: &corev1.HTTPGetAction{
					Path: "/ready",
					Port: intstr.FromInt(8080),
				},
			},
		},
	}
	detail := buildContainerDetails(container, nil, 0)
	require.Equal(t, "probe", detail.Name)
}

func buildPodMetrics(namespace, name string) *metricsv1beta1.PodMetrics {
	return &metricsv1beta1.PodMetrics{
		TypeMeta: metav1.TypeMeta{
			Kind:       "PodMetrics",
			APIVersion: "metrics.k8s.io/v1beta1",
		},
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: namespace,
		},
		Containers: []metricsv1beta1.ContainerMetrics{{
			Name: name + "-container",
			Usage: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("100m"),
				corev1.ResourceMemory: resource.MustParse("64Mi"),
			},
		}},
	}
}

func strPtr(s string) *string { return &s }
func ptrBool(b bool) *bool    { return &b }

func TestGetPodReturnsDetailedInfo(t *testing.T) {
	now := time.Now()
	controller := true

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "demo-pod",
			Namespace:         "team-a",
			Labels:            map[string]string{"app": "demo"},
			Annotations:       map[string]string{"note": "test"},
			CreationTimestamp: metav1.NewTime(now.Add(-2 * time.Hour)),
			OwnerReferences: []metav1.OwnerReference{{
				Kind:       "ReplicaSet",
				Name:       "demo-rs",
				Controller: &controller,
			}},
		},
		Spec: corev1.PodSpec{
			NodeName:                     "node-1",
			ServiceAccountName:           "builder",
			RuntimeClassName:             strPtr("gvisor"),
			SchedulerName:                "default-scheduler",
			AutomountServiceAccountToken: ptrBool(true),
			Containers: []corev1.Container{{
				Name:  "app",
				Image: "demo:1.0",
				Resources: corev1.ResourceRequirements{
					Requests: corev1.ResourceList{
						corev1.ResourceCPU:    resource.MustParse("250m"),
						corev1.ResourceMemory: resource.MustParse("128Mi"),
					},
					Limits: corev1.ResourceList{
						corev1.ResourceCPU:    resource.MustParse("500m"),
						corev1.ResourceMemory: resource.MustParse("256Mi"),
					},
				},
			}},
		},
		Status: corev1.PodStatus{
			Phase:  corev1.PodRunning,
			PodIP:  "10.0.0.10",
			HostIP: "10.0.0.2",
			ContainerStatuses: []corev1.ContainerStatus{{
				Name:         "app",
				Ready:        true,
				RestartCount: 1,
				State: corev1.ContainerState{
					Running: &corev1.ContainerStateRunning{
						StartedAt: metav1.NewTime(now.Add(-time.Hour)),
					},
				},
			}},
		},
	}

	replicaSet := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "demo-rs",
			Namespace: "team-a",
			OwnerReferences: []metav1.OwnerReference{{
				Kind:       "Deployment",
				Name:       "demo-deploy",
				Controller: &controller,
			}},
		},
	}

	node := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{Name: "node-1"},
		Status: corev1.NodeStatus{
			Addresses: []corev1.NodeAddress{{
				Type:    corev1.NodeInternalIP,
				Address: "192.168.10.15",
			}},
		},
	}

	client := fake.NewClientset(pod, replicaSet, node)

	deps := common.Dependencies{
		Context:          context.Background(),
		Logger:           applog.Noop,
		KubernetesClient: client,
		ClusterID:        "cluster-a",
	}

	details, err := GetPod(deps, "team-a", "demo-pod", true)
	if err != nil {
		t.Fatalf("GetPod returned error: %v", err)
	}
	if details.OwnerKind != "Deployment" || details.OwnerName != "demo-deploy" {
		t.Fatalf("expected pod owner to resolve to Deployment/demo-deploy, got %s/%s", details.OwnerKind, details.OwnerName)
	}
	if details.OwnerAPIVersion != "apps/v1" {
		t.Fatalf("expected OwnerAPIVersion=apps/v1 from ReplicaSet→Deployment collapse, got %q", details.OwnerAPIVersion)
	}
	if details.NodeIP != "192.168.10.15" {
		t.Fatalf("expected node IP to be populated, got %q", details.NodeIP)
	}
	require.Equal(t, "Running", details.Status)
	require.Equal(t, "Running", details.StatusState)
	require.Equal(t, "ready", details.StatusPresentation)
	if len(details.Containers) != 1 {
		t.Fatalf("expected container details to be captured, got %#v", details.Containers)
	}
	if details.Containers[0].State != "running" {
		t.Fatalf("expected container state running, got %q", details.Containers[0].State)
	}
	if details.RuntimeClass != "gvisor" {
		t.Fatalf("expected runtime class to be gvisor, got %q", details.RuntimeClass)
	}
}

func TestSummarizePodUsesMetricsAndOwnership(t *testing.T) {
	now := metav1.NewTime(time.Now().Add(-30 * time.Minute))
	pod := corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "demo",
			Namespace:         "team-a",
			CreationTimestamp: now,
			OwnerReferences: []metav1.OwnerReference{{
				UID:        types.UID("rs-uid"),
				Name:       "demo-rs",
				Kind:       "ReplicaSet",
				Controller: ptrBool(true),
			}},
		},
		Spec: corev1.PodSpec{
			NodeName: "node-1",
			Containers: []corev1.Container{{
				Name:  "app",
				Image: "demo:1.0",
				Resources: corev1.ResourceRequirements{
					Requests: corev1.ResourceList{
						corev1.ResourceCPU:    resource.MustParse("200m"),
						corev1.ResourceMemory: resource.MustParse("128Mi"),
					},
					Limits: corev1.ResourceList{
						corev1.ResourceCPU:    resource.MustParse("400m"),
						corev1.ResourceMemory: resource.MustParse("256Mi"),
					},
				},
			}},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
			ContainerStatuses: []corev1.ContainerStatus{{
				Name:  "app",
				Ready: true,
			}},
		},
	}

	rsToDeployment := map[string]string{"demo-rs": "demo-deploy"}
	cpuUsage := resource.MustParse("150m")
	memUsage := resource.MustParse("64Mi")
	metrics := map[string]*metricsv1beta1.PodMetrics{
		"demo": {
			ObjectMeta: metav1.ObjectMeta{Name: "demo"},
			Containers: []metricsv1beta1.ContainerMetrics{{
				Name: "app",
				Usage: corev1.ResourceList{
					corev1.ResourceCPU:    cpuUsage,
					corev1.ResourceMemory: memUsage,
				},
			}},
		},
	}

	ownerKind, ownerName, ownerAPIVersion := ResolveOwner(pod, rsToDeployment)
	summary := SummarizePod("cluster-a", pod, metrics, ownerKind, ownerName, ownerAPIVersion)
	require.Equal(t, "Deployment", summary.OwnerKind)
	require.Equal(t, "demo-deploy", summary.OwnerName)
	require.Equal(t, "apps/v1", summary.OwnerAPIVersion)
	require.Equal(t, "150m", summary.CPUUsage)
	require.Equal(t, "64Mi", summary.MemUsage)
	require.Equal(t, "1/1", summary.Ready)
	require.Equal(t, "Running", summary.Status)
	require.Equal(t, "Running", summary.StatusState)
	require.Equal(t, "ready", summary.StatusPresentation)
}
