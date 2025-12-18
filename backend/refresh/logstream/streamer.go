package logstream

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"sort"
	"strings"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/apimachinery/pkg/watch"
	"k8s.io/client-go/kubernetes"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

// Streamer manages Kubernetes log streaming sessions.
type Streamer struct {
	client    kubernetes.Interface
	logger    Logger
	telemetry *telemetry.Recorder
}

// NewStreamer constructs a Streamer.
func NewStreamer(client kubernetes.Interface, logger Logger, recorder *telemetry.Recorder) *Streamer {
	if logger == nil {
		logger = noopLogger{}
	}
	return &Streamer{client: client, logger: logger, telemetry: recorder}
}

type containerTarget struct {
	namespace string
	pod       string
	container string
	isInit    bool
	state     *containerState
}

func (t containerTarget) key() string {
	return fmt.Sprintf("%s/%s/%s", t.namespace, t.pod, t.container)
}

// tail gathers the initial log history for the given options and prepares container state.
func (s *Streamer) tail(ctx context.Context, opts Options) ([]Entry, map[string]*containerState, []*corev1.Pod, string, error) {
	pods, selector, err := s.listPods(ctx, opts)
	if err != nil {
		return nil, nil, nil, "", err
	}

	var entries []Entry
	state := make(map[string]*containerState)

	for _, pod := range pods {
		targets := buildTargetsFromPod(pod, opts.Container)
		for _, target := range targets {
			if _, ok := state[target.key()]; !ok {
				state[target.key()] = &containerState{}
			}
			podEntries, err := s.fetchContainerTail(ctx, target, opts.TailLines)
			if err != nil {
				s.logger.Warn(fmt.Sprintf("logstream: tail failed for %s/%s/%s: %v", target.namespace, target.pod, target.container, err), "LogStream")
				continue
			}
			for _, e := range podEntries {
				entries = append(entries, e)
				if e.Timestamp == "" {
					continue
				}
				ts, err := time.Parse(time.RFC3339Nano, e.Timestamp)
				if err != nil {
					continue
				}
				key := target.key()
				current := state[key]
				if current == nil {
					current = &containerState{}
					state[key] = current
				}
				if ts.After(current.lastTimestamp) || current.lastTimestamp.IsZero() {
					current.lastTimestamp = ts
					current.lastLine = e.Line
				}
			}
		}
	}

	sort.Slice(entries, func(i, j int) bool {
		ti, errI := time.Parse(time.RFC3339Nano, entries[i].Timestamp)
		tj, errJ := time.Parse(time.RFC3339Nano, entries[j].Timestamp)
		switch {
		case errI != nil && errJ != nil:
			return i < j
		case errI != nil:
			return false
		case errJ != nil:
			return true
		default:
			return ti.Before(tj)
		}
	})

	return entries, state, pods, selector, nil
}

func (s *Streamer) run(
	ctx context.Context,
	opts Options,
	initialPods []*corev1.Pod,
	selector string,
	states map[string]*containerState,
	entriesCh chan<- Entry,
	errCh chan<- error,
	dropCh chan<- int,
) {
	var (
		mu         sync.Mutex
		podCancels = make(map[string]context.CancelFunc)
	)

	startPod := func(pod *corev1.Pod) {
		targets := buildTargetsFromPod(pod, opts.Container)
		if len(targets) == 0 {
			return
		}
		mu.Lock()
		if _, exists := podCancels[pod.Name]; exists {
			mu.Unlock()
			return
		}
		podCtx, cancel := context.WithCancel(ctx)
		podCancels[pod.Name] = cancel
		mu.Unlock()

		for _, target := range targets {
			target.state = states[target.key()]
			if target.state == nil {
				target.state = &containerState{}
				states[target.key()] = target.state
			}
			go func(t containerTarget) {
				defer func() {
					if r := recover(); r != nil {
						s.logger.Error(fmt.Sprintf("logstream: panic in followContainer for %s: %v", t.key(), r), "LogStream")
						if s.telemetry != nil {
							s.telemetry.RecordStreamError(telemetry.StreamLogs, fmt.Errorf("panic: %v", r))
						}
					}
				}()
				s.followContainer(podCtx, t, entriesCh, errCh, dropCh)
			}(target)
		}
	}

	stopPod := func(name string) {
		mu.Lock()
		if cancel, ok := podCancels[name]; ok {
			cancel()
			delete(podCancels, name)
		}
		mu.Unlock()
	}

	for _, pod := range initialPods {
		startPod(pod)
	}

	if strings.ToLower(opts.Kind) == "pod" {
		<-ctx.Done()
		mu.Lock()
		for _, cancel := range podCancels {
			cancel()
		}
		mu.Unlock()
		return
	}

	cronCache := make(map[string]bool)
	backoff := config.LogStreamBackoffInitial

	for {
		select {
		case <-ctx.Done():
			mu.Lock()
			for _, cancel := range podCancels {
				cancel()
			}
			mu.Unlock()
			return
		default:
		}

		watcher, err := s.client.CoreV1().Pods(opts.Namespace).Watch(ctx, metav1.ListOptions{
			LabelSelector: selector,
		})
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			s.logger.Warn(fmt.Sprintf("logstream: failed to start pod watch: %v", err), "LogStream")
			select {
			case errCh <- err:
			default:
			}
			if !s.waitForReconnect(ctx, backoff) {
				return
			}
			backoff = nextBackoff(backoff)
			continue
		}

		err = s.consumeWatch(ctx, watcher, opts, cronCache, startPod, stopPod)
		watcher.Stop()
		if err == nil || ctx.Err() != nil {
			mu.Lock()
			for _, cancel := range podCancels {
				cancel()
			}
			mu.Unlock()
			return
		}

		s.logger.Warn(fmt.Sprintf("logstream: pod watch ended (will retry): %v", err), "LogStream")
		if s.telemetry != nil {
			s.telemetry.RecordStreamError(telemetry.StreamLogs, err)
		}
		if !s.waitForReconnect(ctx, backoff) {
			mu.Lock()
			for _, cancel := range podCancels {
				cancel()
			}
			mu.Unlock()
			return
		}
		backoff = nextBackoff(backoff)

		// Refresh pod list to ensure any missed pods are started.
		if pods, _, listErr := s.listPods(ctx, opts); listErr == nil {
			for _, pod := range pods {
				startPod(pod)
			}
		}
	}
}

func (s *Streamer) waitForReconnect(ctx context.Context, delay time.Duration) bool {
	if delay <= 0 {
		delay = config.LogStreamBackoffInitial
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func nextBackoff(current time.Duration) time.Duration {
	if current <= 0 {
		return config.LogStreamBackoffInitial
	}
	next := current * 2
	if next > config.LogStreamBackoffMax {
		return config.LogStreamBackoffMax
	}
	return next
}

func (s *Streamer) consumeWatch(
	ctx context.Context,
	watcher watch.Interface,
	opts Options,
	cronCache map[string]bool,
	startPod func(*corev1.Pod),
	stopPod func(string),
) error {
	if watcher == nil {
		return errors.New("logstream: watcher not initialised")
	}
	result := watcher.ResultChan()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case event, ok := <-result:
			if !ok {
				return errors.New("watch channel closed")
			}
			pod, ok := event.Object.(*corev1.Pod)
			if !ok {
				continue
			}
			if strings.ToLower(opts.Kind) == "cronjob" {
				if !s.podBelongsToCronJob(ctx, opts.Namespace, opts.Name, pod, cronCache) {
					continue
				}
			}
			switch event.Type {
			case watch.Added, watch.Modified:
				startPod(pod)
			case watch.Deleted:
				stopPod(pod.Name)
			}
		}
	}
}

func (s *Streamer) followContainer(ctx context.Context, target containerTarget, entriesCh chan<- Entry, errCh chan<- error, dropCh chan<- int) {
	backoff := config.LogStreamBackoffInitial
	if target.state == nil {
		target.state = &containerState{}
	}
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		options := &corev1.PodLogOptions{
			Container:  target.container,
			Follow:     true,
			Timestamps: true,
		}
		if !target.state.lastTimestamp.IsZero() {
			t := metav1.NewTime(target.state.lastTimestamp)
			options.SinceTime = &t
		}

		req := s.client.CoreV1().Pods(target.namespace).GetLogs(target.pod, options)
		stream, err := req.Stream(ctx)
		if err != nil {
			if !errors.Is(err, context.Canceled) {
				msg := fmt.Sprintf("logstream: follow failed for %s/%s/%s: %v", target.namespace, target.pod, target.container, err)
				s.logger.Warn(msg, "LogStream")
				streamErr := fmt.Errorf("logstream: follow failed for %s/%s/%s: %w", target.namespace, target.pod, target.container, err)
				select {
				case errCh <- streamErr:
				default:
				}
				select {
				case <-time.After(backoff):
				case <-ctx.Done():
					return
				}
			}
			if !s.shouldContinueStreaming(ctx, target) {
				return
			}
			continue
		}

		scanner := bufio.NewScanner(stream)
		for scanner.Scan() {
			select {
			case <-ctx.Done():
				_ = stream.Close()
				return
			default:
			}
			line := scanner.Text()
			timestamp, content := splitTimestamp(line)
			entry := Entry{
				Timestamp: timestamp,
				Pod:       target.pod,
				Container: target.container,
				Line:      content,
				IsInit:    target.isInit,
			}

			if timestamp != "" {
				ts, err := time.Parse(time.RFC3339Nano, timestamp)
				if err == nil {
					if !target.state.lastTimestamp.IsZero() && (ts.Before(target.state.lastTimestamp) || ts.Equal(target.state.lastTimestamp)) {
						if target.state.lastLine == entry.Line {
							continue
						}
					}
					target.state.lastTimestamp = ts
				}
			}
			target.state.lastLine = entry.Line

			select {
			case entriesCh <- entry:
			case <-ctx.Done():
				_ = stream.Close()
				return
			default:
				if dropCh != nil {
					select {
					case dropCh <- 1:
					default:
						if s.telemetry != nil {
							s.telemetry.RecordStreamDelivery(telemetry.StreamLogs, 0, 1)
						}
					}
				} else if s.telemetry != nil {
					s.telemetry.RecordStreamDelivery(telemetry.StreamLogs, 0, 1)
				}
				continue
			}
		}

		err = stream.Close()
		if scannerErr := scanner.Err(); scannerErr != nil && !errors.Is(scannerErr, context.Canceled) && !errors.Is(scannerErr, io.EOF) {
			s.logger.Debug(fmt.Sprintf("logstream: scanner error for %s/%s/%s: %v", target.namespace, target.pod, target.container, scannerErr), "LogStream")
		}
		if err != nil && !errors.Is(err, context.Canceled) && !errors.Is(err, io.EOF) {
			s.logger.Debug(fmt.Sprintf("logstream: stream closed with error for %s/%s/%s: %v", target.namespace, target.pod, target.container, err), "LogStream")
		}

		if !s.shouldContinueStreaming(ctx, target) {
			return
		}

		select {
		case <-time.After(backoff):
		case <-ctx.Done():
			return
		}
	}
}

func (s *Streamer) shouldContinueStreaming(ctx context.Context, target containerTarget) bool {
	if target.isInit {
		return false
	}
	if ctx == nil {
		return true
	}
	select {
	case <-ctx.Done():
		return false
	default:
	}

	pod, err := s.client.CoreV1().Pods(target.namespace).Get(ctx, target.pod, metav1.GetOptions{})
	if err != nil {
		// Stop retrying if the pod is gone; otherwise assume the container may come back.
		return !apierrors.IsNotFound(err)
	}

	if pod.DeletionTimestamp != nil {
		return false
	}

	switch pod.Status.Phase {
	case corev1.PodFailed, corev1.PodSucceeded:
		return false
	default:
		return true
	}
}

func (s *Streamer) listPods(ctx context.Context, opts Options) ([]*corev1.Pod, string, error) {
	kind := strings.ToLower(opts.Kind)
	switch kind {
	case "pod":
		pod, err := s.client.CoreV1().Pods(opts.Namespace).Get(ctx, opts.Name, metav1.GetOptions{})
		if err != nil {
			return nil, "", err
		}
		return []*corev1.Pod{pod}, "", nil
	case "deployment", "replicaset", "statefulset", "daemonset":
		selector, err := s.selectorForWorkload(ctx, opts)
		if err != nil {
			return nil, "", err
		}
		pods, err := s.client.CoreV1().Pods(opts.Namespace).List(ctx, metav1.ListOptions{LabelSelector: selector})
		if err != nil {
			return nil, "", err
		}
		return podPointers(pods.Items), selector, nil
	case "job":
		selector := labels.Set{"job-name": opts.Name}.AsSelector().String()
		pods, err := s.client.CoreV1().Pods(opts.Namespace).List(ctx, metav1.ListOptions{LabelSelector: selector})
		if err != nil {
			return nil, "", err
		}
		return podPointers(pods.Items), selector, nil
	case "cronjob":
		jobs, err := s.client.BatchV1().Jobs(opts.Namespace).List(ctx, metav1.ListOptions{})
		if err != nil {
			return nil, "", err
		}
		var jobNames []string
		for _, job := range jobs.Items {
			for _, owner := range job.OwnerReferences {
				if owner.Kind == "CronJob" && owner.Name == opts.Name {
					jobNames = append(jobNames, job.Name)
				}
			}
		}
		var pods []*corev1.Pod
		for _, jobName := range jobNames {
			selector := labels.Set{"job-name": jobName}.AsSelector().String()
			list, err := s.client.CoreV1().Pods(opts.Namespace).List(ctx, metav1.ListOptions{LabelSelector: selector})
			if err != nil {
				s.logger.Warn(fmt.Sprintf("logstream: failed to list pods for job %s: %v", jobName, err), "LogStream")
				continue
			}
			pods = append(pods, podPointers(list.Items)...)
		}
		return pods, labels.Set{"cronjob": opts.Name}.AsSelector().String(), nil
	default:
		return nil, "", fmt.Errorf("logstream: unsupported workload kind %q", opts.Kind)
	}
}

func (s *Streamer) selectorForWorkload(ctx context.Context, opts Options) (string, error) {
	switch strings.ToLower(opts.Kind) {
	case "deployment":
		res, err := s.client.AppsV1().Deployments(opts.Namespace).Get(ctx, opts.Name, metav1.GetOptions{})
		if err != nil {
			return "", err
		}
		return metav1.FormatLabelSelector(res.Spec.Selector), nil
	case "replicaset":
		res, err := s.client.AppsV1().ReplicaSets(opts.Namespace).Get(ctx, opts.Name, metav1.GetOptions{})
		if err != nil {
			return "", err
		}
		return metav1.FormatLabelSelector(res.Spec.Selector), nil
	case "daemonset":
		res, err := s.client.AppsV1().DaemonSets(opts.Namespace).Get(ctx, opts.Name, metav1.GetOptions{})
		if err != nil {
			return "", err
		}
		return metav1.FormatLabelSelector(res.Spec.Selector), nil
	case "statefulset":
		res, err := s.client.AppsV1().StatefulSets(opts.Namespace).Get(ctx, opts.Name, metav1.GetOptions{})
		if err != nil {
			return "", err
		}
		return metav1.FormatLabelSelector(res.Spec.Selector), nil
	default:
		return "", fmt.Errorf("logstream: unsupported selector kind %q", opts.Kind)
	}
}

func podPointers(items []corev1.Pod) []*corev1.Pod {
	result := make([]*corev1.Pod, 0, len(items))
	for i := range items {
		pod := items[i]
		result = append(result, &pod)
	}
	return result
}

func buildTargetsFromPod(pod *corev1.Pod, filter string) []containerTarget {
	var targets []containerTarget
	filter = strings.TrimSpace(filter)

	isAll := filter == "" || strings.EqualFold(filter, "all")
	for _, c := range pod.Spec.InitContainers {
		name := c.Name
		if !isAll && !matchContainerFilter(name, filter, true) {
			continue
		}
		targets = append(targets, containerTarget{namespace: pod.Namespace, pod: pod.Name, container: name, isInit: true, state: &containerState{}})
	}
	for _, c := range pod.Spec.Containers {
		name := c.Name
		if !isAll && !matchContainerFilter(name, filter, false) {
			continue
		}
		targets = append(targets, containerTarget{namespace: pod.Namespace, pod: pod.Name, container: name, isInit: false, state: &containerState{}})
	}
	return targets
}

func matchContainerFilter(name, filter string, isInit bool) bool {
	if filter == "" {
		return true
	}
	if isInit {
		if filter == name || filter == fmt.Sprintf("%s (init)", name) {
			return true
		}
		return false
	}
	return filter == name
}

func (s *Streamer) fetchContainerTail(ctx context.Context, target containerTarget, tailLines int) ([]Entry, error) {
	options := &corev1.PodLogOptions{
		Container:  target.container,
		Timestamps: true,
	}
	if tailLines > 0 {
		tail := int64(tailLines)
		options.TailLines = &tail
	}

	req := s.client.CoreV1().Pods(target.namespace).GetLogs(target.pod, options)
	stream, err := req.Stream(ctx)
	if err != nil {
		return nil, err
	}
	defer stream.Close()

	var entries []Entry
	scanner := bufio.NewScanner(stream)
	for scanner.Scan() {
		line := scanner.Text()
		timestamp, content := splitTimestamp(line)
		entries = append(entries, Entry{
			Timestamp: timestamp,
			Pod:       target.pod,
			Container: target.container,
			Line:      content,
			IsInit:    target.isInit,
		})
	}
	if err := scanner.Err(); err != nil && !errors.Is(err, io.EOF) {
		return entries, err
	}
	return entries, nil
}

func splitTimestamp(line string) (string, string) {
	idx := strings.IndexByte(line, ' ')
	if idx > 0 && idx < 32 {
		return line[:idx], line[idx+1:]
	}
	return "", line
}

// maxCronCacheSize limits the cron job ownership cache to prevent unbounded growth.
const maxCronCacheSize = 1000

func (s *Streamer) podBelongsToCronJob(ctx context.Context, namespace, cronJob string, pod *corev1.Pod, cache map[string]bool) bool {
	if pod == nil {
		return false
	}
	jobName := pod.Labels["job-name"]
	if jobName == "" {
		for _, owner := range pod.OwnerReferences {
			if owner.Kind == "Job" {
				jobName = owner.Name
				break
			}
		}
	}
	if jobName == "" {
		return false
	}
	cacheKey := fmt.Sprintf("%s/%s", jobName, cronJob)
	if allowed, ok := cache[cacheKey]; ok {
		return allowed
	}

	// Evict cache if it exceeds size limit to prevent unbounded growth
	if len(cache) >= maxCronCacheSize {
		for k := range cache {
			delete(cache, k)
		}
		s.logger.Debug("logstream: cron cache evicted due to size limit", "LogStream")
	}

	job, err := s.client.BatchV1().Jobs(namespace).Get(ctx, jobName, metav1.GetOptions{})
	if err != nil {
		s.logger.Debug(fmt.Sprintf("logstream: failed to fetch job %s: %v", jobName, err), "LogStream")
		cache[cacheKey] = false
		return false
	}
	for _, owner := range job.OwnerReferences {
		if owner.Kind == "CronJob" && owner.Name == cronJob {
			cache[cacheKey] = true
			return true
		}
	}
	cache[cacheKey] = false
	return false
}
