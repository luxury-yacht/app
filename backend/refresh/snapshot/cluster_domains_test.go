package snapshot

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	admissionv1 "k8s.io/api/admissionregistration/v1"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	storagev1 "k8s.io/api/storage/v1"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh/domainpermissions"
	"github.com/luxury-yacht/app/backend/testsupport"
)

func TestClusterConfigBuilder(t *testing.T) {
	now := time.Now()

	storageClass := &storagev1.StorageClass{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "standard",
			ResourceVersion:   "21",
			CreationTimestamp: metav1.NewTime(now.Add(-24 * time.Hour)),
			Annotations: map[string]string{
				"storageclass.kubernetes.io/is-default-class": "true",
			},
		},
		Provisioner: "kubernetes.io/aws-ebs",
	}

	ingressClass := &networkingv1.IngressClass{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "public",
			ResourceVersion:   "22",
			CreationTimestamp: metav1.NewTime(now.Add(-12 * time.Hour)),
		},
		Spec: networkingv1.IngressClassSpec{Controller: "nginx.org/ingress-controller"},
	}

	validatingWebhook := &admissionv1.ValidatingWebhookConfiguration{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "validate-widgets",
			ResourceVersion:   "23",
			CreationTimestamp: metav1.NewTime(now.Add(-6 * time.Hour)),
		},
		Webhooks: []admissionv1.ValidatingWebhook{{Name: "vwidgets.acme.test"}},
	}

	mutatingWebhook := &admissionv1.MutatingWebhookConfiguration{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "mutate-widgets",
			ResourceVersion:   "24",
			CreationTimestamp: metav1.NewTime(now.Add(-3 * time.Hour)),
		},
		Webhooks: []admissionv1.MutatingWebhook{
			{Name: "mwidgets.acme.test"},
			{Name: "mwidgets2.acme.test"},
		},
	}

	builder := &ClusterConfigBuilder{
		storageClassLister:      testsupport.NewStorageClassLister(t, storageClass),
		ingressClassLister:      testsupport.NewIngressClassLister(t, ingressClass),
		validatingWebhookLister: testsupport.NewValidatingWebhookLister(t, validatingWebhook),
		mutatingWebhookLister:   testsupport.NewMutatingWebhookLister(t, mutatingWebhook),
		perms: ClusterConfigPermissions{
			IncludeStorageClasses:     true,
			IncludeIngressClasses:     true,
			IncludeValidatingWebhooks: true,
			IncludeMutatingWebhooks:   true,
		},
	}

	snapshot, err := builder.Build(context.Background(), "")
	require.NoError(t, err)
	require.Equal(t, clusterConfigDomainName, snapshot.Domain)
	require.Equal(t, uint64(24), snapshot.Version)

	payload, ok := snapshot.Payload.(ClusterConfigSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Rows, 4)
	require.Equal(t, []string{
		"IngressClass",
		"MutatingWebhookConfiguration",
		"StorageClass",
		"ValidatingWebhookConfiguration",
	}, payload.Kinds)

	resources := map[string]ClusterConfigEntry{}
	for _, entry := range payload.Rows {
		resources[entry.Kind+"-"+entry.Name] = entry
		require.NotEmpty(t, entry.Age)
	}

	require.True(t, resources["StorageClass-"+storageClass.Name].IsDefault)
	require.Equal(t, storageClass.Provisioner, resources["StorageClass-"+storageClass.Name].Details)
	require.Equal(t, "nginx.org/ingress-controller", resources["IngressClass-"+ingressClass.Name].Details)
	require.Contains(t, resources["ValidatingWebhookConfiguration-"+validatingWebhook.Name].Details, "1 webhook")
	require.Contains(t, resources["MutatingWebhookConfiguration-"+mutatingWebhook.Name].Details, "2 webhook")
}

func TestClusterConfigBuilderCapsLargeSnapshots(t *testing.T) {
	classes := make([]*storagev1.StorageClass, 0, config.SnapshotClusterConfigEntryLimit+1)
	for i := 0; i < config.SnapshotClusterConfigEntryLimit+1; i++ {
		classes = append(classes, &storagev1.StorageClass{
			ObjectMeta: metav1.ObjectMeta{
				Name:            "storage-class-" + string(rune('a'+(i%26))) + "-" + time.Unix(int64(i), 0).Format("150405"),
				ResourceVersion: "1",
			},
			Provisioner: "example.test/provisioner",
		})
	}

	builder := &ClusterConfigBuilder{
		storageClassLister: testsupport.NewStorageClassLister(t, classes...),
		perms:              ClusterConfigPermissions{IncludeStorageClasses: true},
	}

	snapshot, err := builder.Build(context.Background(), "")
	require.NoError(t, err)
	payload := snapshot.Payload.(ClusterConfigSnapshot)
	require.Len(t, payload.Rows, config.SnapshotClusterConfigEntryLimit)
	require.True(t, snapshot.Stats.Truncated)
	require.Equal(t, config.SnapshotClusterConfigEntryLimit+1, snapshot.Stats.TotalItems)
	require.Contains(t, snapshot.Stats.Warnings[0], "cluster configuration resources")
}

func TestClusterConfigBuilderQueryReportsPartialAllowedResources(t *testing.T) {
	ingressClass := &networkingv1.IngressClass{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "public",
			ResourceVersion:   "22",
			CreationTimestamp: metav1.NewTime(time.Now().Add(-12 * time.Hour)),
		},
		Spec: networkingv1.IngressClassSpec{Controller: "nginx.org/ingress-controller"},
	}
	builder := &ClusterConfigBuilder{
		ingressClassLister: testsupport.NewIngressClassLister(t, ingressClass),
		perms: ClusterConfigPermissions{
			IncludeIngressClasses: true,
		},
	}
	ctx := domainpermissions.WithAllowedResources(context.Background(), clusterConfigDomainName, domainpermissions.AllowedResources{
		"networking.k8s.io/ingressclasses": false,
	})

	snapshot, err := builder.Build(ctx, "cluster-a|?limit=10&kinds=IngressClass")
	require.NoError(t, err)
	payload := snapshot.Payload.(ClusterConfigSnapshot)
	require.False(t, payload.TotalIsExact)
	require.False(t, payload.FacetsExact)
	require.Len(t, payload.Issues, 1)
	require.Equal(t, "IngressClass", payload.Issues[0].Kind)
	require.Empty(t, payload.Rows)
}

func TestClusterStorageBuilder(t *testing.T) {
	now := time.Now()
	pv := &corev1.PersistentVolume{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "pv-2",
			ResourceVersion:   "42",
			CreationTimestamp: metav1.NewTime(now.Add(-36 * time.Hour)),
		},
		Spec: corev1.PersistentVolumeSpec{
			Capacity: corev1.ResourceList{
				corev1.ResourceStorage: mustQuantity(t, "10Gi"),
			},
			AccessModes:      []corev1.PersistentVolumeAccessMode{corev1.ReadWriteMany},
			StorageClassName: "fast",
			ClaimRef: &corev1.ObjectReference{
				Namespace: "prod",
				Name:      "db",
			},
		},
		Status: corev1.PersistentVolumeStatus{
			Phase: corev1.VolumeAvailable,
		},
	}

	builder := &ClusterStorageBuilder{
		pvLister: testsupport.NewPersistentVolumeLister(t, pv),
	}

	snapshot, err := builder.Build(context.Background(), "")
	require.NoError(t, err)
	require.Equal(t, clusterStorageDomainName, snapshot.Domain)
	require.Equal(t, uint64(42), snapshot.Version)

	payload, ok := snapshot.Payload.(ClusterStorageSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Rows, 1)

	entry := payload.Rows[0]
	require.Equal(t, "PersistentVolume", entry.Kind)
	require.Equal(t, pv.Name, entry.Name)
	require.Equal(t, "fast", entry.StorageClass)
	require.Equal(t, "10Gi", entry.Capacity)
	require.Equal(t, string(corev1.ReadWriteMany), entry.AccessModes)
	require.Equal(t, string(corev1.VolumeAvailable), entry.Status)
	require.Equal(t, string(corev1.VolumeAvailable), entry.StatusState)
	require.Equal(t, "ready", entry.StatusPresentation)
	require.Equal(t, "prod/db", entry.Claim)
	require.NotEmpty(t, entry.Age)
}

func TestClusterStorageBuilderCapsLargeSnapshots(t *testing.T) {
	pvs := make([]*corev1.PersistentVolume, 0, config.SnapshotClusterStorageEntryLimit+1)
	for i := 0; i < config.SnapshotClusterStorageEntryLimit+1; i++ {
		pvs = append(pvs, &corev1.PersistentVolume{
			ObjectMeta: metav1.ObjectMeta{
				Name:            "pv-" + time.Unix(int64(i), 0).Format("150405"),
				ResourceVersion: "1",
			},
		})
	}

	builder := &ClusterStorageBuilder{
		pvLister: testsupport.NewPersistentVolumeLister(t, pvs...),
	}

	snapshot, err := builder.Build(context.Background(), "")
	require.NoError(t, err)
	payload := snapshot.Payload.(ClusterStorageSnapshot)
	require.Len(t, payload.Rows, config.SnapshotClusterStorageEntryLimit)
	require.True(t, snapshot.Stats.Truncated)
	require.Equal(t, config.SnapshotClusterStorageEntryLimit+1, snapshot.Stats.TotalItems)
	require.Contains(t, snapshot.Stats.Warnings[0], "persistent volumes")
}

func TestClusterCRDBuilder(t *testing.T) {
	now := time.Now()
	crd := &apiextensionsv1.CustomResourceDefinition{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "gadgets.acme.test",
			ResourceVersion:   "55",
			CreationTimestamp: metav1.NewTime(now.Add(-5 * time.Hour)),
		},
		Spec: apiextensionsv1.CustomResourceDefinitionSpec{
			Group: "acme.test",
			Scope: apiextensionsv1.NamespaceScoped,
			Names: apiextensionsv1.CustomResourceDefinitionNames{
				Plural: "gadgets",
				Kind:   "Gadget",
			},
			Versions: []apiextensionsv1.CustomResourceDefinitionVersion{
				{Name: "v1alpha1", Served: true, Storage: false},
				{Name: "v1beta1", Served: true, Storage: false},
				{Name: "v1", Served: true, Storage: true},
			},
		},
	}

	builder := &ClusterCRDBuilder{
		crdLister: testsupport.NewCRDLister(t, crd),
	}

	snapshot, err := builder.Build(context.Background(), "")
	require.NoError(t, err)
	require.Equal(t, clusterCRDDomainName, snapshot.Domain)
	require.Equal(t, uint64(55), snapshot.Version)

	payload, ok := snapshot.Payload.(ClusterCRDSnapshot)
	require.True(t, ok)
	require.Len(t, payload.Rows, 1)

	entry := payload.Rows[0]
	require.Equal(t, "CustomResourceDefinition", entry.Kind)
	require.Equal(t, crd.Name, entry.Name)
	require.Equal(t, crd.Spec.Group, entry.Group)
	require.Equal(t, string(crd.Spec.Scope), entry.Scope)
	require.Contains(t, entry.Details, "v1*")
	// Multi-version CRD: v1 is the storage version, v1alpha1 and v1beta1
	// are additional served versions. Frontend renders this as "v1 (+2)".
	require.Equal(t, "v1", entry.StorageVersion)
	require.Equal(t, 2, entry.ExtraServedVersionCount)
	require.NotEmpty(t, entry.Age)
}

func TestClusterCRDBuilderCapsLargeSnapshots(t *testing.T) {
	crds := make([]*apiextensionsv1.CustomResourceDefinition, 0, config.SnapshotClusterCRDEntryLimit+1)
	for i := 0; i < config.SnapshotClusterCRDEntryLimit+1; i++ {
		crds = append(crds, &apiextensionsv1.CustomResourceDefinition{
			ObjectMeta: metav1.ObjectMeta{
				Name:            "widgets-" + time.Unix(int64(i), 0).Format("150405") + ".acme.test",
				ResourceVersion: "1",
			},
			Spec: apiextensionsv1.CustomResourceDefinitionSpec{
				Group: "acme.test",
				Scope: apiextensionsv1.NamespaceScoped,
				Names: apiextensionsv1.CustomResourceDefinitionNames{
					Plural: "widgets",
					Kind:   "Widget",
				},
				Versions: []apiextensionsv1.CustomResourceDefinitionVersion{
					{Name: "v1", Served: true, Storage: true},
				},
			},
		})
	}

	builder := &ClusterCRDBuilder{
		crdLister: testsupport.NewCRDLister(t, crds...),
	}

	snapshot, err := builder.Build(context.Background(), "")
	require.NoError(t, err)
	payload := snapshot.Payload.(ClusterCRDSnapshot)
	require.Len(t, payload.Rows, config.SnapshotClusterCRDEntryLimit)
	require.True(t, snapshot.Stats.Truncated)
	require.Equal(t, config.SnapshotClusterCRDEntryLimit+1, snapshot.Stats.TotalItems)
	require.Contains(t, snapshot.Stats.Warnings[0], "CRDs")
}

