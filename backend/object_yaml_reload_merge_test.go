package backend

import (
	"context"
	"fmt"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/util/mergepatch"
)

// Merge into draft takes only the draft's own edits onto the live object: a
// field someone else changed that the draft never touched keeps the live value
// instead of failing as a conflict or being reverted to the stale draft value.
func TestMergeObjectYamlWithLatestKeepsLiveChangesTheDraftDidNotMake(t *testing.T) {
	app, dynamicClient, clusterID := setupYAMLTestApp(t)
	gvr := appsv1.SchemeGroupVersion.WithResource("deployments")
	live, err := dynamicClient.Resource(gvr).Namespace("default").Get(context.Background(), "demo", metav1.GetOptions{})
	require.NoError(t, err)
	live.SetResourceVersion("99")
	require.NoError(t, unstructured.SetNestedField(live.Object, int64(3), "spec", "replicas"))
	require.NoError(t, dynamicClient.Tracker().Update(gvr, live, "default"))

	response, err := app.MergeObjectYamlWithLatest(clusterID, ObjectYAMLReloadMergeRequest{
		BaseYAML: deploymentYAML("42", "nginx:1.25"), DraftYAML: deploymentYAML("42", "nginx:1.26"),
		Kind: "Deployment", APIVersion: "apps/v1", Namespace: "default", Name: "demo", UID: "demo-uid",
	})

	require.NoError(t, err)
	require.Nil(t, response.YAMLConflict)
	merged, err := parseYAMLToUnstructured(response.MergedYAML)
	require.NoError(t, err)
	replicas, _, _ := unstructured.NestedInt64(merged.Object, "spec", "replicas")
	require.Equal(t, int64(3), replicas)
	require.Equal(t, map[string]string{"app": "nginx:1.26"}, mergedContainerImages(t, merged))
}

func TestReloadMergeAppliesOnlyTheDraftsEdits(t *testing.T) {
	deploymentGVK := appsv1.SchemeGroupVersion.WithKind("Deployment")

	t.Run("a container the live object added stays beside the draft's image edit", func(t *testing.T) {
		merged, err := mergeReloadDraft(t, deploymentGVK,
			listDeploymentYAML(nil, "app=nginx:1.25"),
			listDeploymentYAML(nil, "app=nginx:1.26"),
			listDeploymentYAML(nil, "app=nginx:1.25", "sidecar=proxy:1.0"),
		)

		require.NoError(t, err)
		require.Equal(t, map[string]string{"app": "nginx:1.26", "sidecar": "proxy:1.0"}, mergedContainerImages(t, merged))
	})

	t.Run("finalizers both sides added and removed all apply", func(t *testing.T) {
		merged, err := mergeReloadDraft(t, deploymentGVK,
			listDeploymentYAML([]string{"a", "b"}, "app=nginx:1.25"),
			// The draft removes b and adds d.
			listDeploymentYAML([]string{"a", "d"}, "app=nginx:1.25"),
			// Someone else removed a and added c.
			listDeploymentYAML([]string{"b", "c"}, "app=nginx:1.25"),
		)

		require.NoError(t, err)
		require.ElementsMatch(t, []string{"c", "d"}, merged.GetFinalizers())
	})

	widgetGVK := schema.GroupVersionKind{Group: "example.com", Version: "v1", Kind: "Widget"}

	t.Run("a custom resource keeps live changes the draft did not make", func(t *testing.T) {
		merged, err := mergeReloadDraft(t, widgetGVK, widgetYAML(2, "blue"), widgetYAML(2, "green"), widgetYAML(1, "blue"))

		require.NoError(t, err)
		size, _, _ := unstructured.NestedInt64(merged.Object, "spec", "size")
		color, _, _ := unstructured.NestedString(merged.Object, "spec", "color")
		require.Equal(t, int64(1), size)
		require.Equal(t, "green", color)
	})

	t.Run("a custom resource field both sides changed differently conflicts", func(t *testing.T) {
		_, err := mergeReloadDraft(t, widgetGVK, widgetYAML(2, "blue"), widgetYAML(2, "green"), widgetYAML(2, "red"))

		require.True(t, mergepatch.IsConflict(err), "expected a merge conflict, got %v", err)
	})
}

// mergeReloadDraft runs the reload merge on parsed baseline, draft, and live
// documents, returning the merged object or the patch error.
func mergeReloadDraft(t *testing.T, gvk schema.GroupVersionKind, baseYAML, draftYAML, liveYAML string) (*unstructured.Unstructured, error) {
	t.Helper()
	parse := func(content string) *unstructured.Unstructured {
		obj, err := parseYAMLToUnstructured(content)
		require.NoError(t, err)
		return obj
	}
	live := parse(liveYAML)
	patch, patchMeta, err := buildReloadMergePatch(gvk, parse(baseYAML), parse(draftYAML), live)
	if err != nil {
		return nil, err
	}
	return applyReloadMergePatch(live, patch, patchMeta)
}

func mergedContainerImages(t *testing.T, obj *unstructured.Unstructured) map[string]string {
	t.Helper()
	containers, _, err := unstructured.NestedSlice(obj.Object, "spec", "template", "spec", "containers")
	require.NoError(t, err)
	images := map[string]string{}
	for _, item := range containers {
		container := item.(map[string]interface{})
		images[container["name"].(string)] = container["image"].(string)
	}
	return images
}

// listDeploymentYAML builds a Deployment with the given finalizers and
// "name=image" containers.
func listDeploymentYAML(finalizers []string, containers ...string) string {
	var b strings.Builder
	b.WriteString("apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: demo\n  namespace: default\n")
	if len(finalizers) > 0 {
		b.WriteString("  finalizers:\n")
		for _, finalizer := range finalizers {
			fmt.Fprintf(&b, "    - %s\n", finalizer)
		}
	}
	b.WriteString("spec:\n  template:\n    spec:\n      containers:\n")
	for _, container := range containers {
		name, image, _ := strings.Cut(container, "=")
		fmt.Fprintf(&b, "        - name: %s\n          image: %s\n", name, image)
	}
	return b.String()
}

func widgetYAML(size int, color string) string {
	return "apiVersion: example.com/v1\nkind: Widget\nmetadata:\n  name: demo\n  namespace: default\n" +
		fmt.Sprintf("spec:\n  size: %d\n  color: %s\n", size, color)
}
