package resourcemodel

import (
	"fmt"
	"strings"
)

// NewResourceRef builds the canonical identity for an openable Kubernetes
// object. It does not infer resource from kind; callers must pass resource only
// when discovery/catalog data already supplied it.
func NewResourceRef(ref ResourceRef) ResourceRef {
	return ResourceRef{
		ClusterID: strings.TrimSpace(ref.ClusterID),
		Group:     strings.TrimSpace(ref.Group),
		Version:   strings.TrimSpace(ref.Version),
		Kind:      strings.TrimSpace(ref.Kind),
		Resource:  strings.TrimSpace(ref.Resource),
		Namespace: strings.TrimSpace(ref.Namespace),
		Name:      strings.TrimSpace(ref.Name),
		UID:       strings.TrimSpace(ref.UID),
	}
}

// NewDisplayRef builds a display-only identity for a relationship that should
// not be opened because the source data did not provide a complete GVK.
func NewDisplayRef(ref DisplayRef) DisplayRef {
	return DisplayRef(NewResourceRef(ResourceRef(ref)))
}

func NewResourceLink(ref ResourceRef) ResourceLink {
	return ResourceLink{Ref: &ref}
}

func NewNamespacedResourceLink(ref ResourceRef) ResourceLink {
	return NewResourceLink(NewResourceRef(ref))
}

func NewClusterResourceLink(clusterID, group, version, kind, resource, name, uid string) ResourceLink {
	return NewNamespacedResourceLink(ResourceRef{
		ClusterID: clusterID,
		Group:     group,
		Version:   version,
		Kind:      kind,
		Resource:  resource,
		Name:      name,
		UID:       uid,
	})
}

func NewDisplayResourceLink(clusterID, group, version, kind, resource, namespace, name string) ResourceLink {
	display := NewDisplayRef(DisplayRef{
		ClusterID: clusterID,
		Group:     group,
		Version:   version,
		Kind:      kind,
		Resource:  resource,
		Namespace: namespace,
		Name:      name,
	})
	return ResourceLink{Display: &display}
}

func ValidateResourceRef(ref ResourceRef) error {
	if strings.TrimSpace(ref.ClusterID) == "" {
		return fmt.Errorf("resource ref is missing clusterId")
	}
	if strings.TrimSpace(ref.Version) == "" {
		return fmt.Errorf("resource ref for %s/%s is missing version", ref.Kind, ref.Name)
	}
	if strings.TrimSpace(ref.Kind) == "" {
		return fmt.Errorf("resource ref is missing kind")
	}
	if strings.TrimSpace(ref.Group) == "" && !isCoreV1ResourceRef(ref) {
		return fmt.Errorf("resource ref for %s/%s is missing group", ref.Kind, ref.Name)
	}
	if strings.TrimSpace(ref.Name) == "" {
		return fmt.Errorf("resource ref for kind %s is missing name", ref.Kind)
	}
	return nil
}

func isCoreV1ResourceRef(ref ResourceRef) bool {
	if strings.TrimSpace(ref.Version) != "v1" {
		return false
	}
	switch strings.ToLower(strings.TrimSpace(ref.Kind)) {
	case "configmap",
		"endpoints",
		"event",
		"limitrange",
		"namespace",
		"node",
		"persistentvolume",
		"persistentvolumeclaim",
		"pod",
		"resourcequota",
		"secret",
		"service",
		"serviceaccount":
		return true
	default:
		return false
	}
}

func ValidateDisplayRef(ref DisplayRef) error {
	if strings.TrimSpace(ref.ClusterID) == "" {
		return fmt.Errorf("display ref is missing clusterId")
	}
	if strings.TrimSpace(ref.Kind) == "" {
		return fmt.Errorf("display ref is missing kind")
	}
	if strings.TrimSpace(ref.Name) == "" {
		return fmt.Errorf("display ref for kind %s is missing name", ref.Kind)
	}
	return nil
}

func ValidateResourceLink(link ResourceLink) error {
	switch {
	case link.Ref != nil && link.Display != nil:
		return fmt.Errorf("resource link cannot contain both ref and display")
	case link.Ref != nil:
		return ValidateResourceRef(*link.Ref)
	case link.Display != nil:
		return ValidateDisplayRef(*link.Display)
	default:
		return fmt.Errorf("resource link must contain ref or display")
	}
}
