package containerlogs

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/kind/logspec"
	"github.com/luxury-yacht/app/backend/refresh"
	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/fields"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/kubernetes"
)

// jobNameLabel is set by the Job controller on every pod it creates.
const jobNameLabel = "job-name"

var errNoLogTargets = errors.New("container log targets are not configured")

// ParseTargetScope parses a container logs scope into the complete identity of
// the pod or workload whose logs are read, rejecting objects no log target
// covers. The targets are the kind registry's (kindregistry.LogTargets), passed
// in because this leaf cannot import the registry, whose kind packages use it.
func ParseTargetScope(scope string, targets logspec.Targets) (refresh.ObjectScopeIdentity, error) {
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
	if _, err := lookupTarget(identity.GVK, targets); err != nil {
		return refresh.ObjectScopeIdentity{}, err
	}
	identity.Name = strings.TrimSpace(identity.Name)
	if identity.Name == "" {
		return refresh.ObjectScopeIdentity{}, fmt.Errorf("object name missing in scope %q", scope)
	}
	return identity, nil
}

func lookupTarget(gvk schema.GroupVersionKind, targets logspec.Targets) (logspec.Target, error) {
	if targets.Len() == 0 {
		return logspec.Target{}, errNoLogTargets
	}
	target, ok := targets.Lookup(gvk)
	if !ok {
		return logspec.Target{}, fmt.Errorf("container logs are not supported for %s", gvk.String())
	}
	return target, nil
}

// Resolution is the set of pods a log target covers now and the watch that
// keeps that set current.
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
	owns          func(ctx context.Context, pod *corev1.Pod) (bool, error)
}

// Owns reports whether a watched pod belongs to the target. An error means
// ownership could not be looked up; the pod is reported as not owned.
func (w *PodWatch) Owns(ctx context.Context, pod *corev1.Pod) (bool, error) {
	if w == nil || w.owns == nil {
		return true, nil
	}
	return w.owns(ctx, pod)
}

// Resolve lists the target's current pods that the selection allows, through
// the kind's log target.
func Resolve(
	ctx context.Context,
	client kubernetes.Interface,
	targets logspec.Targets,
	target refresh.ObjectScopeIdentity,
	selection ScopeSelection,
) (Resolution, error) {
	logTarget, err := lookupTarget(target.GVK, targets)
	if err != nil {
		return Resolution{}, err
	}
	resolved, err := logTarget.Resolve(ctx, client, target.Namespace, target.Name, selection.MatchPod)
	if err != nil {
		return Resolution{}, err
	}
	watch := resolved.Watch
	return Resolution{
		Pods: filterPodsBySelection(resolved.Pods, selection),
		Watch: &PodWatch{
			Namespace:     watch.Namespace,
			LabelSelector: watch.LabelSelector,
			FieldSelector: watch.FieldSelector,
			owns:          watch.Owns,
		},
	}, nil
}

// ResolvePod reads one pod with a plain GET, so users who may read pods but not
// list or watch them keep its logs, and watches it by name, so a pod recreated
// under the same name, or given a debug container, is followed. A pod the
// selection excludes is not read.
func ResolvePod(
	ctx context.Context,
	client kubernetes.Interface,
	namespace, name string,
	matchPod func(name string) bool,
) (logspec.Resolution, error) {
	watch := logspec.Watch{
		Namespace:     namespace,
		FieldSelector: fields.OneTermEqualSelector("metadata.name", name).String(),
		// Also enforced here in case the server does not apply the field selector.
		Owns: func(_ context.Context, pod *corev1.Pod) (bool, error) { return pod.Name == name, nil },
	}
	if !matchPod(name) {
		return logspec.Resolution{Watch: watch}, nil
	}
	pod, err := client.CoreV1().Pods(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return logspec.Resolution{}, fmt.Errorf("get pod %s/%s: %w", namespace, name, err)
	}
	return logspec.Resolution{Pods: []*corev1.Pod{pod}, Watch: watch}, nil
}

// ResolveWorkload lists the pods a workload's spec selector matches, read by
// getSelector, and watches the same selector.
func ResolveWorkload(
	ctx context.Context,
	client kubernetes.Interface,
	namespace, name, kind string,
	getSelector func(ctx context.Context) (*metav1.LabelSelector, error),
) (logspec.Resolution, error) {
	selector, err := getSelector(ctx)
	if err != nil {
		return logspec.Resolution{}, fmt.Errorf("get %s %s/%s: %w", kind, namespace, name, err)
	}
	return ResolveBySelector(ctx, client, namespace, metav1.FormatLabelSelector(selector))
}

// JobPodsSelector selects the pods the Job controller created for a Job.
func JobPodsSelector(jobName string) string {
	return labels.Set{jobNameLabel: jobName}.AsSelector().String()
}

// ResolveBySelector lists the namespace's pods a label selector matches and
// watches the same selector.
func ResolveBySelector(
	ctx context.Context,
	client kubernetes.Interface,
	namespace, selector string,
) (logspec.Resolution, error) {
	pods, err := listPods(ctx, client, namespace, selector)
	if err != nil {
		return logspec.Resolution{}, err
	}
	return logspec.Resolution{Pods: pods, Watch: logspec.Watch{Namespace: namespace, LabelSelector: selector}}, nil
}

// ResolveCronJob lists the pods of the Jobs a CronJob owns. Future Jobs get new
// names, so the watch selects every Job pod in the namespace and attributes each
// pod through its Job's owner.
func ResolveCronJob(
	ctx context.Context,
	client kubernetes.Interface,
	namespace, name string,
) (logspec.Resolution, error) {
	jobs, err := client.BatchV1().Jobs(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return logspec.Resolution{}, fmt.Errorf("list jobs for cronjob %s/%s: %w", namespace, name, err)
	}
	ownership := &cronJobOwnership{client: client, namespace: namespace, cronJob: name, known: map[string]bool{}}
	watch := logspec.Watch{Namespace: namespace, LabelSelector: jobNameLabel, Owns: ownership.owns}
	var jobNames []string
	for _, job := range jobs.Items {
		if ownedByCronJob(job.OwnerReferences, name) {
			jobNames = append(jobNames, job.Name)
		}
	}
	if len(jobNames) == 0 {
		return logspec.Resolution{Watch: watch}, nil
	}
	pods, err := listPods(ctx, client, namespace, jobNameLabel+" in ("+strings.Join(jobNames, ",")+")")
	if err != nil {
		return logspec.Resolution{}, err
	}
	return logspec.Resolution{Pods: pods, Watch: watch}, nil
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
