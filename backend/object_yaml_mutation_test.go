package backend

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"testing"

	"github.com/evanphx/json-patch/v5"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	apiextensionsfake "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset/fake"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/apimachinery/pkg/util/strategicpatch"
	"k8s.io/apimachinery/pkg/util/validation/field"
	fakediscovery "k8s.io/client-go/discovery/fake"
	dynamicfake "k8s.io/client-go/dynamic/fake"
	clientfake "k8s.io/client-go/kubernetes/fake"
	cgotesting "k8s.io/client-go/testing"
	"k8s.io/utils/ptr"
)

func setupYAMLTestApp(t *testing.T) (*App, *dynamicfake.FakeDynamicClient, string) {
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
			UID:             types.UID("demo-uid"),
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

	client := clientfake.NewClientset(initialDeployment.DeepCopy())
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
	dynamicClient.Fake.PrependReactor("patch", "*", func(action cgotesting.Action) (bool, runtime.Object, error) {
		patchAction := action.(cgotesting.PatchActionImpl)
		current, err := dynamicClient.Tracker().Get(
			patchAction.GetResource(),
			patchAction.GetNamespace(),
			patchAction.GetName(),
		)
		if err != nil {
			return true, nil, err
		}

		currentObj := current.(*unstructured.Unstructured)
		currentJSON, err := json.Marshal(currentObj.Object)
		if err != nil {
			return true, nil, err
		}

		var patchedJSON []byte
		switch patchAction.GetPatchType() {
		case types.MergePatchType:
			patchedJSON, err = jsonpatch.MergePatch(currentJSON, patchAction.GetPatch())
		case types.StrategicMergePatchType:
			patchedJSON, err = strategicpatch.StrategicMergePatch(currentJSON, patchAction.GetPatch(), &appsv1.Deployment{})
		default:
			return true, nil, fmt.Errorf("unexpected patch type %s", patchAction.GetPatchType())
		}
		if err != nil {
			return true, nil, err
		}

		patchedObj := &unstructured.Unstructured{}
		if err := patchedObj.UnmarshalJSON(patchedJSON); err != nil {
			return true, nil, err
		}

		if len(patchAction.GetPatchOptions().DryRun) > 0 {
			patchedObj.SetResourceVersion(currentObj.GetResourceVersion())
			return true, patchedObj, nil
		}

		patchedObj.SetResourceVersion(nextResourceVersion(currentObj.GetResourceVersion()))
		if err := dynamicClient.Tracker().Update(patchAction.GetResource(), patchedObj, patchAction.GetNamespace()); err != nil {
			return true, nil, err
		}
		return true, patchedObj, nil
	})
	app := NewApp()
	app.Ctx = context.Background()
	apiExtClient := apiextensionsfake.NewClientset()
	clusterID := "config:ctx"
	// Per-cluster clients are stored in clusterClients, not in global fields.
	app.clusterClients = map[string]*clusterClients{
		clusterID: {
			meta:                ClusterMeta{ID: clusterID, Name: "ctx"},
			kubeconfigPath:      "/path",
			kubeconfigContext:   "ctx",
			client:              client,
			dynamicClient:       dynamicClient,
			apiextensionsClient: apiExtClient,
		},
	}

	// discovery.Resources above advertises apps/v1 Deployment so
	// getGVRForGVKWithDependencies (via common.ResolveGVRForGVK) can
	// resolve the GVR without needing a GVR cache to seed.

	return app, dynamicClient, clusterID
}

func nextResourceVersion(current string) string {
	value, err := strconv.Atoi(current)
	if err != nil {
		return current
	}
	return strconv.Itoa(value + 1)
}

func TestValidateObjectYamlSuccess(t *testing.T) {
	app, _, clusterID := setupYAMLTestApp(t)

	request := ObjectYAMLMutationRequest{
		BaseYAML: baseYAML(),
		YAML: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo
  namespace: default
  uid: demo-uid
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
		UID:             "demo-uid",
		ResourceVersion: "42",
	}

	response, err := app.ValidateObjectYaml(clusterID, request)
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

func TestValidateObjectYamlAllowsLiveResourceVersionDrift(t *testing.T) {
	app, dynamicClient, clusterID := setupYAMLTestApp(t)

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
		BaseYAML: baseYAML(),
		YAML: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo
  namespace: default
  uid: demo-uid
  resourceVersion: "42"
spec:
  replicas: 3
`,
		Kind:            "Deployment",
		APIVersion:      "apps/v1",
		Namespace:       "default",
		Name:            "demo",
		UID:             "demo-uid",
		ResourceVersion: "42",
	}

	response, err := app.ValidateObjectYaml(clusterID, request)
	if err != nil {
		t.Fatalf("expected validation to succeed despite live resourceVersion drift: %v", err)
	}
	if response == nil || response.ResourceVersion != "99" {
		t.Fatalf("expected dry-run validation to reflect live resourceVersion 99, got %#v", response)
	}
}

func TestApplyObjectYamlSuccess(t *testing.T) {
	app, _, clusterID := setupYAMLTestApp(t)

	request := ObjectYAMLMutationRequest{
		BaseYAML: baseYAML(),
		YAML: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo
  namespace: default
  uid: demo-uid
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
		UID:             "demo-uid",
		ResourceVersion: "42",
	}

	response, err := app.ApplyObjectYaml(clusterID, request)
	if err != nil {
		t.Fatalf("apply failed: %v", err)
	}
	if response.ResourceVersion != "43" {
		t.Fatalf("expected new resourceVersion 43 in apply response, got %q", response.ResourceVersion)
	}
}

func TestApplyObjectYamlPatchesAgainstLatestObject(t *testing.T) {
	app, dynamicClient, clusterID := setupYAMLTestApp(t)

	resource := dynamicClient.Resource(appsv1.SchemeGroupVersion.WithResource("deployments")).Namespace("default")
	live, err := resource.Get(context.Background(), "demo", metav1.GetOptions{})
	if err != nil {
		t.Fatalf("failed to get live deployment: %v", err)
	}
	live.SetResourceVersion("99")
	live.SetAnnotations(map[string]string{"syncedAt": "now"})
	if err := dynamicClient.Tracker().Update(appsv1.SchemeGroupVersion.WithResource("deployments"), live, "default"); err != nil {
		t.Fatalf("failed to update live deployment: %v", err)
	}

	request := ObjectYAMLMutationRequest{
		BaseYAML:        baseYAML(),
		YAML:            strings.Replace(baseYAML(), "nginx:1.26", "nginx:1.27", 1),
		Kind:            "Deployment",
		APIVersion:      "apps/v1",
		Namespace:       "default",
		Name:            "demo",
		UID:             "demo-uid",
		ResourceVersion: "42",
	}

	response, err := app.ApplyObjectYaml(clusterID, request)
	if err != nil {
		t.Fatalf("expected apply to succeed despite live drift: %v", err)
	}
	if response.ResourceVersion != "100" {
		t.Fatalf("expected apply to increment live resourceVersion to 100, got %q", response.ResourceVersion)
	}

	updated, err := resource.Get(context.Background(), "demo", metav1.GetOptions{})
	if err != nil {
		t.Fatalf("failed to fetch updated deployment: %v", err)
	}
	if updated.GetAnnotations()["syncedAt"] != "now" {
		t.Fatalf("expected live annotations to be preserved, got %#v", updated.GetAnnotations())
	}
	containers, _, err := unstructured.NestedSlice(updated.Object, "spec", "template", "spec", "containers")
	if err != nil || len(containers) == 0 {
		t.Fatalf("expected updated containers, got %#v err=%v", containers, err)
	}
	first, ok := containers[0].(map[string]interface{})
	if !ok {
		t.Fatalf("expected first container map, got %#v", containers[0])
	}
	if first["image"] != "nginx:1.27" {
		t.Fatalf("expected image nginx:1.27, got %#v", first["image"])
	}
}

func TestMergeObjectYamlWithLatestStrategicMergesBuiltInLists(t *testing.T) {
	app, dynamicClient, clusterID := setupYAMLTestApp(t)
	resource := dynamicClient.Resource(appsv1.SchemeGroupVersion.WithResource("deployments")).Namespace("default")
	liveDeployment, err := resource.Get(context.Background(), "demo", metav1.GetOptions{})
	if err != nil {
		t.Fatalf("failed to fetch deployment: %v", err)
	}
	liveDeployment.SetResourceVersion("99")
	liveDeployment.SetAnnotations(map[string]string{"syncedAt": "now"})
	if err := unstructured.SetNestedSlice(liveDeployment.Object, []interface{}{
		map[string]interface{}{
			"name":  "app",
			"image": "nginx:1.25",
			"resources": map[string]interface{}{
				"limits": map[string]interface{}{
					"cpu": "1",
				},
			},
		},
	}, "spec", "template", "spec", "containers"); err != nil {
		t.Fatalf("failed to set containers: %v", err)
	}
	if err := dynamicClient.Tracker().Update(appsv1.SchemeGroupVersion.WithResource("deployments"), liveDeployment, "default"); err != nil {
		t.Fatalf("failed to seed live deployment: %v", err)
	}

	response, err := app.MergeObjectYamlWithLatest(clusterID, ObjectYAMLReloadMergeRequest{
		BaseYAML:   deploymentYAML("42", "nginx:1.25"),
		DraftYAML:  deploymentYAML("42", "nginx:1.26"),
		Kind:       "Deployment",
		APIVersion: "apps/v1",
		Namespace:  "default",
		Name:       "demo",
		UID:        "demo-uid",
	})
	if err != nil {
		t.Fatalf("MergeObjectYamlWithLatest returned error: %v", err)
	}
	if response.ResourceVersion != "99" {
		t.Fatalf("expected merged response to use live resourceVersion 99, got %q", response.ResourceVersion)
	}
	if !strings.Contains(response.CurrentYAML, "syncedAt: now") {
		t.Fatalf("expected current YAML to include latest annotations, got %q", response.CurrentYAML)
	}
	if !strings.Contains(response.MergedYAML, "image: nginx:1.26") {
		t.Fatalf("expected merged YAML to keep local image edit, got %q", response.MergedYAML)
	}
	if !strings.Contains(response.MergedYAML, "cpu: \"1\"") {
		t.Fatalf("expected merged YAML to keep live container resources, got %q", response.MergedYAML)
	}
	if !strings.Contains(response.MergedYAML, "resourceVersion: \"99\"") {
		t.Fatalf("expected merged YAML to use live resourceVersion, got %q", response.MergedYAML)
	}
}

func TestMergeObjectYamlWithLatestRejectsConflictingBuiltInListEdits(t *testing.T) {
	app, dynamicClient, clusterID := setupYAMLTestApp(t)
	resource := dynamicClient.Resource(appsv1.SchemeGroupVersion.WithResource("deployments")).Namespace("default")
	liveDeployment, err := resource.Get(context.Background(), "demo", metav1.GetOptions{})
	if err != nil {
		t.Fatalf("failed to fetch deployment: %v", err)
	}
	liveDeployment.SetResourceVersion("99")
	if err := unstructured.SetNestedSlice(liveDeployment.Object, []interface{}{
		map[string]interface{}{
			"name":  "app",
			"image": "nginx:1.27",
		},
	}, "spec", "template", "spec", "containers"); err != nil {
		t.Fatalf("failed to set containers: %v", err)
	}
	if err := dynamicClient.Tracker().Update(appsv1.SchemeGroupVersion.WithResource("deployments"), liveDeployment, "default"); err != nil {
		t.Fatalf("failed to seed live deployment: %v", err)
	}

	_, err = app.MergeObjectYamlWithLatest(clusterID, ObjectYAMLReloadMergeRequest{
		BaseYAML:   deploymentYAML("42", "nginx:1.25"),
		DraftYAML:  deploymentYAML("42", "nginx:1.26"),
		Kind:       "Deployment",
		APIVersion: "apps/v1",
		Namespace:  "default",
		Name:       "demo",
		UID:        "demo-uid",
	})
	if err == nil {
		t.Fatalf("expected reload merge conflict")
	}

	var objErr *objectYAMLError
	if !errors.As(err, &objErr) {
		t.Fatalf("expected objectYAMLError, got %T", err)
	}
	if objErr.Code != objectYAMLMergeConflictCode {
		t.Fatalf("expected merge conflict code %q, got %q", objectYAMLMergeConflictCode, objErr.Code)
	}
	if objErr.CurrentResourceVersion != "99" {
		t.Fatalf("expected live resourceVersion 99, got %q", objErr.CurrentResourceVersion)
	}
	if !strings.Contains(objErr.CurrentYAML, "image: nginx:1.27") {
		t.Fatalf("expected conflict payload to include live YAML, got %q", objErr.CurrentYAML)
	}
}

func TestMergeObjectYamlWithLatestDetectsUIDMismatch(t *testing.T) {
	app, dynamicClient, clusterID := setupYAMLTestApp(t)
	resource := dynamicClient.Resource(appsv1.SchemeGroupVersion.WithResource("deployments")).Namespace("default")
	liveDeployment, err := resource.Get(context.Background(), "demo", metav1.GetOptions{})
	if err != nil {
		t.Fatalf("failed to fetch deployment: %v", err)
	}
	liveDeployment.SetUID(types.UID("replacement-uid"))
	liveDeployment.SetResourceVersion("99")
	if err := dynamicClient.Tracker().Update(appsv1.SchemeGroupVersion.WithResource("deployments"), liveDeployment, "default"); err != nil {
		t.Fatalf("failed to seed replacement deployment: %v", err)
	}

	_, err = app.MergeObjectYamlWithLatest(clusterID, ObjectYAMLReloadMergeRequest{
		BaseYAML:   deploymentYAML("42", "nginx:1.25"),
		DraftYAML:  deploymentYAML("42", "nginx:1.26"),
		Kind:       "Deployment",
		APIVersion: "apps/v1",
		Namespace:  "default",
		Name:       "demo",
		UID:        "demo-uid",
	})
	if err == nil {
		t.Fatalf("expected reload merge uid mismatch")
	}

	var objErr *objectYAMLError
	if !errors.As(err, &objErr) {
		t.Fatalf("expected objectYAMLError, got %T", err)
	}
	if objErr.Code != "ObjectUIDMismatch" {
		t.Fatalf("expected ObjectUIDMismatch code, got %q", objErr.Code)
	}
	if !strings.Contains(objErr.Message, "current uid is replacement-uid") {
		t.Fatalf("unexpected uid mismatch message: %q", objErr.Message)
	}
}

func TestValidateObjectYamlForbiddenError(t *testing.T) {
	app, dynamicClient, clusterID := setupYAMLTestApp(t)

	dynamicClient.Fake.PrependReactor("patch", "*", func(action cgotesting.Action) (bool, runtime.Object, error) {
		patchAction := action.(cgotesting.PatchActionImpl)
		return true, nil, apierrors.NewForbidden(
			schema.GroupResource{Group: "apps", Resource: "deployments"},
			patchAction.GetResource().Resource,
			fmt.Errorf("update forbidden"),
		)
	})

	request := ObjectYAMLMutationRequest{
		BaseYAML:        baseYAML(),
		YAML:            baseYAML(),
		Kind:            "Deployment",
		APIVersion:      "apps/v1",
		Namespace:       "default",
		Name:            "demo",
		UID:             "demo-uid",
		ResourceVersion: "42",
	}

	_, err := app.ValidateObjectYaml(clusterID, request)
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

func TestValidateObjectYamlDetectsUIDDrift(t *testing.T) {
	app, dynamicClient, clusterID := setupYAMLTestApp(t)

	resource := dynamicClient.Resource(appsv1.SchemeGroupVersion.WithResource("deployments")).Namespace("default")
	live, err := resource.Get(context.Background(), "demo", metav1.GetOptions{})
	if err != nil {
		t.Fatalf("failed to get live object: %v", err)
	}
	live.SetUID(types.UID("replacement-uid"))
	live.SetResourceVersion("99")
	if err := dynamicClient.Tracker().Update(appsv1.SchemeGroupVersion.WithResource("deployments"), live, "default"); err != nil {
		t.Fatalf("failed to update live object: %v", err)
	}

	request := ObjectYAMLMutationRequest{
		BaseYAML: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo
  namespace: default
  uid: demo-uid
  resourceVersion: "42"
spec:
  replicas: 3
`,
		YAML: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo
  namespace: default
  uid: demo-uid
  resourceVersion: "42"
spec:
  replicas: 3
`,
		Kind:            "Deployment",
		APIVersion:      "apps/v1",
		Namespace:       "default",
		Name:            "demo",
		UID:             "demo-uid",
		ResourceVersion: "42",
	}

	_, err = app.ValidateObjectYaml(clusterID, request)
	if err == nil {
		t.Fatalf("expected validation to fail due to uid drift")
	}
	var objErr *objectYAMLError
	if !errors.As(err, &objErr) {
		t.Fatalf("expected objectYAMLError, got %T", err)
	}
	if objErr.Code != "ObjectUIDMismatch" {
		t.Fatalf("expected ObjectUIDMismatch code, got %s", objErr.Code)
	}
	if !strings.Contains(objErr.Message, "current uid is replacement-uid") {
		t.Fatalf("unexpected uid mismatch message: %q", objErr.Message)
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

func TestSanitizeForUpdateStripsServerManagedMetadata(t *testing.T) {
	obj := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"kind":       "ConfigMap",
			"apiVersion": "v1",
			"metadata": map[string]interface{}{
				"name":                       "cfg",
				"uid":                        "uid",
				"managedFields":              "x",
				"selfLink":                   "link",
				"creationTimestamp":          "now",
				"deletionTimestamp":          "soon",
				"deletionGracePeriodSeconds": int64(5),
				"generation":                 int64(2),
			},
			"status": map[string]interface{}{"state": "ignore"},
			"data":   map[string]interface{}{"a": "b"},
		},
	}

	sanitized := sanitizeForUpdate(obj, "77")
	metadata, _, err := unstructured.NestedMap(sanitized.Object, "metadata")
	if err != nil {
		t.Fatalf("failed to read metadata: %v", err)
	}
	for _, key := range []string{
		"uid",
		"managedFields",
		"selfLink",
		"creationTimestamp",
		"deletionTimestamp",
		"deletionGracePeriodSeconds",
		"generation",
	} {
		if _, exists := metadata[key]; exists {
			t.Fatalf("expected %s to be stripped, got %#v", key, metadata)
		}
	}
	if sanitized.GetResourceVersion() != "77" {
		t.Fatalf("expected resourceVersion 77, got %q", sanitized.GetResourceVersion())
	}
}

func TestWrapKubernetesErrorFormatsStatusErrors(t *testing.T) {
	statusErr := apierrors.NewInvalid(
		schema.GroupKind{Group: "apps", Kind: "Deployment"},
		"demo",
		field.ErrorList{
			field.Required(field.NewPath("spec", "replicas"), "field required"),
		},
	)

	wrapped := wrapKubernetesError(statusErr, "apply failed")
	objErr, ok := wrapped.(*objectYAMLError)
	if !ok {
		t.Fatalf("expected objectYAMLError, got %T", wrapped)
	}
	if objErr.Code != string(statusErr.ErrStatus.Reason) {
		t.Fatalf("unexpected error code: %s", objErr.Code)
	}
	if len(objErr.Causes) == 0 {
		t.Fatalf("expected causes to be populated")
	}
	if !strings.Contains(objErr.Causes[0], "spec.replicas") {
		t.Fatalf("expected field in causes, got %#v", objErr.Causes)
	}
}

func TestWrapKubernetesErrorFormatsFieldManagerConflicts(t *testing.T) {
	statusErr := apierrors.NewApplyConflict(
		[]metav1.StatusCause{
			{
				Type:    metav1.CauseTypeFieldManagerConflict,
				Field:   "spec.replicas",
				Message: `conflict with "deployment-controller" using apps/v1 at 2026-04-16T00:00:00Z`,
			},
		},
		`Apply failed with 1 conflict: conflict with "deployment-controller": .spec.replicas`,
	)

	wrapped := wrapKubernetesError(statusErr, "apply failed")
	objErr, ok := wrapped.(*objectYAMLError)
	if !ok {
		t.Fatalf("expected objectYAMLError, got %T", wrapped)
	}
	if objErr.Code != string(metav1.StatusReasonConflict) {
		t.Fatalf("unexpected error code: %s", objErr.Code)
	}
	expectedMessage := "Server-side apply found field ownership conflicts. Reload the latest object or remove the conflicting field edits listed below."
	if objErr.Message != expectedMessage {
		t.Fatalf("expected conflict summary %q, got %q", expectedMessage, objErr.Message)
	}
	if len(objErr.Causes) != 1 {
		t.Fatalf("expected one conflict cause, got %#v", objErr.Causes)
	}
	if objErr.Causes[0] != `spec.replicas: conflict with "deployment-controller" using apps/v1 at 2026-04-16T00:00:00Z` {
		t.Fatalf("unexpected formatted conflict cause: %#v", objErr.Causes)
	}
}

func TestWrapKubernetesErrorUsesDefaultMessage(t *testing.T) {
	err := errors.New("boom")
	wrapped := wrapKubernetesError(err, "apply failed")
	if wrapped == nil || !strings.Contains(wrapped.Error(), "apply failed") {
		t.Fatalf("expected wrapped error to include default message")
	}
}

func TestGetGVRForGVKFallsBackToCache(t *testing.T) {
	app, _, clusterID := setupYAMLTestApp(t)

	gvr, namespaced, err := app.getGVRForGVK(context.Background(), clusterID, schema.GroupVersionKind{
		Group:   "apps",
		Version: "v1",
		Kind:    "Deployment",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if gvr.Resource != "deployments" || gvr.Group != "apps" || gvr.Version != "v1" {
		t.Fatalf("unexpected GVR: %#v", gvr)
	}
	if !namespaced {
		t.Fatalf("expected namespaced resource")
	}
}

func TestGetGVRForGVKWithoutClientFails(t *testing.T) {
	app := NewApp()
	_, _, err := app.getGVRForGVK(context.Background(), "missing", schema.GroupVersionKind{Kind: "Deployment"})
	if err == nil {
		t.Fatalf("expected error for missing client")
	}
}

func baseYAML() string {
	return "apiVersion: apps/v1\n" +
		"kind: Deployment\n" +
		"metadata:\n" +
		"  name: demo\n" +
		"  namespace: default\n" +
		"  uid: demo-uid\n" +
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

func deploymentYAML(resourceVersion, image string) string {
	return "apiVersion: apps/v1\n" +
		"kind: Deployment\n" +
		"metadata:\n" +
		"  name: demo\n" +
		"  namespace: default\n" +
		fmt.Sprintf("  resourceVersion: %q\n", resourceVersion) +
		"spec:\n" +
		"  replicas: 1\n" +
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
		fmt.Sprintf("          image: %s\n", image)
}
