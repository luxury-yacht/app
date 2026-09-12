package argocd

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	dynamicfake "k8s.io/client-go/dynamic/fake"
)

func TestDestinationResolutionPreservesExplicitNamesAndPolicyPatterns(t *testing.T) {
	scheme := runtime.NewScheme()
	require.NoError(t, corev1.AddToScheme(scheme))
	secret := &corev1.Secret{ObjectMeta: metav1.ObjectMeta{Name: "prod", Namespace: "team-a", Labels: map[string]string{"argocd.argoproj.io/secret-type": "cluster"}}, Data: map[string][]byte{
		"server": []byte("https://prod.example.com/"), "name": []byte("Production"),
	}}
	for _, test := range []struct {
		name, kind, spec, want string
		reads                  bool
	}{
		{"application", "Application", `{"destination":{"server":"https://prod.example.com"}}`, "Production", true},
		{"application set", "ApplicationSet", `{"template":{"spec":{"destination":{"server":"https://prod.example.com/"}}}}`, "Production", true},
		{"project", "AppProject", `{"destinations":[{"server":"https://prod.example.com","namespace":"team-*"}]}`, "Production", true},
		{"explicit name", "Application", `{"destination":{"name":"explicit-name","server":"https://prod.example.com"}}`, "explicit-name", false},
		{"templated server", "ApplicationSet", `{"template":{"spec":{"destination":{"server":"{{.server}}"}}}}`, "{{.server}}", false},
		{"wildcard policy", "AppProject", `{"destinations":[{"server":"*","namespace":"*"}]}`, "*", false},
		{"unregistered", "Application", `{"destination":{"server":"https://unknown.example.com"}}`, "https://unknown.example.com", true},
		{"implicit local", "Application", `{"destination":{"server":"https://kubernetes.default.svc"}}`, "in-cluster", true},
		{"no destination", "Application", `{}`, "", false},
	} {
		t.Run(test.name, func(t *testing.T) {
			client := dynamicfake.NewSimpleDynamicClient(scheme, secret)
			resolver := NewDestinationResolver("cluster-a", client)
			object := resource(test.kind, test.spec, `{}`)
			facts := BuildFacts("cluster-a", object)
			resolver.EnrichFacts(context.Background(), object, facts)
			var destination Destination
			switch {
			case facts.Application != nil:
				destination = facts.Application.Spec.Destination
			case facts.ApplicationSet != nil:
				destination = facts.ApplicationSet.Template.Destination
			case facts.Project != nil:
				destination = facts.Project.Destinations[0]
			}
			require.Equal(t, test.want, destination.DisplayName())
			table := resolver.TableDestination(context.Background(), object)
			if test.kind == "AppProject" {
				require.Empty(t, table)
			} else {
				require.Equal(t, test.want, table)
			}
			if test.reads {
				require.Len(t, client.Actions(), 1)
			} else {
				require.Empty(t, client.Actions())
			}
		})
	}
}

func TestDestinationResolutionRejectsAmbiguousOrUnreadableRegistrations(t *testing.T) {
	scheme := runtime.NewScheme()
	require.NoError(t, corev1.AddToScheme(scheme))
	secrets := []runtime.Object{}
	for i, name := range []string{"one", "two", "one"} {
		secrets = append(secrets, &corev1.Secret{ObjectMeta: metav1.ObjectMeta{Name: string(rune('a' + i)), Namespace: "team-a", Labels: map[string]string{"argocd.argoproj.io/secret-type": "cluster"}}, Data: map[string][]byte{
			"server": []byte("https://prod.example.com"), "name": []byte(name),
		}})
	}
	secrets = append(secrets, &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "v1", "kind": "Secret", "metadata": map[string]any{"name": "malformed", "namespace": "team-a", "labels": map[string]any{"argocd.argoproj.io/secret-type": "cluster"}}, "data": map[string]any{"name": "not-base64"},
	}})
	client := dynamicfake.NewSimpleDynamicClient(scheme, secrets...)
	object := resource("Application", `{"destination":{"server":"https://prod.example.com"}}`, `{}`)
	resolver := NewDestinationResolver("cluster-a", client)
	require.Equal(t, "https://prod.example.com", resolver.TableDestination(context.Background(), object))
	client.ClearActions()
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	require.Equal(t, "https://prod.example.com", NewDestinationResolver("cluster-a", client).TableDestination(ctx, object))
	require.Equal(t, "https://prod.example.com", NewDestinationResolver("", client).TableDestination(context.Background(), object))
	require.Equal(t, "https://prod.example.com", NewDestinationResolver("cluster-a", nil).TableDestination(context.Background(), object))
	object.SetNamespace("")
	require.Equal(t, "https://prod.example.com", resolver.TableDestination(context.Background(), object))
	resolver.EnrichFacts(context.Background(), object, nil)
	require.Empty(t, client.Actions())
}
