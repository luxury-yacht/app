package testsupport

import (
	"time"

	appsv1 "k8s.io/api/apps/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	storagev1 "k8s.io/api/storage/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/utils/ptr"
)

const defaultContainerImage = "nginx:latest"

// DeploymentOption mutates a deployment fixture.
type DeploymentOption func(*appsv1.Deployment)

// DeploymentFixture provides a basic deployment with sensible defaults for tests.
func DeploymentFixture(namespace, name string, opts ...DeploymentOption) *appsv1.Deployment {
	labels := map[string]string{"app": name}
	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      name,
			Namespace: namespace,
			Labels:    labels,
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: ptr.To[int32](1),
			Selector: &metav1.LabelSelector{MatchLabels: labels},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: labels},
				Spec: corev1.PodSpec{
					Containers: []corev1.Container{{
						Name:  "app",
						Image: defaultContainerImage,
					}},
				},
			},
			Strategy: appsv1.DeploymentStrategy{Type: appsv1.RollingUpdateDeploymentStrategyType},
		},
		Status: appsv1.DeploymentStatus{
			Replicas:          1,
			ReadyReplicas:     1,
			AvailableReplicas: 1,
			UpdatedReplicas:   1,
		},
	}

	for _, opt := range opts {
		opt(deployment)
	}

	return deployment
}

// DeploymentWithReplicas customises the desired replica count.
func DeploymentWithReplicas(replicas int32) DeploymentOption {
	return func(d *appsv1.Deployment) {
		d.Spec.Replicas = ptr.To[int32](replicas)
	}
}

// StatefulSetOption mutates a statefulset fixture.
type StatefulSetOption func(*appsv1.StatefulSet)

// StatefulSetFixture creates a minimal statefulset with consistent selectors.
func StatefulSetFixture(namespace, name string, opts ...StatefulSetOption) *appsv1.StatefulSet {
	labels := map[string]string{"app": name}
	statefulSet := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:              name,
			Namespace:         namespace,
			UID:               types.UID(name),
			CreationTimestamp: metav1.NewTime(time.Now().Add(-20 * time.Minute)),
			Labels:            labels,
		},
		Spec: appsv1.StatefulSetSpec{
			ServiceName: name + "-svc",
			Replicas:    ptr.To[int32](2),
			Selector:    &metav1.LabelSelector{MatchLabels: labels},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: labels},
				Spec: corev1.PodSpec{
					Containers: []corev1.Container{{
						Name:  "app",
						Image: defaultContainerImage,
					}},
				},
			},
		},
		Status: appsv1.StatefulSetStatus{
			Replicas:          2,
			ReadyReplicas:     2,
			CurrentReplicas:   2,
			UpdatedReplicas:   2,
			AvailableReplicas: 2,
			CurrentRevision:   "1",
			UpdateRevision:    "1",
		},
	}

	for _, opt := range opts {
		opt(statefulSet)
	}
	return statefulSet
}

// DaemonSetOption mutates a daemonset fixture.
type DaemonSetOption func(*appsv1.DaemonSet)

// DaemonSetFixture creates a basic daemonset with labels and status.
func DaemonSetFixture(namespace, name string, opts ...DaemonSetOption) *appsv1.DaemonSet {
	labels := map[string]string{"app": name}
	ds := &appsv1.DaemonSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:              name,
			Namespace:         namespace,
			UID:               types.UID(name),
			CreationTimestamp: metav1.NewTime(time.Now().Add(-15 * time.Minute)),
			Labels:            labels,
		},
		Spec: appsv1.DaemonSetSpec{
			Selector: &metav1.LabelSelector{MatchLabels: labels},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: labels},
				Spec: corev1.PodSpec{
					Containers: []corev1.Container{{
						Name:  "agent",
						Image: defaultContainerImage,
					}},
				},
			},
		},
		Status: appsv1.DaemonSetStatus{
			DesiredNumberScheduled: 2,
			CurrentNumberScheduled: 2,
			NumberReady:            2,
			NumberAvailable:        2,
			UpdatedNumberScheduled: 2,
		},
	}

	for _, opt := range opts {
		opt(ds)
	}
	return ds
}

// JobOption mutates a job fixture.
type JobOption func(*batchv1.Job)

// JobFixture creates a basic batch job with selectors.
func JobFixture(namespace, name string, opts ...JobOption) *batchv1.Job {
	labels := map[string]string{"job": name}
	startTime := metav1.NewTime(time.Now().Add(-5 * time.Minute))
	job := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Name:              name,
			Namespace:         namespace,
			UID:               types.UID(name),
			CreationTimestamp: metav1.NewTime(time.Now().Add(-10 * time.Minute)),
			Labels:            labels,
		},
		Spec: batchv1.JobSpec{
			Selector: &metav1.LabelSelector{MatchLabels: labels},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: labels},
				Spec: corev1.PodSpec{
					Containers: []corev1.Container{{
						Name:  "worker",
						Image: "busybox",
					}},
					RestartPolicy: corev1.RestartPolicyNever,
				},
			},
		},
		Status: batchv1.JobStatus{
			StartTime:      &startTime,
			Active:         1,
			Succeeded:      0,
			Failed:         0,
			Ready:          ptr.To[int32](0),
			Conditions:     []batchv1.JobCondition{},
			CompletionTime: nil,
		},
	}

	for _, opt := range opts {
		opt(job)
	}
	return job
}

// CronJobOption mutates a cronjob fixture.
type CronJobOption func(*batchv1.CronJob)

// CronJobFixture creates a cronjob with a single container template.
func CronJobFixture(namespace, name string, opts ...CronJobOption) *batchv1.CronJob {
	schedule := "*/5 * * * *"
	cronJob := &batchv1.CronJob{
		ObjectMeta: metav1.ObjectMeta{
			Name:              name,
			Namespace:         namespace,
			UID:               types.UID("cron-" + name),
			CreationTimestamp: metav1.NewTime(time.Now().Add(-1 * time.Hour)),
		},
		Spec: batchv1.CronJobSpec{
			Schedule:          schedule,
			ConcurrencyPolicy: batchv1.AllowConcurrent,
			JobTemplate: batchv1.JobTemplateSpec{
				Spec: batchv1.JobSpec{
					Template: corev1.PodTemplateSpec{
						Spec: corev1.PodSpec{
							RestartPolicy: corev1.RestartPolicyOnFailure,
							Containers: []corev1.Container{{
								Name:  "cron",
								Image: "busybox",
							}},
						},
					},
				},
			},
		},
		Status: batchv1.CronJobStatus{},
	}

	for _, opt := range opts {
		opt(cronJob)
	}
	return cronJob
}

// PersistentVolumeOption customises persistent volume fixtures.
type PersistentVolumeOption func(*corev1.PersistentVolume)

// PersistentVolumeFixture creates a hostPath-backed persistent volume.
func PersistentVolumeFixture(name string, opts ...PersistentVolumeOption) *corev1.PersistentVolume {
	pv := &corev1.PersistentVolume{
		ObjectMeta: metav1.ObjectMeta{
			Name:              name,
			CreationTimestamp: metav1.NewTime(time.Now().Add(-30 * time.Minute)),
			Labels:            map[string]string{"storage": "local"},
		},
		Spec: corev1.PersistentVolumeSpec{
			Capacity: corev1.ResourceList{corev1.ResourceStorage: resource.MustParse("10Gi")},
			AccessModes: []corev1.PersistentVolumeAccessMode{
				corev1.ReadWriteOnce,
			},
			PersistentVolumeReclaimPolicy: corev1.PersistentVolumeReclaimRecycle,
			StorageClassName:              "standard",
			PersistentVolumeSource: corev1.PersistentVolumeSource{
				HostPath: &corev1.HostPathVolumeSource{Path: "/data"},
			},
		},
		Status: corev1.PersistentVolumeStatus{Phase: corev1.VolumeBound},
	}

	for _, opt := range opts {
		opt(pv)
	}
	return pv
}

// PersistentVolumeClaimOption customises PVC fixtures.
type PersistentVolumeClaimOption func(*corev1.PersistentVolumeClaim)

// PersistentVolumeClaimFixture creates a PVC bound to a storage class and volume.
func PersistentVolumeClaimFixture(namespace, name string, opts ...PersistentVolumeClaimOption) *corev1.PersistentVolumeClaim {
	pvc := &corev1.PersistentVolumeClaim{
		ObjectMeta: metav1.ObjectMeta{
			Name:              name,
			Namespace:         namespace,
			CreationTimestamp: metav1.NewTime(time.Now().Add(-20 * time.Minute)),
			Labels:            map[string]string{"app": "web"},
		},
		Spec: corev1.PersistentVolumeClaimSpec{
			AccessModes: []corev1.PersistentVolumeAccessMode{corev1.ReadWriteOnce},
			Resources: corev1.VolumeResourceRequirements{
				Requests: corev1.ResourceList{corev1.ResourceStorage: resource.MustParse("5Gi")},
			},
			StorageClassName: ptr.To[string]("standard"),
			VolumeName:       "pv-standard",
		},
		Status: corev1.PersistentVolumeClaimStatus{
			Phase:    corev1.ClaimBound,
			Capacity: corev1.ResourceList{corev1.ResourceStorage: resource.MustParse("5Gi")},
		},
	}

	for _, opt := range opts {
		opt(pvc)
	}
	return pvc
}

// StorageClassOption customises storage class fixtures.
type StorageClassOption func(*storagev1.StorageClass)

// StorageClassFixture creates a storage class with basic defaults.
func StorageClassFixture(name string, opts ...StorageClassOption) *storagev1.StorageClass {
	reclaim := corev1.PersistentVolumeReclaimDelete
	bindingMode := storagev1.VolumeBindingWaitForFirstConsumer
	sc := &storagev1.StorageClass{
		ObjectMeta: metav1.ObjectMeta{
			Name:              name,
			CreationTimestamp: metav1.NewTime(time.Now().Add(-40 * time.Minute)),
			Annotations:       map[string]string{"storageclass.kubernetes.io/is-default-class": "true"},
		},
		Provisioner:          "kubernetes.io/no-provisioner",
		ReclaimPolicy:        &reclaim,
		VolumeBindingMode:    &bindingMode,
		AllowVolumeExpansion: ptr.To(true),
		Parameters:           map[string]string{"type": "local"},
	}

	for _, opt := range opts {
		opt(sc)
	}
	return sc
}

// PodOption mutates a pod fixture.
type PodOption func(*corev1.Pod)

// PodFixture provides a running pod with a single ready container.
func PodFixture(namespace, name string, opts ...PodOption) *corev1.Pod {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:              name,
			Namespace:         namespace,
			CreationTimestamp: metav1.NewTime(time.Now().Add(-10 * time.Minute)),
			Labels:            map[string]string{"app": name},
		},
		Spec: corev1.PodSpec{
			NodeName: "worker-1",
			Containers: []corev1.Container{{
				Name:  "app",
				Image: defaultContainerImage,
				Resources: corev1.ResourceRequirements{
					Requests: corev1.ResourceList{
						corev1.ResourceCPU:    resource.MustParse("100m"),
						corev1.ResourceMemory: resource.MustParse("128Mi"),
					},
					Limits: corev1.ResourceList{
						corev1.ResourceCPU:    resource.MustParse("200m"),
						corev1.ResourceMemory: resource.MustParse("256Mi"),
					},
				},
				Ports: []corev1.ContainerPort{{ContainerPort: 80}},
			}},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
			Conditions: []corev1.PodCondition{{
				Type:   corev1.PodReady,
				Status: corev1.ConditionTrue,
			}},
			ContainerStatuses: []corev1.ContainerStatus{{
				Name:         "app",
				Ready:        true,
				RestartCount: 0,
			}},
		},
	}

	for _, opt := range opts {
		opt(pod)
	}
	return pod
}

// PodWithOwner sets an owner reference using the supplied UID/kind/name.
func PodWithOwner(kind, name string, controller bool) PodOption {
	return func(pod *corev1.Pod) {
		pod.OwnerReferences = []metav1.OwnerReference{{
			APIVersion: "apps/v1",
			Kind:       kind,
			Name:       name,
			UID:        types.UID(name),
			Controller: ptr.To(controller),
		}}
	}
}

// PodWithLabels merges the supplied labels onto the pod.
func PodWithLabels(labels map[string]string) PodOption {
	return func(pod *corev1.Pod) {
		if pod.Labels == nil {
			pod.Labels = map[string]string{}
		}
		for k, v := range labels {
			pod.Labels[k] = v
		}
	}
}
