/*
 * backend/kind/logspec/logspec.go
 *
 * The container-log target vocabulary a kind declares in its descriptor: how to
 * find the kind's pods now, and the watch that keeps that set current. It
 * imports only Kubernetes types, so the kind vocabulary (kindspec) and the
 * container-log subsystem (internal/containerlogs) share it without depending
 * on each other.
 */

package logspec

import (
	"context"
	"fmt"
	"strings"

	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/kubernetes"
)

// Target is a kind's container-log target.
type Target struct {
	// SinglePod marks a target that is one pod, watched by name; its previous
	// container logs can be read.
	SinglePod bool
	// Resolve returns the target's pods and the watch that keeps them current.
	// matchPod reports whether the session's selection keeps a pod name, so a
	// single-pod target can skip reading a deselected pod. Each call returns a
	// fresh Watch: its Owns may hold per-session state.
	Resolve func(ctx context.Context, client kubernetes.Interface, namespace, name string,
		matchPod func(name string) bool) (Resolution, error)
}

// Resolution is the pods a target covers now and the watch that keeps them current.
type Resolution struct {
	Pods  []*corev1.Pod
	Watch Watch
}

// Watch is the namespaced pod watch that keeps a target's pods current.
type Watch struct {
	Namespace     string
	LabelSelector string
	FieldSelector string
	// Owns attributes a watched pod the selectors cannot: a single pod by name,
	// or a CronJob's future Jobs. Nil means every selected pod is the target's.
	// An error means ownership could not be looked up.
	Owns func(ctx context.Context, pod *corev1.Pod) (bool, error)
}

// Targets is the container-log target table. Its map is unexported, so every
// read goes through Lookup and its key.
type Targets struct {
	byKey map[schema.GroupVersionKind]Target
}

// key matches group and version exactly (after trimming) and the kind in any
// case: scopes spell the kind as written or lowercased depending on their path.
func key(gvk schema.GroupVersionKind) schema.GroupVersionKind {
	return schema.GroupVersionKind{
		Group:   strings.TrimSpace(gvk.Group),
		Version: strings.TrimSpace(gvk.Version),
		Kind:    strings.ToLower(strings.TrimSpace(gvk.Kind)),
	}
}

// NewTargets builds the table. Two entries that share a key are an error.
func NewTargets(entries map[schema.GroupVersionKind]Target) (Targets, error) {
	byKey := make(map[schema.GroupVersionKind]Target, len(entries))
	for gvk, target := range entries {
		k := key(gvk)
		if _, exists := byKey[k]; exists {
			return Targets{}, fmt.Errorf("container log targets: %s is declared twice", gvk)
		}
		byKey[k] = target
	}
	return Targets{byKey: byKey}, nil
}

// Lookup returns the target for a GVK.
func (t Targets) Lookup(gvk schema.GroupVersionKind) (Target, bool) {
	target, ok := t.byKey[key(gvk)]
	return target, ok
}

// Len is the number of targets; zero means the table was never built.
func (t Targets) Len() int {
	return len(t.byKey)
}
