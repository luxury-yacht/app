package snapshot

import (
	"context"
	"errors"
	"testing"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"

	"github.com/luxury-yacht/app/backend/refresh/domain"
)

type stubDetailProvider struct {
	details interface{}
	version string
	err     error
	calls   int
}

func (s *stubDetailProvider) FetchObjectDetails(_ context.Context, _ string, _ string, _ string) (interface{}, string, error) {
	s.calls++
	return s.details, s.version, s.err
}

func TestObjectDetailsBuilderUsesProviderWhenAvailable(t *testing.T) {
	provider := &stubDetailProvider{
		details: map[string]string{"foo": "bar"},
		version: "42",
	}

	builder := &ObjectDetailsBuilder{
		client:   fake.NewClientset(),
		provider: provider,
	}

	snapshot, err := builder.Build(context.Background(), "default:Pod:demo")
	if err != nil {
		t.Fatalf("Build failed: %v", err)
	}

	if provider.calls != 1 {
		t.Fatalf("expected provider to be called once, got %d", provider.calls)
	}

	payload, ok := snapshot.Payload.(ObjectDetailsSnapshotPayload)
	if !ok {
		t.Fatalf("unexpected payload type: %T", snapshot.Payload)
	}

	if payload.Details == nil {
		t.Fatalf("expected details from provider, got nil")
	}

	if snapshot.Version != 42 {
		t.Fatalf("expected version 42, got %d", snapshot.Version)
	}
}

func TestObjectDetailsBuilderFallsBackToClientFetcher(t *testing.T) {
	cfg := &corev1.ConfigMap{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "demo",
			Namespace:       "default",
			ResourceVersion: "101",
		},
	}
	client := fake.NewClientset(cfg)
	provider := &stubDetailProvider{err: ErrObjectDetailNotImplemented}

	builder := &ObjectDetailsBuilder{
		client:   client,
		provider: provider,
	}

	snapshot, err := builder.Build(context.Background(), "default:ConfigMap:demo")
	if err != nil {
		t.Fatalf("Build failed: %v", err)
	}

	if provider.calls != 1 {
		t.Fatalf("expected provider to be consulted once, got %d", provider.calls)
	}

	if snapshot.Version != 101 {
		t.Fatalf("expected version 101, got %d", snapshot.Version)
	}

	payload, ok := snapshot.Payload.(ObjectDetailsSnapshotPayload)
	if !ok {
		t.Fatalf("unexpected payload type: %T", snapshot.Payload)
	}

	cm, ok := payload.Details.(*corev1.ConfigMap)
	if !ok {
		t.Fatalf("expected ConfigMap details, got %T", payload.Details)
	}

	if cm.Name != "demo" {
		t.Fatalf("expected ConfigMap name demo, got %s", cm.Name)
	}
}

func TestObjectDetailsBuilderPropagatesProviderErrors(t *testing.T) {
	expectedErr := errors.New("boom")
	provider := &stubDetailProvider{err: expectedErr}

	builder := &ObjectDetailsBuilder{
		client:   fake.NewClientset(),
		provider: provider,
	}

	_, err := builder.Build(context.Background(), "default:Pod:demo")
	if err == nil {
		t.Fatal("expected error from provider, got nil")
	}
	if !errors.Is(err, expectedErr) {
		t.Fatalf("expected error %v, got %v", expectedErr, err)
	}
}

func TestParseObjectScopeValidClusterScope(t *testing.T) {
	identity, err := parseObjectScope("__cluster__:Node:n1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if identity.Namespace != "" || identity.GVK.Kind != "Node" || identity.Name != "n1" {
		t.Fatalf("unexpected scope output: ns=%q kind=%q name=%q", identity.Namespace, identity.GVK.Kind, identity.Name)
	}
	if identity.GVK.Group != "" || identity.GVK.Version != "" {
		t.Fatalf("legacy scope should not populate group/version, got group=%q version=%q", identity.GVK.Group, identity.GVK.Version)
	}
}

func TestParseObjectScopeRejectsEmptyKind(t *testing.T) {
	if _, err := parseObjectScope("default::pod-1"); err == nil {
		t.Fatal("expected error for empty kind")
	}
}

func TestParseObjectScopeGVKForm(t *testing.T) {
	identity, err := parseObjectScope("default:rds.services.k8s.aws/v1alpha1:DBInstance:my-db")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if identity.Namespace != "default" {
		t.Fatalf("expected namespace 'default', got %q", identity.Namespace)
	}
	if identity.Name != "my-db" {
		t.Fatalf("expected name 'my-db', got %q", identity.Name)
	}
	if identity.GVK.Group != "rds.services.k8s.aws" {
		t.Fatalf("expected group 'rds.services.k8s.aws', got %q", identity.GVK.Group)
	}
	if identity.GVK.Version != "v1alpha1" {
		t.Fatalf("expected version 'v1alpha1', got %q", identity.GVK.Version)
	}
	if identity.GVK.Kind != "DBInstance" {
		t.Fatalf("expected kind 'DBInstance', got %q", identity.GVK.Kind)
	}
}

func TestParseObjectScopeGVKFormWithClusterScopedNamespace(t *testing.T) {
	identity, err := parseObjectScope("__cluster__:rbac.authorization.k8s.io/v1:ClusterRole:admin")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if identity.Namespace != "" {
		t.Fatalf("expected empty namespace for cluster-scoped GVK form, got %q", identity.Namespace)
	}
	if identity.GVK.Group != "rbac.authorization.k8s.io" || identity.GVK.Version != "v1" || identity.GVK.Kind != "ClusterRole" {
		t.Fatalf("unexpected GVK: %v", identity.GVK)
	}
	if identity.Name != "admin" {
		t.Fatalf("expected name 'admin', got %q", identity.Name)
	}
}

func TestParseObjectScopeGVKFormCoreResource(t *testing.T) {
	// Core resources have empty group. Encoded as leading slash so
	// strings.SplitN still yields four segments.
	identity, err := parseObjectScope("default:/v1:ConfigMap:app-cm")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if identity.GVK.Group != "" || identity.GVK.Version != "v1" || identity.GVK.Kind != "ConfigMap" {
		t.Fatalf("unexpected GVK for core resource: %v", identity.GVK)
	}
	if identity.Namespace != "default" || identity.Name != "app-cm" {
		t.Fatalf("unexpected ns/name: ns=%q name=%q", identity.Namespace, identity.Name)
	}
}

func TestRegisterObjectDetailsDomainRequiresClient(t *testing.T) {
	reg := domain.New()
	if err := RegisterObjectDetailsDomain(reg, nil, nil, nil); err == nil {
		t.Fatal("expected error when client is missing")
	}
}

func TestRegisterObjectDetailsDomainRegistersBuilder(t *testing.T) {
	reg := domain.New()
	provider := &stubDetailProvider{details: map[string]string{"ok": "true"}, version: "7"}
	client := fake.NewClientset()

	if err := RegisterObjectDetailsDomain(reg, client, nil, provider); err != nil {
		t.Fatalf("RegisterObjectDetailsDomain returned error: %v", err)
	}

	cfg, ok := reg.Get("object-details")
	if !ok {
		t.Fatal("object-details domain not registered")
	}

	snap, err := cfg.BuildSnapshot(context.Background(), "default:Pod:demo")
	if err != nil {
		t.Fatalf("BuildSnapshot failed: %v", err)
	}
	if provider.calls != 1 {
		t.Fatalf("expected provider to be invoked, got %d calls", provider.calls)
	}

	payload, ok := snap.Payload.(ObjectDetailsSnapshotPayload)
	if !ok || payload.Details == nil {
		t.Fatalf("unexpected payload: %#v", snap.Payload)
	}
}
