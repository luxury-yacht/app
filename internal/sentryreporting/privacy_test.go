package sentryreporting

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/getsentry/sentry-go"
	"github.com/stretchr/testify/require"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

func TestPrepareEventForSendRemovesPersonalAndRequestData(t *testing.T) {
	event := &sentry.Event{
		ServerName: "johns-macbook",
		Release:    "luxury-yacht@v1.2.3",
		Message: "request to https://admin:password@internal.example.test/api/pods?token=top-secret " +
			"failed from 10.20.30.40 or fd00::1234 via internal-api.local in /Users/john/.kube/config",
		User: sentry.User{
			ID:        "installation-id",
			Email:     "john@example.test",
			IPAddress: "10.20.30.40",
			Username:  "john",
		},
		Request: &sentry.Request{
			URL:         "https://internal.example.test/api/pods?token=top-secret",
			Method:      "GET",
			Data:        `{"password":"top-secret"}`,
			QueryString: "token=top-secret",
			Cookies:     "session=top-secret",
			Headers:     map[string]string{"Authorization": "Bearer top-secret"},
		},
		Exception: []sentry.Exception{{
			Type:  "exampleError",
			Value: "authorization=Bearer top-secret at /home/john/project/file.go",
			Stacktrace: &sentry.Stacktrace{Frames: []sentry.Frame{{
				Function:    "loadPods",
				Filename:    "loader.go",
				AbsPath:     "/Users/john/git/luxury-yacht/app/loader.go",
				ContextLine: `token := "top-secret"`,
				Vars:        map[string]any{"token": "top-secret"},
			}}},
		}},
		Threads: []sentry.Thread{{
			ID: "1",
			Stacktrace: &sentry.Stacktrace{Frames: []sentry.Frame{{
				AbsPath: "/Users/john/git/luxury-yacht/app/worker.go",
				Vars:    map[string]any{"password": "top-secret"},
			}}},
		}},
		Breadcrumbs: []*sentry.Breadcrumb{{
			Category: "request.broker",
			Message:  "GET https://internal.example.test/api/pods?token=top-secret",
			Data: map[string]any{
				"authorization": "Bearer top-secret",
				"safeReason":    "Forbidden",
			},
		}},
		Contexts: map[string]sentry.Context{
			"os": {"name": "darwin", "version": "15.0"},
		},
	}

	prepared := prepareEventForSend(event, nil)

	require.NotNil(t, prepared)
	require.True(t, prepared.User.IsEmpty())
	require.Nil(t, prepared.Request)
	require.Empty(t, prepared.ServerName)
	require.Equal(t, "luxury-yacht@v1.2.3", prepared.Release)
	require.Equal(t, "darwin", prepared.Contexts["os"]["name"])
	require.Nil(t, prepared.Exception[0].Stacktrace.Frames[0].Vars)
	require.Nil(t, prepared.Threads[0].Stacktrace.Frames[0].Vars)

	payload, err := json.Marshal(prepared)
	require.NoError(t, err)
	for _, sensitive := range []string{
		"johns-macbook",
		"john@example.test",
		"10.20.30.40",
		"fd00::1234",
		"top-secret",
		"internal.example.test",
		"internal-api.local",
		"/Users/john",
		"/home/john",
	} {
		require.NotContains(t, string(payload), sensitive)
	}
	require.Contains(t, string(payload), "[url]")
	require.Contains(t, string(payload), "[local-path]")
}

func TestPrepareEventForSendKeepsSafeRepositoryRelativeApplicationFramePaths(t *testing.T) {
	event := &sentry.Event{Exception: []sentry.Exception{{
		Stacktrace: &sentry.Stacktrace{Frames: []sentry.Frame{{
			Module:   "github.com/luxury-yacht/app/backend/capabilities",
			Filename: "/Users/alice/git/luxury-yacht/app/backend/capabilities/service.go",
			AbsPath:  "/Users/alice/git/luxury-yacht/app/backend/capabilities/service.go",
		}}},
	}}}

	prepared := prepareEventForSend(event, nil)

	require.NotNil(t, prepared)
	frame := prepared.Exception[0].Stacktrace.Frames[0]
	require.Equal(t, "backend/capabilities/service.go", frame.Filename)
	require.Equal(t, "backend/capabilities/service.go", frame.AbsPath)
}

func TestPrepareEventForSendPreservesOrdinaryKubernetesProseWhileRedactingNames(t *testing.T) {
	event := &sentry.Event{Message: strings.Join([]string{
		"service unavailable",
		"node not ready",
		"deployment does not have minimum availability",
		"secret is missing key ca.crt",
		"pod payments/api failed",
		"service api-prod failed",
		`deployment.apps "privateworkload" is invalid`,
	}, "; ")}

	prepared := prepareEventForSend(event, nil)

	require.Equal(t, strings.Join([]string{
		"service unavailable",
		"node not ready",
		"deployment does not have minimum availability",
		"secret is missing key ca.crt",
		"pod [resource] failed",
		"service [resource] failed",
		`deployment "[resource]" is invalid`,
	}, "; "), prepared.Message)
}

func TestPrepareEventForSendPreservesCapabilityShapesWhileScrubbingSurroundingText(t *testing.T) {
	event := &sentry.Event{
		Tags: map[string]string{"source": "Capabilities"},
		Breadcrumbs: []*sentry.Breadcrumb{
			{
				Category: "Capabilities",
				Message:  "Capability check gateway.networking.k8s.io/v1 tlsroutes list namespace-scoped slow: 8s",
			},
			{
				Category: "Refresh",
				Message:  "configmap customer-prod failed",
			},
		},
		Contexts: map[string]sentry.Context{
			"error": {
				"operation": "5 capability checks failed while configmap customer-prod failed: Post \"https://api.private.test\": token=top-secret via node.private.internal " +
					"[gateway.networking.k8s.io/v1 tlsroutes list namespace-scoped, batch/v1 cronjobs update namespace-scoped, " +
					"v1 secrets get namespace-scoped, apps statefulsets/scale update namespace-scoped, configmaps get namespace-scoped]",
			},
		},
	}

	prepared := prepareEventForSend(event, nil)

	require.NotNil(t, prepared)
	require.Equal(t,
		"Capability check gateway.networking.k8s.io/v1 tlsroutes list namespace-scoped slow: 8s",
		prepared.Breadcrumbs[0].Message,
	)
	require.Equal(t, "configmap [resource] failed", prepared.Breadcrumbs[1].Message)
	operation := prepared.Contexts["error"]["operation"]
	require.Contains(t, operation, "gateway.networking.k8s.io/v1 tlsroutes list namespace-scoped")
	require.Contains(t, operation, "batch/v1 cronjobs update namespace-scoped")
	require.Contains(t, operation, "v1 secrets get namespace-scoped")
	require.Contains(t, operation, "apps statefulsets/scale update namespace-scoped")
	require.Contains(t, operation, "configmaps get namespace-scoped")
	require.Contains(t, operation, "[url]")
	require.Contains(t, operation, "[host]")
	require.Contains(t, operation, "configmap [resource] failed")
	require.NotContains(t, operation, "api.private.test")
	require.NotContains(t, operation, "node.private.internal")
	require.NotContains(t, operation, "customer-prod")
	require.NotContains(t, operation, "top-secret")
}

func TestReporterAppliesPrivacyBoundaryBeforeTransport(t *testing.T) {
	transport := &recordingTransport{}
	reporter, err := New(Config{
		DSN:       "https://public@example.com/1",
		Transport: transport,
	})
	require.NoError(t, err)

	reporter.CaptureException(
		errors.New("cluster production-us failed with token=top-secret"),
		Context{
			Source:      "ResourceLoader",
			ClusterID:   "production-us",
			ClusterName: "Acme Production",
		},
	)

	event := transport.lastEvent()
	require.NotNil(t, event)
	require.Equal(t, "cluster-1", event.Tags["cluster.alias"])
	require.NotContains(t, event.Tags, "clusterId")
	require.NotContains(t, event.Tags, "clusterName")

	payload, err := json.Marshal(event)
	require.NoError(t, err)
	require.NotContains(t, string(payload), "production-us")
	require.NotContains(t, string(payload), "Acme Production")
	require.NotContains(t, string(payload), "top-secret")
	require.Contains(t, string(payload), "cluster-1")
}

func TestReporterRedactsTypedCustomResourceNameAndKeepsStructuredOperation(t *testing.T) {
	transport := &recordingTransport{}
	reporter, err := New(Config{
		DSN:       "https://public@example.com/1",
		Transport: transport,
	})
	require.NoError(t, err)

	statusErr := apierrors.NewForbidden(
		schema.GroupResource{Group: "storage.example.com", Resource: "databasebackups"},
		"customer-prod-backup-7",
		errors.New("access denied"),
	)
	reporter.CaptureException(statusErr, Context{
		Source: "ResourceLoader",
		Operation: NewKubernetesRequestOperation(KubernetesRequest{
			Action:   KubernetesActionGet,
			Group:    "storage.example.com",
			Version:  "v1alpha1",
			Resource: "databasebackups",
			Scope:    KubernetesScopeNamespaced,
		}),
	})

	event := transport.lastEvent()
	require.NotNil(t, event)
	require.NotContains(t, event.Exception[0].Value, "customer-prod-backup-7")
	require.Contains(t, event.Exception[0].Value, "[resource]")
	require.Equal(t, map[string]any{
		"type":     "kubernetes.request",
		"action":   "get",
		"group":    "storage.example.com",
		"version":  "v1alpha1",
		"resource": "databasebackups",
		"scope":    "namespaced",
	}, event.Contexts["error"]["operation"])
}

func TestReporterBreadcrumbsUseAnAllowlistedSchema(t *testing.T) {
	transport := &recordingTransport{}
	reporter, err := New(Config{
		DSN:       "https://public@example.com/1",
		Transport: transport,
	})
	require.NoError(t, err)

	reporter.AddBreadcrumb(Breadcrumb{
		Category:    "Refresh",
		Message:     "refresh started",
		OperationID: "refresh-1",
		Data: map[string]any{
			"clusterId":   "production-us",
			"clusterName": "Acme Production",
			"requestBody": `{"token":"top-secret"}`,
			"futureField": "not reviewed for telemetry",
		},
	})
	reporter.CaptureException(errors.New("refresh failed"), Context{
		ClusterID:   "production-us",
		OperationID: "refresh-1",
	})

	event := transport.lastEvent()
	require.NotNil(t, event)
	require.Len(t, event.Breadcrumbs, 1)
	require.Equal(t, map[string]any{
		"cluster.alias": "cluster-1",
		"operationId":   "refresh-1",
	}, event.Breadcrumbs[0].Data)
}
