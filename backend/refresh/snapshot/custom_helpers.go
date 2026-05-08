package snapshot

import (
	apierrors "k8s.io/apimachinery/pkg/api/errors"

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
	for _, version := range crd.Spec.Versions {
		if version.Served {
			return version.Name
		}
	}
	return ""
}

func shouldSkipError(err error) bool {
	if err == nil {
		return false
	}
	return apierrors.IsForbidden(err) || apierrors.IsNotFound(err)
}
