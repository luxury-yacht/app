// Package crdfacts contains the shared decoding and relationship primitives for
// discovered operator APIs. Family packages own their typed display projections.
package crdfacts

import (
	"sort"
	"strconv"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

func StringOrNumber(value any) string {
	switch value := value.(type) {
	case string:
		return value
	case int64:
		return strconv.FormatInt(value, 10)
	case float64:
		return strconv.FormatFloat(value, 'f', -1, 64)
	default:
		return ""
	}
}

func Read[T any](object map[string]any, fields ...string) *T {
	value, found, _ := unstructured.NestedMap(object, fields...)
	if !found {
		return nil
	}
	var result T
	if runtime.DefaultUnstructuredConverter.FromUnstructured(value, &result) != nil {
		return nil
	}
	return &result
}

func Text(object map[string]any, fields ...string) string {
	value, _, _ := unstructured.NestedString(object, fields...)
	return value
}

func Strings(object map[string]any, fields ...string) []string {
	value, _, _ := unstructured.NestedStringSlice(object, fields...)
	return value
}

func Number(object map[string]any, fields ...string) *int64 {
	value, found, _ := unstructured.NestedInt64(object, fields...)
	if !found {
		return nil
	}
	return &value
}

func Bool(object map[string]any, fields ...string) *bool {
	value, found, _ := unstructured.NestedBool(object, fields...)
	if !found {
		return nil
	}
	return &value
}

func Keys(object map[string]any, fields ...string) []string {
	value, _, _ := unstructured.NestedMap(object, fields...)
	keys := make([]string, 0, len(value))
	for key := range value {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func Reference(clusterID, group, kind, namespace, name string) *resourcemodel.ResourceLink {
	if name == "" {
		return nil
	}
	link := resourcemodel.NewDisplayResourceLink(clusterID, group, "", kind, "", namespace, name)
	return &link
}

func Secret(clusterID, namespace, name string) *resourcemodel.ResourceLink {
	if namespace == "" || name == "" {
		return nil
	}
	link := resourcemodel.SecretLink(clusterID, namespace, name)
	return &link
}

func Owners(clusterID string, object *unstructured.Unstructured, group, kind string) []resourcemodel.ResourceLink {
	var result []resourcemodel.ResourceLink
	for _, owner := range object.GetOwnerReferences() {
		gv, err := schema.ParseGroupVersion(owner.APIVersion)
		if err != nil || gv.Version == "" || gv.Group != group || owner.Kind != kind || owner.Name == "" {
			continue
		}
		// Callers identify a known namespaced owner kind from the operator API.
		link := resourcemodel.NewResourceLink(resourcemodel.NewResourceRef(resourcemodel.ResourceRef{ClusterID: clusterID, Group: gv.Group, Version: gv.Version, Kind: owner.Kind, Namespace: object.GetNamespace(), Name: owner.Name, UID: string(owner.UID)}))
		result = append(result, link)
	}
	return result
}
