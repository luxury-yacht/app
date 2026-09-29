package containerlogs

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/fields"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/client-go/kubernetes"
	appsv1client "k8s.io/client-go/kubernetes/typed/apps/v1"
)

// jobNameLabel is set by the Job controller on every pod it creates.
const jobNameLabel = "job-name"

// ParseTargetScope parses a container logs scope into the complete identity of
// the pod or workload whose logs are read, rejecting objects logs cannot target.
func ParseTargetScope(scope string) (refresh.ObjectScopeIdentity, error) {
	if strings.TrimSpace(scope) == "" {
		return refresh.ObjectScopeIdentity{}, errors.New("container logs scope is required")
	}
	identity, err := refresh.ParseObjectScope(scope)
	if err != nil {
		return refresh.ObjectScopeIdentity{}, err
	}
	if identity.Namespace == "" {
		return refresh.ObjectScopeIdentity{}, errors.New("log scope must reference a namespaced object")
	}
	if err := ValidateTargetGVK(identity.GVK); err != nil {
		return refresh.ObjectScopeIdentity{}, err
	}
	identity.Name = strings.TrimSpace(identity.Name)
	if identity.Name == "" {
		return refresh.ObjectScopeIdentity{}, fmt.Errorf("object name missing in scope %q", scope)
	}
	return identity, nil
}

// Resolution is the set of pods a log target covers now and the watch that
// keeps that set current. A single pod is watched by name, so a pod recreated
// under the same name, or given a debug container, is followed.
type Resolution struct {
	Pods  []*corev1.Pod
	Watch *PodWatch
}

// PodWatch describes the namespaced pod watch that keeps a target's pods
// current. Pods the selectors cannot attribute to the target (a CronJob's
// future Jobs) are checked through Owns.
type PodWatch struct {
	Namespace     string
	LabelSelector string
	FieldSelector string
	podName       string
	cronJob       *cronJobOwnership
}

// Owns reports whether a watched pod belongs to the target. An error means
// ownership could not be looked up; the pod is reported as not owned.
func (w *PodWatch) Owns(ctx context.Context, pod *corev1.Pod) (bool, error) {
	if w == nil {
		return true, nil
	}
	if w.podName != "" {
		// Also enforced here in case the server does not apply the field selector.
		return pod.Name == w.podName, nil
	}
	if w.cronJob == nil {
		return true, nil
	}
	return w.cronJob.owns(ctx, pod)
}

// Resolve lists the target's current pods that the selection allows.
func Resolve(
	ctx context.Context,
	client kubernetes.Interface,
	target refresh.ObjectScopeIdentity,
	selection ScopeSelection,
) (Resolution, error) {
	switch strings.ToLower(strings.TrimSpace(target.GVK.Kind)) {
	case "pod":
		return resolvePod(ctx, client, target, selection)
	case "deployment", "replicaset", "daemonset", "statefulset":
		selector, err := workloadSelector(ctx, client, target)
		if err != nil {
			return Resolution{}, err
		}
		return resolveBySelector(ctx, client, target.Namespace, selector, selection)
	case "job":
		selector := labels.Set{jobNameLabel: target.Name}.AsSelector().String()
		return resolveBySelector(ctx, client, target.Namespace, selector, selection)
	case "cronjob":
		return resolveCronJob(ctx, client, target, selection)
	default:
		return Resolution{}, fmt.Errorf("unsupported workload type: %s", target.GVK.Kind)
	}
}

func resolvePod(
	ctx context.Context,
	client kubernetes.Interface,
	target refresh.ObjectScopeIdentity,
	selection ScopeSelection,
) (Resolution, error) {
	watch := &PodWatch{
		Namespace:     target.Namespace,
		FieldSelector: fields.OneTermEqualSelector("metadata.name", target.Name).String(),
		podName:       target.Name,
	}
	if !selection.MatchPod(target.Name) {
		return Resolution{Watch: watch}, nil
	}
	pod, err := client.CoreV1().Pods(target.Namespace).Get(ctx, target.Name, metav1.GetOptions{})
	if err != nil {
		return Resolution{}, fmt.Errorf("get pod %s/%s: %w", target.Namespace, target.Name, err)
	}
	return Resolution{Pods: []*corev1.Pod{pod}, Watch: watch}, nil
}

func workloadSelector(ctx context.Context, client kubernetes.Interface, target refresh.ObjectScopeIdentity) (string, error) {
	selector, err := getWorkloadSelector(ctx, client.AppsV1(), target)
	if err != nil {
		return "", fmt.Errorf("get %s %s/%s: %w", strings.ToLower(target.GVK.Kind), target.Namespace, target.Name, err)
	}
	return metav1.FormatLabelSelector(selector), nil
}

func getWorkloadSelector(ctx context.Context, apps appsv1client.AppsV1Interface, target refresh.ObjectScopeIdentity) (*metav1.LabelSelector, error) {
	options := metav1.GetOptions{}
	switch strings.ToLower(target.GVK.Kind) {
	case "deployment":
		object, err := apps.Deployments(target.Namespace).Get(ctx, target.Name, options)
		if err != nil {
			return nil, err
		}
		return object.Spec.Selector, nil
	case "replicaset":
		object, err := apps.ReplicaSets(target.Namespace).Get(ctx, target.Name, options)
		if err != nil {
			return nil, err
		}
		return object.Spec.Selector, nil
	case "daemonset":
		object, err := apps.DaemonSets(target.Namespace).Get(ctx, target.Name, options)
		if err != nil {
			return nil, err
		}
		return object.Spec.Selector, nil
	case "statefulset":
		object, err := apps.StatefulSets(target.Namespace).Get(ctx, target.Name, options)
		if err != nil {
			return nil, err
		}
		return object.Spec.Selector, nil
	default:
		return nil, fmt.Errorf("unsupported workload type: %s", target.GVK.Kind)
	}
}

func resolveBySelector(
	ctx context.Context,
	client kubernetes.Interface,
	namespace, selector string,
	selection ScopeSelection,
) (Resolution, error) {
	pods, err := listPods(ctx, client, namespace, selector)
	if err != nil {
		return Resolution{}, err
	}
	return Resolution{
		Pods:  filterPodsBySelection(pods, selection),
		Watch: &PodWatch{Namespace: namespace, LabelSelector: selector},
	}, nil
}

func resolveCronJob(
	ctx context.Context,
	client kubernetes.Interface,
	target refresh.ObjectScopeIdentity,
	selection ScopeSelection,
) (Resolution, error) {
	jobs, err := client.BatchV1().Jobs(target.Namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return Resolution{}, fmt.Errorf("list jobs for cronjob %s/%s: %w", target.Namespace, target.Name, err)
	}
	// Future Jobs get new names, so the watch selects every Job pod in the
	// namespace and each pod is attributed through its Job's owner.
	watch := &PodWatch{
		Namespace:     target.Namespace,
		LabelSelector: jobNameLabel,
		cronJob:       &cronJobOwnership{client: client, namespace: target.Namespace, cronJob: target.Name, known: map[string]bool{}},
	}
	var jobNames []string
	for _, job := range jobs.Items {
		if ownedByCronJob(job.OwnerReferences, target.Name) {
			jobNames = append(jobNames, job.Name)
		}
	}
	if len(jobNames) == 0 {
		return Resolution{Watch: watch}, nil
	}
	pods, err := listPods(ctx, client, target.Namespace, jobNameLabel+" in ("+strings.Join(jobNames, ",")+")")
	if err != nil {
		return Resolution{}, err
	}
	return Resolution{Pods: filterPodsBySelection(pods, selection), Watch: watch}, nil
}

func listPods(ctx context.Context, client kubernetes.Interface, namespace, selector string) ([]*corev1.Pod, error) {
	list, err := client.CoreV1().Pods(namespace).List(ctx, metav1.ListOptions{LabelSelector: selector})
	if err != nil {
		return nil, fmt.Errorf("list pods in %s with selector %q: %w", namespace, selector, err)
	}
	pods := make([]*corev1.Pod, 0, len(list.Items))
	for i := range list.Items {
		pods = append(pods, &list.Items[i])
	}
	return pods, nil
}

func filterPodsBySelection(pods []*corev1.Pod, selection ScopeSelection) []*corev1.Pod {
	if selection.IsZero() {
		return pods
	}
	filtered := make([]*corev1.Pod, 0, len(pods))
	for _, pod := range pods {
		if pod != nil && selection.MatchPod(pod.Name) {
			filtered = append(filtered, pod)
		}
	}
	return filtered
}

// cronJobOwnership caches which Jobs belong to one CronJob. It is used from a
// session's run loop only and is not safe for concurrent use.
type cronJobOwnership struct {
	client    kubernetes.Interface
	namespace string
	cronJob   string
	known     map[string]bool
}

func (o *cronJobOwnership) owns(ctx context.Context, pod *corev1.Pod) (bool, error) {
	jobName := podJobName(pod)
	if jobName == "" {
		return false, nil
	}
	if owned, ok := o.known[jobName]; ok {
		return owned, nil
	}
	if len(o.known) >= config.ContainerLogsStreamCronCacheMaxSize {
		clear(o.known)
	}
	job, err := o.client.BatchV1().Jobs(o.namespace).Get(ctx, jobName, metav1.GetOptions{})
	if apierrors.IsNotFound(err) {
		o.known[jobName] = false
		return false, nil
	}
	if err != nil {
		// A transient failure is not remembered, so the pod's next update retries.
		return false, fmt.Errorf("get job %s/%s: %w", o.namespace, jobName, err)
	}
	owned := ownedByCronJob(job.OwnerReferences, o.cronJob)
	o.known[jobName] = owned
	return owned, nil
}

func podJobName(pod *corev1.Pod) string {
	if pod == nil {
		return ""
	}
	if jobName := pod.Labels[jobNameLabel]; jobName != "" {
		return jobName
	}
	for _, owner := range pod.OwnerReferences {
		if owner.Kind == "Job" {
			return owner.Name
		}
	}
	return ""
}

func ownedByCronJob(owners []metav1.OwnerReference, cronJob string) bool {
	for _, owner := range owners {
		if owner.Kind == "CronJob" && owner.Name == cronJob {
			return true
		}
	}
	return false
}
