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
	require.Len(t, payload.Resources, 4)

	resources := map[string]ClusterConfigEntry{}
	for _, entry := range payload.Resources {
		resources[entry.Kind+"-"+entry.Name] = entry
		require.NotEmpty(t, entry.Age)
	}

	require.True(t, resources["StorageClass-"+storageClass.Name].IsDefault)
	require.Equal(t, storageClass.Provisioner, resources["StorageClass-"+storageClass.Name].Details)
	require.Equal(t, "nginx.org/ingress-controller", resources["IngressClass-"+ingressClass.Name].Details)
	require.Contains(t, resources["ValidatingWebhookConfiguration-"+validatingWebhook.Name].Details, "1 webhook")
	require.Contains(t, resources["MutatingWebhookConfiguration-"+mutatingWebhook.Name].Details, "2 webhook")
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
	require.Len(t, payload.Volumes, 1)

	entry := payload.Volumes[0]
	require.Equal(t, "PersistentVolume", entry.Kind)
	require.Equal(t, pv.Name, entry.Name)
	require.Equal(t, "fast", entry.StorageClass)
	require.Equal(t, "10Gi", entry.Capacity)
	require.Equal(t, string(corev1.ReadWriteMany), entry.AccessModes)
	require.Equal(t, string(corev1.VolumeAvailable), entry.Status)
	require.Equal(t, "prod/db", entry.Claim)
	require.NotEmpty(t, entry.Age)
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
	require.Len(t, payload.Definitions, 1)

	entry := payload.Definitions[0]
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

// TestCRDVersionSummary covers the storage-version + extra-served-count
// helper that drives the Version column in the CRDs view.
func TestCRDVersionSummary(t *testing.T) {
	makeCRD := func(versions ...apiextensionsv1.CustomResourceDefinitionVersion) *apiextensionsv1.CustomResourceDefinition {
		return &apiextensionsv1.CustomResourceDefinition{
			Spec: apiextensionsv1.CustomResourceDefinitionSpec{Versions: versions},
		}
	}

	t.Run("nil CRD returns zero values", func(t *testing.T) {
		storage, extra := crdVersionSummary(nil)
		require.Equal(t, "", storage)
		require.Equal(t, 0, extra)
	})

	t.Run("empty versions returns zero values", func(t *testing.T) {
		storage, extra := crdVersionSummary(makeCRD())
		require.Equal(t, "", storage)
		require.Equal(t, 0, extra)
	})

	t.Run("single served+storage version returns version with no extras", func(t *testing.T) {
		storage, extra := crdVersionSummary(makeCRD(
			apiextensionsv1.CustomResourceDefinitionVersion{Name: "v1", Served: true, Storage: true},
		))
		require.Equal(t, "v1", storage)
		require.Equal(t, 0, extra)
	})

	t.Run("multi-version with v1 as storage counts the other served versions", func(t *testing.T) {
		// Mirrors the cert-manager-style historical setup where multiple
		// alpha/beta versions are served alongside the stable storage version.
		storage, extra := crdVersionSummary(makeCRD(
			apiextensionsv1.CustomResourceDefinitionVersion{Name: "v1alpha1", Served: true, Storage: false},
			apiextensionsv1.CustomResourceDefinitionVersion{Name: "v1beta1", Served: true, Storage: false},
			apiextensionsv1.CustomResourceDefinitionVersion{Name: "v1", Served: true, Storage: true},
		))
		require.Equal(t, "v1", storage)
		require.Equal(t, 2, extra)
	})

	t.Run("storage version not served counts all served as extras", func(t *testing.T) {
		// Rare/transient: storage version is being deprecated and is no
		// longer served, but still where data is persisted.
		storage, extra := crdVersionSummary(makeCRD(
			apiextensionsv1.CustomResourceDefinitionVersion{Name: "v1alpha1", Served: false, Storage: true},
			apiextensionsv1.CustomResourceDefinitionVersion{Name: "v1", Served: true, Storage: false},
		))
		require.Equal(t, "v1alpha1", storage)
		require.Equal(t, 1, extra)
	})

	t.Run("non-served versions are ignored in the extras count", func(t *testing.T) {
		storage, extra := crdVersionSummary(makeCRD(
			apiextensionsv1.CustomResourceDefinitionVersion{Name: "v1", Served: true, Storage: true},
			apiextensionsv1.CustomResourceDefinitionVersion{Name: "v1alpha1", Served: false, Storage: false},
		))
		require.Equal(t, "v1", storage)
		require.Equal(t, 0, extra, "served=false versions must not contribute to the extra count")
	})

	t.Run("falls back to first served version when no storage flag", func(t *testing.T) {
		// Defensive: malformed CRD with no Storage flag at all.
		storage, extra := crdVersionSummary(makeCRD(
			apiextensionsv1.CustomResourceDefinitionVersion{Name: "v1alpha1", Served: false, Storage: false},
			apiextensionsv1.CustomResourceDefinitionVersion{Name: "v1beta1", Served: true, Storage: false},
			apiextensionsv1.CustomResourceDefinitionVersion{Name: "v1", Served: true, Storage: false},
		))
		require.Equal(t, "v1beta1", storage, "fall back to first served version")
		require.Equal(t, 1, extra, "v1 is also served but is not the chosen storage version")
	})

	t.Run("falls back to first version when nothing is served", func(t *testing.T) {
		// Pathological: nothing served, no storage flag. Show something
		// rather than blank.
		storage, extra := crdVersionSummary(makeCRD(
			apiextensionsv1.CustomResourceDefinitionVersion{Name: "v1alpha1", Served: false, Storage: false},
		))
		require.Equal(t, "v1alpha1", storage)
		require.Equal(t, 0, extra)
	})
}
