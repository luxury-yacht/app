package backend

import (
	"fmt"
	"reflect"
	"strings"

	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

type objectYAMLBackendBehavior string

const (
	objectYAMLBackendReject   objectYAMLBackendBehavior = "reject"
	objectYAMLBackendStrip    objectYAMLBackendBehavior = "strip"
	objectYAMLBackendPreserve objectYAMLBackendBehavior = "preserve"
	objectYAMLBackendAllow    objectYAMLBackendBehavior = "allow"
)

type objectYAMLFieldRule struct {
	path     []string
	behavior objectYAMLBackendBehavior
}

var objectYAMLFieldPolicyRules = []objectYAMLFieldRule{
	{path: []string{"apiVersion"}, behavior: objectYAMLBackendReject},
	{path: []string{"kind"}, behavior: objectYAMLBackendReject},
	{path: []string{"metadata", "name"}, behavior: objectYAMLBackendReject},
	{path: []string{"metadata", "namespace"}, behavior: objectYAMLBackendReject},
	{path: []string{"metadata", "managedFields"}, behavior: objectYAMLBackendReject},
	{path: []string{"metadata", "resourceVersion"}, behavior: objectYAMLBackendPreserve},
	{path: []string{"metadata", "uid"}, behavior: objectYAMLBackendReject},
	{path: []string{"metadata", "creationTimestamp"}, behavior: objectYAMLBackendReject},
	{path: []string{"metadata", "deletionTimestamp"}, behavior: objectYAMLBackendReject},
	{path: []string{"metadata", "deletionGracePeriodSeconds"}, behavior: objectYAMLBackendReject},
	{path: []string{"metadata", "generation"}, behavior: objectYAMLBackendReject},
	{path: []string{"metadata", "selfLink"}, behavior: objectYAMLBackendReject},
	{path: []string{"status"}, behavior: objectYAMLBackendReject},
	{path: []string{"metadata", "annotations", "deployment.kubernetes.io/revision"}, behavior: objectYAMLBackendReject},
	{path: []string{"metadata", "annotations", "deployment.kubernetes.io/desired-replicas"}, behavior: objectYAMLBackendReject},
	{path: []string{"metadata", "annotations", "deployment.kubernetes.io/max-replicas"}, behavior: objectYAMLBackendReject},
	{path: []string{"metadata", "annotations", "kubectl.kubernetes.io/last-applied-configuration"}, behavior: objectYAMLBackendReject},
}

func objectYAMLFieldPolicyBackendBehavior() map[string]objectYAMLBackendBehavior {
	result := make(map[string]objectYAMLBackendBehavior, len(objectYAMLFieldPolicyRules))
	for _, rule := range objectYAMLFieldPolicyRules {
		result[objectYAMLFieldPathKey(rule.path)] = rule.behavior
	}
	return result
}

func objectYAMLFieldPathKey(path []string) string {
	return strings.Join(path, "\x00")
}

func objectYAMLFieldPathLabel(path []string) string {
	parts := make([]string, 0, len(path))
	for _, part := range path {
		if isSimpleObjectYAMLFieldPathPart(part) {
			parts = append(parts, part)
			continue
		}
		parts = append(parts, fmt.Sprintf("[%q]", part))
	}
	return strings.Join(parts, ".")
}

func isSimpleObjectYAMLFieldPathPart(part string) bool {
	if part == "" {
		return false
	}
	for index, char := range part {
		if (char >= 'A' && char <= 'Z') || (char >= 'a' && char <= 'z') || char == '_' || char == '$' {
			continue
		}
		if index > 0 && char >= '0' && char <= '9' {
			continue
		}
		return false
	}
	return true
}

func enforceObjectYAMLFieldPolicy(baseObj, desiredObj *unstructured.Unstructured) error {
	for _, rule := range objectYAMLFieldPolicyRules {
		switch rule.behavior {
		case objectYAMLBackendReject:
			if protectedObjectYAMLFieldChanged(baseObj, desiredObj, rule.path) {
				return fmt.Errorf("%s is managed by Kubernetes and cannot be edited", objectYAMLFieldPathLabel(rule.path))
			}
		case objectYAMLBackendPreserve, objectYAMLBackendStrip, objectYAMLBackendAllow:
			continue
		default:
			return fmt.Errorf("unknown YAML field policy backend behavior %q for %s", rule.behavior, objectYAMLFieldPathLabel(rule.path))
		}
	}
	return nil
}

func protectedObjectYAMLFieldChanged(baseObj, desiredObj *unstructured.Unstructured, path []string) bool {
	baseValue, baseFound, _ := unstructured.NestedFieldNoCopy(baseObj.Object, path...)
	desiredValue, desiredFound, _ := unstructured.NestedFieldNoCopy(desiredObj.Object, path...)
	if baseFound != desiredFound {
		return true
	}
	if !baseFound {
		return false
	}
	return !reflect.DeepEqual(baseValue, desiredValue)
}

func preserveObjectYAMLFields(baseObj, desiredObj, currentObj *unstructured.Unstructured) {
	for _, rule := range objectYAMLFieldPolicyRules {
		if rule.behavior != objectYAMLBackendPreserve {
			continue
		}
		value, found, _ := unstructured.NestedFieldNoCopy(currentObj.Object, rule.path...)
		if !found {
			value, found, _ = unstructured.NestedFieldNoCopy(baseObj.Object, rule.path...)
		}
		if !found {
			unstructured.RemoveNestedField(baseObj.Object, rule.path...)
			unstructured.RemoveNestedField(desiredObj.Object, rule.path...)
			continue
		}
		_ = unstructured.SetNestedField(baseObj.Object, value, rule.path...)
		_ = unstructured.SetNestedField(desiredObj.Object, value, rule.path...)
	}
}
