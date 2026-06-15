package storageclass_test

import (
	"testing"

	"github.com/stretchr/testify/require"
	storagev1 "k8s.io/api/storage/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/storageclass"
)

// TestBuildResourceModelStatus covers the StorageClass status presentation + facts
// that moved here with the model (was in resourcemodel's storage test).
func TestBuildResourceModelStatus(t *testing.T) {
	tests := []struct {
		name             string
		annotations      map[string]string
		wantState        string
		wantLabel        string
		wantPresentation string
		wantDefault      bool
		wantReason       string
	}{
		{
			name:             "default class",
			annotations:      map[string]string{"storageclass.kubernetes.io/is-default-class": "true"},
			wantState:        "true",
			wantLabel:        "Default",
			wantPresentation: "ready",
			wantDefault:      true,
			wantReason:       "storageclass.kubernetes.io/is-default-class",
		},
		{
			name:             "non-default class",
			annotations:      map[string]string{"storageclass.kubernetes.io/is-default-class": "false"},
			wantState:        "false",
			wantLabel:        "Available",
			wantPresentation: "ready",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			sc := &storagev1.StorageClass{
				ObjectMeta:  metav1.ObjectMeta{Name: "fast", Annotations: tt.annotations},
				Provisioner: "example.com/provisioner",
			}
			model := storageclass.BuildResourceModel("cluster-a", sc)
			require.Equal(t, "storage.k8s.io", model.Ref.Group)
			require.Equal(t, "StorageClass", model.Ref.Kind)
			require.Equal(t, resourcemodel.ResourceScopeCluster, model.Scope)
			require.Equal(t, tt.wantState, model.Status.State)
			require.Equal(t, tt.wantLabel, model.Status.Label)
			require.Equal(t, tt.wantPresentation, model.Status.Presentation)
			require.Equal(t, tt.wantReason, model.Status.Reason)

			facts := storageclass.BuildFacts(sc)
			require.Equal(t, tt.wantDefault, facts.DefaultClass)
			if tt.wantReason != "" {
				require.Equal(t, "true", facts.DefaultClassAnnotationValue)
				require.Equal(t, "true", model.Status.Signals[0].Status)
			}
		})
	}
}

// TestBuildResourceModelTerminatingStatus covers the shared DeletingStorageStatus
// path through StorageClass (moved here from resourcemodel's storage test).
func TestBuildResourceModelTerminatingStatus(t *testing.T) {
	now := metav1.Now()
	sc := &storagev1.StorageClass{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "fast",
			Annotations:       map[string]string{"storageclass.kubernetes.io/is-default-class": "true"},
			DeletionTimestamp: &now,
		},
		Provisioner: "example.com/provisioner",
	}
	model := storageclass.BuildResourceModel("cluster-a", sc)
	require.Equal(t, "Terminating", model.Status.Label)
	require.Equal(t, "true", model.Status.State)
	require.Equal(t, "terminating", model.Status.Presentation)

	facts := storageclass.BuildFacts(sc)
	require.Equal(t, "storageclass.kubernetes.io/is-default-class", facts.DefaultClassAnnotation)
	require.Equal(t, "true", facts.DefaultClassAnnotationValue)
}
