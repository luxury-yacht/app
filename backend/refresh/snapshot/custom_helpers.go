package snapshot

import (
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"

	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
)

func preferredCRDVersion(crd *apiextensionsv1.CustomResourceDefinition) string {
	if crd == nil {
		return ""
	}
	for _, version := range crd.Spec.Versions {
		if version.Served && version.Storage {
			return version.Name
		}
	}
	if len(crd.Spec.Versions) > 0 {
		return crd.Spec.Versions[0].Name
	}
	return ""
}

func resourceKind(obj *unstructured.Unstructured, fallback string) string {
	if obj == nil {
		return fallback
	}
	if kind := obj.GetKind(); kind != "" {
		return kind
	}
	return fallback
}

func shouldSkipError(err error) bool {
	if err == nil {
		return false
	}
	return apierrors.IsForbidden(err) || apierrors.IsNotFound(err)
}
