package backend

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	apiextensionsfake "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset/fake"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	fakediscovery "k8s.io/client-go/discovery/fake"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	clientfake "k8s.io/client-go/kubernetes/fake"
	kubetesting "k8s.io/client-go/testing"
	"k8s.io/utils/ptr"
)

func setupYAMLTestApp(t *testing.T) (*App, *dynamicfake.FakeDynamicClient) {
	t.Helper()

	scheme := runtime.NewScheme()
	if err := appsv1.AddToScheme(scheme); err != nil {
		t.Fatalf("failed to register apps scheme: %v", err)
	}
	if err := corev1.AddToScheme(scheme); err != nil {
		t.Fatalf("failed to register core scheme: %v", err)
	}

	initialDeployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:            "demo",
			Namespace:       "default",
			ResourceVersion: "42",
			Labels:          map[string]string{"app": "demo"},
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: ptr.To[int32](1),
			Selector: &metav1.LabelSelector{MatchLabels: map[string]string{"app": "demo"}},
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{Labels: map[string]string{"app": "demo"}},
				Spec: corev1.PodSpec{
					Containers: []corev1.Container{{Name: "app", Image: "nginx:1.25"}},
				},
			},
		},
		Status: appsv1.DeploymentStatus{
			Replicas: 1,
		},
	}

	client := clientfake.NewSimpleClientset(initialDeployment.DeepCopy())
	discovery := client.Discovery().(*fakediscovery.FakeDiscovery)
	discovery.Resources = []*metav1.APIResourceList{
		{
			GroupVersion: "apps/v1",
			APIResources: []metav1.APIResource{
				{
					Name:         "deployments",
					SingularName: "deployment",
					Namespaced:   true,
					Kind:         "Deployment",
				},
			},
		},
	}

	dynamicClient := dynamicfake.NewSimpleDynamicClient(scheme, initialDeployment.DeepCopyObject())
	updateCalls := 0
	dynamicClient.Fake.PrependReactor("update", "*", func(action kubetesting.Action) (bool, runtime.Object, error) {
		updateAction := action.(kubetesting.UpdateAction)
		obj := updateAction.GetObject().(*unstructured.Unstructured)
		copyObj := obj.DeepCopy()
		updateCalls++
		if updateCalls > 1 {
			copyObj.SetResourceVersion("43")
		}
		if updateCalls == 1 {
			return true, copyObj, nil
		}
		if err := dynamicClient.Tracker().Update(updateAction.GetResource(), copyObj, updateAction.GetNamespace()); err != nil {
			return true, nil, err
		}
		return true, copyObj, nil
	})
	app := NewApp()
	app.Ctx = context.Background()
	app.client = client
	app.dynamicClient = dynamicClient
	app.apiextensionsClient = apiextensionsfake.NewSimpleClientset()

	gvrCacheMutex.Lock()
	original, hadOriginal := gvrCache["Deployment"]
	gvrCache["Deployment"] = gvrCacheEntry{
		gvr: schema.GroupVersionResource{
			Group:    "apps",
			Version:  "v1",
			Resource: "deployments",
		},
		namespaced: true,
	}
	gvrCacheMutex.Unlock()

	t.Cleanup(func() {
		gvrCacheMutex.Lock()
		defer gvrCacheMutex.Unlock()
		if hadOriginal {
			gvrCache["Deployment"] = original
		} else {
			delete(gvrCache, "Deployment")
		}
	})

	return app, dynamicClient
}

func TestValidateObjectYamlSuccess(t *testing.T) {
	app, _ := setupYAMLTestApp(t)

	request := ObjectYAMLMutationRequest{
		YAML: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo
  namespace: default
  resourceVersion: "42"
spec:
  replicas: 2
  selector:
    matchLabels:
      app: demo
  template:
    metadata:
      labels:
        app: demo
    spec:
      containers:
        - name: app
          image: nginx:1.26
`,
		Kind:            "Deployment",
		APIVersion:      "apps/v1",
		Namespace:       "default",
		Name:            "demo",
		ResourceVersion: "42",
	}

	response, err := app.ValidateObjectYaml(request)
	if err != nil {
		t.Fatalf("ValidateObjectYaml returned error: %v", err)
	}
	if response == nil {
		t.Fatalf("expected validation response, got nil")
	}
	if response.ResourceVersion == "" {
		t.Fatalf("expected resourceVersion in response")
	}
}

func TestValidateObjectYamlDetectsResourceVersionDrift(t *testing.T) {
	app, dynamicClient := setupYAMLTestApp(t)

	// Bump live resourceVersion to simulate drift.
	resource := dynamicClient.Resource(appsv1.SchemeGroupVersion.WithResource("deployments")).Namespace("default")
	live, err := resource.Get(context.Background(), "demo", metav1.GetOptions{})
	if err != nil {
		t.Fatalf("failed to get live object: %v", err)
	}
	live.SetResourceVersion("99")
	if err := dynamicClient.Tracker().Update(appsv1.SchemeGroupVersion.WithResource("deployments"), live, "default"); err != nil {
		t.Fatalf("failed to update live object: %v", err)
	}

	request := ObjectYAMLMutationRequest{
		YAML: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo
  namespace: default
  resourceVersion: "42"
spec:
  replicas: 3
`,
		Kind:            "Deployment",
		APIVersion:      "apps/v1",
		Namespace:       "default",
		Name:            "demo",
		ResourceVersion: "42",
	}

	_, err = app.ValidateObjectYaml(request)
	if err == nil {
		t.Fatalf("expected validation to fail due to resourceVersion drift")
	}
	if !strings.Contains(err.Error(), "resourceVersion") {
		t.Fatalf("expected resourceVersion error, got %v", err)
	}
}

func TestApplyObjectYamlSuccess(t *testing.T) {
	app, _ := setupYAMLTestApp(t)

	request := ObjectYAMLMutationRequest{
		YAML: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo
  namespace: default
  resourceVersion: "42"
spec:
  replicas: 4
  selector:
    matchLabels:
      app: demo
  template:
    metadata:
      labels:
        app: demo
    spec:
      containers:
        - name: app
          image: nginx:1.27
`,
		Kind:            "Deployment",
		APIVersion:      "apps/v1",
		Namespace:       "default",
		Name:            "demo",
		ResourceVersion: "42",
	}

	validation, err := app.ValidateObjectYaml(request)
	if err != nil {
		t.Fatalf("validation failed: %v", err)
	}
	// Align with returned resourceVersion (fake dynamic client may mutate on dry-run).
	request.ResourceVersion = validation.ResourceVersion
	request.YAML = strings.Replace(request.YAML, `"42"`, fmt.Sprintf(`"%s"`, validation.ResourceVersion), 1)

	response, err := app.ApplyObjectYaml(request)
	if err != nil {
		t.Fatalf("apply failed: %v", err)
	}
	if response.ResourceVersion == "" {
		t.Fatalf("expected new resourceVersion in apply response")
	}
}

func TestValidateObjectYamlForbiddenError(t *testing.T) {
	app, dynamicClient := setupYAMLTestApp(t)

	dynamicClient.Fake.PrependReactor("update", "*", func(action kubetesting.Action) (bool, runtime.Object, error) {
		updateAction := action.(kubetesting.UpdateAction)
		return true, nil, apierrors.NewForbidden(
			schema.GroupResource{Group: "apps", Resource: "deployments"},
			updateAction.GetResource().Resource,
			fmt.Errorf("update forbidden"),
		)
	})

	request := ObjectYAMLMutationRequest{
		YAML:            baseYAML(),
		Kind:            "Deployment",
		APIVersion:      "apps/v1",
		Namespace:       "default",
		Name:            "demo",
		ResourceVersion: "42",
	}

	_, err := app.ValidateObjectYaml(request)
	if err == nil {
		t.Fatalf("expected validation to return error")
	}

	var objErr *objectYAMLError
	if !errors.As(err, &objErr) {
		t.Fatalf("expected objectYAMLError, got %T", err)
	}

	if objErr.Code != string(metav1.StatusReasonForbidden) {
		t.Fatalf("expected code %s, got %s", metav1.StatusReasonForbidden, objErr.Code)
	}
	if len(objErr.Causes) != 0 {
		t.Fatalf("expected no causes for simple forbidden error, got %v", objErr.Causes)
	}
}

func TestNamespaceLabel(t *testing.T) {
	if got := namespaceLabel(""); got != "<cluster-scoped>" {
		t.Fatalf("expected cluster scoped label, got %q", got)
	}
	if got := namespaceLabel("ns"); got != "ns" {
		t.Fatalf("expected namespace passthrough, got %q", got)
	}
}

func TestNormalizeObjectYAMLStripsMetadata(t *testing.T) {
	obj := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"kind":       "ConfigMap",
			"apiVersion": "v1",
			"metadata": map[string]interface{}{
				"name":                       "cfg",
				"managedFields":              "x",
				"selfLink":                   "link",
				"uid":                        "uid",
				"creationTimestamp":          "now",
				"deletionTimestamp":          "soon",
				"deletionGracePeriodSeconds": int64(5),
				"generation":                 int64(2),
			},
			"status": map[string]interface{}{"state": "ignore"},
			"data":   map[string]interface{}{"a": "b"},
		},
	}

	normalized, err := normalizeObjectYAML(obj)
	if err != nil {
		t.Fatalf("normalize error: %v", err)
	}
	for _, field := range []string{"managedFields", "selfLink", "uid", "creationTimestamp", "deletionTimestamp", "status"} {
		if strings.Contains(normalized, field) {
			t.Fatalf("expected %s to be stripped, got %s", field, normalized)
		}
	}
	if !strings.Contains(normalized, "data:\n  a: b") {
		t.Fatalf("expected data to remain, got %s", normalized)
	}
}

func TestComputeDiffLinesTruncatesLargeInput(t *testing.T) {
	large := strings.Repeat("line\n", maxDiffLineCount)
	lines, truncated := computeDiffLines(large, large)
	if !truncated || lines != nil {
		t.Fatalf("expected truncation for large diff")
	}
}

func baseYAML() string {
	return "apiVersion: apps/v1\n" +
		"kind: Deployment\n" +
		"metadata:\n" +
		"  name: demo\n" +
		"  namespace: default\n" +
		"  resourceVersion: \"42\"\n" +
		"spec:\n" +
		"  replicas: 2\n" +
		"  selector:\n" +
		"    matchLabels:\n" +
		"      app: demo\n" +
		"  template:\n" +
		"    metadata:\n" +
		"      labels:\n" +
		"        app: demo\n" +
		"    spec:\n" +
		"      containers:\n" +
		"        - name: app\n" +
		"          image: nginx:1.26\n"
}
