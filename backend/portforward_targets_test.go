/*
 * backend/portforward_targets_test.go
 *
 * Tests for the shared port-forward target capability table.
 */
package backend

import (
	"strings"
	"testing"
)

func TestValidatePortForwardTargetGVKSupportedTargets(t *testing.T) {
	tests := []portForwardTargetRef{
		{Namespace: "default", Kind: "Pod", Group: "", Version: "v1", Name: "api"},
		{Namespace: "default", Kind: "Service", Group: "", Version: "v1", Name: "api"},
		{Namespace: "default", Kind: "Deployment", Group: "apps", Version: "v1", Name: "api"},
		{Namespace: "default", Kind: "StatefulSet", Group: "apps", Version: "v1", Name: "api"},
		{Namespace: "default", Kind: "DaemonSet", Group: "apps", Version: "v1", Name: "api"},
	}

	for _, target := range tests {
		t.Run(target.Kind, func(t *testing.T) {
			if err := validatePortForwardTargetGVK(target); err != nil {
				t.Fatalf("expected %s to be supported, got %v", target.Kind, err)
			}
		})
	}
}

func TestValidatePortForwardTargetGVKRejectsUnsupportedTargets(t *testing.T) {
	tests := []struct {
		name    string
		target  portForwardTargetRef
		wantErr string
	}{
		{
			name: "unsupported kind",
			target: portForwardTargetRef{
				Namespace: "default",
				Kind:      "ConfigMap",
				Group:     "",
				Version:   "v1",
				Name:      "settings",
			},
			wantErr: "unsupported target kind: ConfigMap",
		},
		{
			name: "missing version",
			target: portForwardTargetRef{
				Namespace: "default",
				Kind:      "Service",
				Group:     "",
				Version:   "",
				Name:      "api",
			},
			wantErr: "target version is required",
		},
		{
			name: "wrong group",
			target: portForwardTargetRef{
				Namespace: "default",
				Kind:      "Deployment",
				Group:     "extensions",
				Version:   "v1beta1",
				Name:      "api",
			},
			wantErr: "target Deployment must use apiVersion apps/v1",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			err := validatePortForwardTargetGVK(tc.target)
			if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
				t.Fatalf("expected error containing %q, got %v", tc.wantErr, err)
			}
		})
	}
}
