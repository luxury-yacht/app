package generic

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/backend/resources/common"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/dynamic"
)

type finalizerPatchOperation struct {
	Operation string `json:"op"`
	Path      string `json:"path"`
	Value     any    `json:"value"`
}

// RemoveMetadataFinalizerByGVK removes one named metadata finalizer from a
// deleting object. The JSON Patch test prevents a concurrent finalizer update
// from being overwritten by a stale read.
func (s *Service) RemoveMetadataFinalizerByGVK(
	ctx context.Context,
	gvk schema.GroupVersionKind,
	namespace string,
	name string,
	finalizer string,
) error {
	resource, gvr, namespaced, err := s.finalizerResource(ctx, gvk, namespace)
	if err != nil {
		return err
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("name is required")
	}
	finalizer = strings.TrimSpace(finalizer)
	if finalizer == "" {
		return fmt.Errorf("finalizer is required")
	}

	object, err := resource.Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return s.finalizerRequestError(err, "get", gvk, gvr, namespaced, namespace, name)
	}
	if object.GetDeletionTimestamp() == nil {
		return fmt.Errorf("%s %s is not deleting", gvk.String(), name)
	}
	current := object.GetFinalizers()
	remaining, removed := removeNamedFinalizer(current, finalizer)
	if !removed {
		return nil
	}
	patch, err := json.Marshal([]finalizerPatchOperation{
		{Operation: "test", Path: "/metadata/finalizers", Value: current},
		{Operation: "replace", Path: "/metadata/finalizers", Value: remaining},
	})
	if err != nil {
		return fmt.Errorf("encode finalizer patch: %w", err)
	}
	if _, err := resource.Patch(ctx, name, types.JSONPatchType, patch, metav1.PatchOptions{}); err != nil {
		return s.finalizerRequestError(err, "patch", gvk, gvr, namespaced, namespace, name)
	}
	return nil
}

func (s *Service) finalizerResource(
	ctx context.Context,
	gvk schema.GroupVersionKind,
	namespace string,
) (dynamic.ResourceInterface, schema.GroupVersionResource, bool, error) {
	if strings.TrimSpace(gvk.Version) == "" || strings.TrimSpace(gvk.Kind) == "" {
		return nil, schema.GroupVersionResource{}, false, fmt.Errorf("version and kind are required")
	}
	if s.deps.ResourceResolver == nil {
		return nil, schema.GroupVersionResource{}, false, fmt.Errorf("resource resolver not initialized")
	}
	resolved, ok, err := s.deps.ResourceResolver.ResolveResourceForGVK(ctx, gvk)
	if err != nil {
		return nil, schema.GroupVersionResource{}, false, fmt.Errorf("failed to resolve %s: %w", gvk.String(), err)
	}
	if !ok {
		return nil, schema.GroupVersionResource{}, false, fmt.Errorf("unable to resolve resource for %s", gvk.String())
	}
	dynamicClient, err := s.dynamicClient()
	if err != nil {
		return nil, schema.GroupVersionResource{}, false, fmt.Errorf("failed to create dynamic client: %w", err)
	}
	gvr := resolved.GVR()
	if !resolved.Namespaced {
		return dynamicClient.Resource(gvr), gvr, false, nil
	}
	namespace = strings.TrimSpace(namespace)
	if namespace == "" {
		return nil, schema.GroupVersionResource{}, false, fmt.Errorf("namespaced resource %s requires a namespace", gvr.String())
	}
	return dynamicClient.Resource(gvr).Namespace(namespace), gvr, true, nil
}

func (s *Service) finalizerRequestError(
	err error,
	action string,
	gvk schema.GroupVersionKind,
	gvr schema.GroupVersionResource,
	namespaced bool,
	namespace string,
	name string,
) error {
	err = s.deps.LogDynamicResourceRequestFailure(
		err,
		fmt.Sprintf("Failed to %s finalizers for %s %s/%s", action, gvk.String(), namespace, name),
		common.DynamicResourceRequestSpec{
			Action: action, Group: gvr.Group, Version: gvr.Version,
			Resource: gvr.Resource, Namespaced: namespaced,
		},
		"GenericResource",
	)
	return fmt.Errorf("failed to %s finalizers for %s %s: %w", action, gvk.String(), name, err)
}

func removeNamedFinalizer[T ~string](current []T, target string) ([]T, bool) {
	remaining := make([]T, 0, len(current))
	removed := false
	for _, value := range current {
		if string(value) == target {
			removed = true
			continue
		}
		remaining = append(remaining, value)
	}
	return remaining, removed
}
