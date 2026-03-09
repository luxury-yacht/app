# CreateResourceModal File I/O & Cluster Import — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add Open/Save/Save As file operations and an Import-from-Cluster picker to the CreateResourceModal.

**Architecture:** Backend-centric approach — Go methods use Wails native file dialogs and Kubernetes dynamic client; frontend adds context bar action buttons and a dedicated ImportResourcePicker overlay component. YAML is always the single source of truth.

**Tech Stack:** Go (Wails v2 runtime dialogs, client-go dynamic client), React/TypeScript (CodeMirror, existing Dropdown component, Vitest)

**Design doc:** `docs/plans/2026-03-08-create-modal-file-io-import-design.md`

---

### Task 1: Backend — File Open/Save Methods

Create `backend/object_yaml_file_io.go` with three methods for file I/O using Wails native dialogs.

**Files:**
- Create: `backend/object_yaml_file_io.go`
- Create: `backend/object_yaml_file_io_test.go`
- Reference: `backend/kubeconfigs.go:203-213` (existing dialog pattern)
- Reference: `backend/app.go` (App struct, Ctx field)

**Step 1: Write the test file**

```go
// backend/object_yaml_file_io_test.go
package backend

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSaveResourceFile_WritesContent(t *testing.T) {
	app := &App{}
	dir := t.TempDir()
	path := filepath.Join(dir, "test.yaml")

	err := app.SaveResourceFile(path, "apiVersion: v1\nkind: ConfigMap\n")
	if err != nil {
		t.Fatalf("SaveResourceFile returned error: %v", err)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("failed to read written file: %v", err)
	}
	if string(data) != "apiVersion: v1\nkind: ConfigMap\n" {
		t.Errorf("file content mismatch: got %q", string(data))
	}
}

func TestSaveResourceFile_ErrorOnInvalidPath(t *testing.T) {
	app := &App{}
	err := app.SaveResourceFile("/nonexistent/dir/file.yaml", "content")
	if err == nil {
		t.Error("expected error for invalid path, got nil")
	}
}
```

**Step 2: Run tests to verify they fail**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./backend/ -run TestSaveResourceFile -v`
Expected: FAIL — `SaveResourceFile` does not exist yet.

**Step 3: Write the implementation**

```go
// backend/object_yaml_file_io.go
package backend

import (
	"fmt"
	"os"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// FileResult holds the path and content returned from a file open dialog.
type FileResult struct {
	Path    string `json:"path"`
	Content string `json:"content"`
}

// yamlFileFilters restricts file dialogs to YAML and JSON manifests.
var yamlFileFilters = []wailsruntime.FileFilter{
	{DisplayName: "YAML Files (*.yaml, *.yml)", Pattern: "*.yaml;*.yml"},
	{DisplayName: "JSON Files (*.json)", Pattern: "*.json"},
	{DisplayName: "All Files (*.*)", Pattern: "*.*"},
}

// OpenResourceFile opens a native file dialog for the user to select a
// YAML/JSON manifest, reads it, and returns the path and content.
// Returns an empty FileResult if the user cancels.
func (a *App) OpenResourceFile() (*FileResult, error) {
	if a.Ctx == nil {
		return nil, fmt.Errorf("application context is not available")
	}

	path, err := wailsruntime.OpenFileDialog(a.Ctx, wailsruntime.OpenDialogOptions{
		Title:   "Open Resource Manifest",
		Filters: yamlFileFilters,
	})
	if err != nil {
		return nil, fmt.Errorf("file dialog failed: %w", err)
	}

	// User cancelled the dialog.
	if path == "" {
		return &FileResult{}, nil
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read file: %w", err)
	}

	return &FileResult{Path: path, Content: string(data)}, nil
}

// SaveResourceFile writes content to the given file path.
// Used for "Save" when the file path is already known.
func (a *App) SaveResourceFile(path string, content string) error {
	if path == "" {
		return fmt.Errorf("file path is required")
	}
	return os.WriteFile(path, []byte(content), 0644)
}

// SaveResourceFileAs opens a native save dialog and writes content to the
// selected path. Returns the chosen path, or empty string if cancelled.
func (a *App) SaveResourceFileAs(content string) (string, error) {
	if a.Ctx == nil {
		return "", fmt.Errorf("application context is not available")
	}

	path, err := wailsruntime.SaveFileDialog(a.Ctx, wailsruntime.SaveDialogOptions{
		Title:           "Save Resource Manifest",
		DefaultFilename: "resource.yaml",
		Filters:         yamlFileFilters,
	})
	if err != nil {
		return "", fmt.Errorf("file dialog failed: %w", err)
	}

	// User cancelled the dialog.
	if path == "" {
		return "", nil
	}

	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		return "", fmt.Errorf("failed to write file: %w", err)
	}

	return path, nil
}
```

**Step 4: Run tests to verify they pass**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./backend/ -run TestSaveResourceFile -v`
Expected: PASS

**Step 5: Run full backend tests + vet**

Run: `cd /Volumes/git/luxury-yacht/app && go vet ./backend/... && go test ./backend/... -count=1`
Expected: All pass, no vet issues.

**Step 6: Commit**

```
feat: add backend file I/O methods for resource manifests

Adds OpenResourceFile, SaveResourceFile, and SaveResourceFileAs to
support opening and saving YAML/JSON files via native OS dialogs.
```

---

### Task 2: Backend — Cluster Import Methods

Create `backend/object_yaml_import.go` with methods for kind discovery, object listing, and YAML export.

**Files:**
- Create: `backend/object_yaml_import.go`
- Create: `backend/object_yaml_import_test.go`
- Reference: `backend/object_yaml_creation.go:113-191` (field stripping, GVR resolution)
- Reference: `backend/object_yaml_mutation.go:281-317` (parseYAMLToUnstructured)
- Reference: `backend/object_yaml_creation.go:197-280` (resolveGVRStrict discovery pattern)

**Step 1: Write the test file**

```go
// backend/object_yaml_import_test.go
package backend

import (
	"testing"
)

func TestCategorizeAPIResource(t *testing.T) {
	tests := []struct {
		group    string
		kind     string
		expected string
	}{
		{"apps", "Deployment", "Workloads"},
		{"", "Service", "Networking"},
		{"", "ConfigMap", "Config"},
		{"", "Secret", "Config"},
		{"batch", "Job", "Workloads"},
		{"networking.k8s.io", "Ingress", "Networking"},
		{"rbac.authorization.k8s.io", "ClusterRole", "Access Control"},
		{"storage.k8s.io", "StorageClass", "Storage"},
		{"custom.example.com", "Widget", "Custom Resources"},
	}
	for _, tt := range tests {
		t.Run(tt.kind, func(t *testing.T) {
			got := categorizeAPIResource(tt.group, tt.kind)
			if got != tt.expected {
				t.Errorf("categorizeAPIResource(%q, %q) = %q, want %q", tt.group, tt.kind, got, tt.expected)
			}
		})
	}
}

func TestStripServerFields(t *testing.T) {
	// Verify that server-managed fields are removed from an unstructured object.
	obj := map[string]interface{}{
		"apiVersion": "v1",
		"kind":       "ConfigMap",
		"metadata": map[string]interface{}{
			"name":                       "test",
			"namespace":                  "default",
			"resourceVersion":            "12345",
			"uid":                        "abc-123",
			"creationTimestamp":           "2026-01-01T00:00:00Z",
			"managedFields":              []interface{}{},
			"selfLink":                   "/api/v1/namespaces/default/configmaps/test",
			"generation":                 int64(1),
			"deletionTimestamp":          "2026-01-02T00:00:00Z",
			"deletionGracePeriodSeconds": int64(30),
			"ownerReferences":            []interface{}{},
			"annotations": map[string]interface{}{
				"kubectl.kubernetes.io/last-applied-configuration": "{}",
				"my-custom-annotation": "keep-me",
			},
		},
		"status": map[string]interface{}{},
		"data": map[string]interface{}{
			"key": "value",
		},
	}

	stripServerFields(obj)

	meta, _ := obj["metadata"].(map[string]interface{})
	if meta["resourceVersion"] != nil {
		t.Error("resourceVersion should be stripped")
	}
	if meta["uid"] != nil {
		t.Error("uid should be stripped")
	}
	if meta["creationTimestamp"] != nil {
		t.Error("creationTimestamp should be stripped")
	}
	if meta["managedFields"] != nil {
		t.Error("managedFields should be stripped")
	}
	if meta["selfLink"] != nil {
		t.Error("selfLink should be stripped")
	}
	if meta["generation"] != nil {
		t.Error("generation should be stripped")
	}
	if meta["deletionTimestamp"] != nil {
		t.Error("deletionTimestamp should be stripped")
	}
	if meta["deletionGracePeriodSeconds"] != nil {
		t.Error("deletionGracePeriodSeconds should be stripped")
	}
	if meta["ownerReferences"] != nil {
		t.Error("ownerReferences should be stripped")
	}
	if obj["status"] != nil {
		t.Error("status should be stripped")
	}
	// Verify kubectl annotation is stripped but custom annotations are preserved.
	annotations, _ := meta["annotations"].(map[string]interface{})
	if annotations["kubectl.kubernetes.io/last-applied-configuration"] != nil {
		t.Error("kubectl last-applied-configuration annotation should be stripped")
	}
	if annotations["my-custom-annotation"] != "keep-me" {
		t.Error("custom annotations should be preserved")
	}
	// Preserved fields.
	if meta["name"] != "test" {
		t.Error("name should be preserved")
	}
	if meta["namespace"] != "default" {
		t.Error("namespace should be preserved")
	}
	data, _ := obj["data"].(map[string]interface{})
	if data["key"] != "value" {
		t.Error("data should be preserved")
	}
}

func TestGroupFromAPIVersion(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"v1", ""},
		{"apps/v1", "apps"},
		{"networking.k8s.io/v1", "networking.k8s.io"},
		{"rbac.authorization.k8s.io/v1", "rbac.authorization.k8s.io"},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := groupFromAPIVersion(tt.input)
			if got != tt.expected {
				t.Errorf("groupFromAPIVersion(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}

func TestVersionFromAPIVersion(t *testing.T) {
	tests := []struct {
		input    string
		expected string
	}{
		{"v1", "v1"},
		{"apps/v1", "v1"},
		{"networking.k8s.io/v1beta1", "v1beta1"},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := versionFromAPIVersion(tt.input)
			if got != tt.expected {
				t.Errorf("versionFromAPIVersion(%q) = %q, want %q", tt.input, got, tt.expected)
			}
		})
	}
}
```

**Step 2: Run tests to verify they fail**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./backend/ -run "TestCategorizeAPIResource|TestStripServerFields|TestGroupFromAPIVersion|TestVersionFromAPIVersion" -v`
Expected: FAIL — functions do not exist yet.

**Step 3: Write the implementation**

```go
// backend/object_yaml_import.go
package backend

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/rest"
	"sigs.k8s.io/yaml"
)

// ResourceKindInfo describes a resource kind available on a cluster.
type ResourceKindInfo struct {
	Kind       string `json:"kind"`
	APIVersion string `json:"apiVersion"`
	Resource   string `json:"resource"`   // plural resource name for API calls
	Namespaced bool   `json:"namespaced"`
	Category   string `json:"category"`
}

// ObjectSummary is a lightweight representation of a cluster object for the import picker.
type ObjectSummary struct {
	Name              string `json:"name"`
	Namespace         string `json:"namespace"`
	Kind              string `json:"kind"`
	APIVersion        string `json:"apiVersion"`
	CreationTimestamp string `json:"creationTimestamp"`
}

// GetClusterResourceKinds returns all available resource kinds on a cluster,
// sorted and categorized for the import picker dropdown.
func (a *App) GetClusterResourceKinds(clusterID string) ([]ResourceKindInfo, error) {
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	if deps.KubernetesClient == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	// Use a timeout-safe discovery client.
	discoveryClient := deps.KubernetesClient.Discovery()
	if deps.RestConfig != nil {
		cfg := rest.CopyConfig(deps.RestConfig)
		cfg.Timeout = mutationRequestTimeout
		if dc, err := discovery.NewDiscoveryClientForConfig(cfg); err == nil {
			discoveryClient = dc
		}
	}

	_, apiResourceLists, err := discoveryClient.ServerGroupsAndResources()
	if err != nil && deps.Logger != nil {
		deps.Logger.Debug(fmt.Sprintf("ServerGroupsAndResources partial error: %v", err), "ResourceImport")
	}

	// Deduplicate by kind+group — prefer the first version encountered
	// (ServerGroupsAndResources returns preferred versions first).
	seen := make(map[string]bool)
	var kinds []ResourceKindInfo

	for _, apiResourceList := range apiResourceLists {
		gv, parseErr := schema.ParseGroupVersion(apiResourceList.GroupVersion)
		if parseErr != nil {
			continue
		}
		for _, apiResource := range apiResourceList.APIResources {
			// Skip sub-resources (e.g., pods/log).
			if strings.Contains(apiResource.Name, "/") {
				continue
			}
			// Skip resources that cannot be listed or gotten.
			verbs := apiResource.Verbs
			if !containsVerb(verbs, "list") || !containsVerb(verbs, "get") {
				continue
			}

			key := fmt.Sprintf("%s/%s", gv.Group, apiResource.Kind)
			if seen[key] {
				continue
			}
			seen[key] = true

			apiVersion := gv.String()
			kinds = append(kinds, ResourceKindInfo{
				Kind:       apiResource.Kind,
				APIVersion: apiVersion,
				Resource:   apiResource.Name,
				Namespaced: apiResource.Namespaced,
				Category:   categorizeAPIResource(gv.Group, apiResource.Kind),
			})
		}
	}

	// Sort by category, then kind.
	sort.Slice(kinds, func(i, j int) bool {
		if kinds[i].Category != kinds[j].Category {
			return kinds[i].Category < kinds[j].Category
		}
		return kinds[i].Kind < kinds[j].Kind
	})

	return kinds, nil
}

// ListClusterObjectsByKind lists objects of a given kind in a cluster,
// optionally filtered by namespace.
func (a *App) ListClusterObjectsByKind(clusterID string, kind ResourceKindInfo, namespace string) ([]ObjectSummary, error) {
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	if deps.DynamicClient == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}

	gvr := schema.GroupVersionResource{
		Group:    groupFromAPIVersion(kind.APIVersion),
		Version:  versionFromAPIVersion(kind.APIVersion),
		Resource: kind.Resource,
	}

	ctx, cancel := context.WithTimeout(a.CtxOrBackground(), mutationRequestTimeout)
	defer cancel()

	var client = deps.DynamicClient.Resource(gvr)
	var list *unstructured.UnstructuredList

	// Limit results to avoid overwhelming the frontend on large clusters.
	// The import picker is for browsing, not bulk export.
	listOpts := metav1.ListOptions{Limit: 500}

	if kind.Namespaced && namespace != "" {
		list, err = client.Namespace(namespace).List(ctx, listOpts)
	} else {
		list, err = client.List(ctx, listOpts)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to list %s: %w", kind.Kind, err)
	}

	summaries := make([]ObjectSummary, 0, len(list.Items))
	for _, item := range list.Items {
		ts := ""
		if ct := item.GetCreationTimestamp(); !ct.IsZero() {
			ts = ct.Format(time.RFC3339)
		}
		// Use kind info from the input parameter — individual items in an
		// UnstructuredList typically don't have kind/apiVersion set.
		summaries = append(summaries, ObjectSummary{
			Name:              item.GetName(),
			Namespace:         item.GetNamespace(),
			Kind:              kind.Kind,
			APIVersion:        kind.APIVersion,
			CreationTimestamp: ts,
		})
	}

	// Sort by namespace, then name.
	sort.Slice(summaries, func(i, j int) bool {
		if summaries[i].Namespace != summaries[j].Namespace {
			return summaries[i].Namespace < summaries[j].Namespace
		}
		return summaries[i].Name < summaries[j].Name
	})

	return summaries, nil
}

// GetClusterObjectYAML fetches a single object from a cluster and returns
// its YAML with server-managed fields stripped, ready for re-creation.
func (a *App) GetClusterObjectYAML(clusterID string, kind ResourceKindInfo, namespace string, name string) (string, error) {
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return "", err
	}
	if deps.DynamicClient == nil {
		return "", fmt.Errorf("kubernetes client not initialized")
	}

	gvr := schema.GroupVersionResource{
		Group:    groupFromAPIVersion(kind.APIVersion),
		Version:  versionFromAPIVersion(kind.APIVersion),
		Resource: kind.Resource,
	}

	ctx, cancel := context.WithTimeout(a.CtxOrBackground(), mutationRequestTimeout)
	defer cancel()

	var obj *unstructured.Unstructured
	if kind.Namespaced && namespace != "" {
		obj, err = deps.DynamicClient.Resource(gvr).Namespace(namespace).Get(ctx, name, metav1.GetOptions{})
	} else {
		obj, err = deps.DynamicClient.Resource(gvr).Get(ctx, name, metav1.GetOptions{})
	}
	if err != nil {
		return "", fmt.Errorf("failed to get %s/%s: %w", kind.Kind, name, err)
	}

	// Strip server-managed fields so the YAML is suitable for re-creation.
	stripServerFields(obj.Object)

	yamlBytes, err := yaml.Marshal(obj.Object)
	if err != nil {
		return "", fmt.Errorf("failed to serialize object to YAML: %w", err)
	}

	return string(yamlBytes), nil
}

// stripServerFields removes server-managed fields from an unstructured object
// so it can be used as a creation template.
func stripServerFields(obj map[string]interface{}) {
	meta, ok := obj["metadata"].(map[string]interface{})
	if ok {
		delete(meta, "resourceVersion")
		delete(meta, "uid")
		delete(meta, "creationTimestamp")
		delete(meta, "managedFields")
		delete(meta, "selfLink")
		delete(meta, "generation")
		// Remove deletion-related fields — importing an object mid-deletion
		// would cause a 422 on create.
		delete(meta, "deletionTimestamp")
		delete(meta, "deletionGracePeriodSeconds")
		// Remove owner references — they point to objects that may not exist
		// in the target cluster/namespace.
		delete(meta, "ownerReferences")
		// Remove annotations that are server-generated.
		if annotations, aOk := meta["annotations"].(map[string]interface{}); aOk {
			delete(annotations, "kubectl.kubernetes.io/last-applied-configuration")
			if len(annotations) == 0 {
				delete(meta, "annotations")
			}
		}
	}
	delete(obj, "status")
}

// categorizeAPIResource assigns a category to a resource based on its API group and kind.
func categorizeAPIResource(group string, kind string) string {
	// Core workload resources.
	switch group {
	case "apps", "batch":
		return "Workloads"
	case "networking.k8s.io":
		return "Networking"
	case "rbac.authorization.k8s.io":
		return "Access Control"
	case "storage.k8s.io":
		return "Storage"
	case "policy":
		return "Policy"
	case "autoscaling":
		return "Autoscaling"
	}

	// Core API group (group == "").
	if group == "" {
		switch kind {
		case "Pod", "ReplicationController":
			return "Workloads"
		case "Service", "Endpoints", "EndpointSlice":
			return "Networking"
		case "ConfigMap", "Secret", "ServiceAccount":
			return "Config"
		case "PersistentVolume", "PersistentVolumeClaim":
			return "Storage"
		case "Namespace", "Node", "Event", "LimitRange", "ResourceQuota":
			return "Cluster"
		}
	}

	// CRDs and unknown groups.
	if strings.Contains(group, ".") {
		return "Custom Resources"
	}

	return "Other"
}

// containsVerb checks if a verb list includes a given verb.
func containsVerb(verbs []string, verb string) bool {
	for _, v := range verbs {
		if v == verb {
			return true
		}
	}
	return false
}

// groupFromAPIVersion extracts the group from an apiVersion string.
// For core resources (e.g., "v1"), returns empty string.
func groupFromAPIVersion(apiVersion string) string {
	parts := strings.SplitN(apiVersion, "/", 2)
	if len(parts) == 1 {
		return ""
	}
	return parts[0]
}

// versionFromAPIVersion extracts the version from an apiVersion string.
func versionFromAPIVersion(apiVersion string) string {
	parts := strings.SplitN(apiVersion, "/", 2)
	if len(parts) == 1 {
		return parts[0]
	}
	return parts[1]
}
```

**Step 4: Run tests to verify they pass**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./backend/ -run "TestCategorizeAPIResource|TestStripServerFields|TestGroupFromAPIVersion|TestVersionFromAPIVersion" -v`
Expected: PASS

**Step 5: Run full backend tests + vet**

Run: `cd /Volumes/git/luxury-yacht/app && go vet ./backend/... && go test ./backend/... -count=1`
Expected: All pass.

**Step 6: Commit**

```
feat: add backend cluster import methods for resource manifests

Adds GetClusterResourceKinds, ListClusterObjectsByKind, and
GetClusterObjectYAML for browsing and importing existing cluster
objects into the create resource editor.
```

---

### Task 3: Frontend — Wails Bindings Regeneration

After adding the new Go methods, regenerate the Wails TypeScript bindings so the frontend can call them.

**Files:**
- Modify (auto-generated): `frontend/wailsjs/go/backend/App.js`
- Modify (auto-generated): `frontend/wailsjs/go/backend/App.d.ts`
- Modify (auto-generated): `frontend/wailsjs/go/models.ts`

**Step 1: Regenerate Wails bindings**

Run: `cd /Volumes/git/luxury-yacht/app && wails generate module`

If `wails generate module` is not available or fails, manually add the binding stubs. The generated files follow a strict pattern — every public method on `*App` gets a one-line JS wrapper and a corresponding `.d.ts` declaration.

**Step 2: Verify the new functions appear in bindings**

Run: `grep -E "OpenResourceFile|SaveResourceFile|SaveResourceFileAs|GetClusterResourceKinds|ListClusterObjectsByKind|GetClusterObjectYAML" /Volumes/git/luxury-yacht/app/frontend/wailsjs/go/backend/App.d.ts`

Expected: All 6 new function declarations present.

**Step 3: Verify TypeScript compiles**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx tsc --noEmit`
Expected: No errors.

**Step 4: Commit**

```
chore: regenerate Wails bindings for file I/O and import methods
```

---

### Task 4: Frontend — Icon Components

Add SVG icon components for the new context bar buttons: Open, Save, Save As, and Import.

**Files:**
- Modify: `frontend/src/shared/components/icons/MenuIcons.tsx`
- Reference: existing icon patterns in that file (all follow the same `React.FC<IconProps>` SVG pattern)

**Step 1: Add four icon components**

Add to the bottom of `MenuIcons.tsx` (before the file's last line, after the last existing icon):

```tsx
// File I/O icons for the CreateResourceModal context bar.
export const FolderOpenIcon: React.FC<IconProps> = ({ width = 16, height = 16 }) => (
  <svg width={width} height={height} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M1.5 3a.5.5 0 0 1 .5-.5h4.586a.5.5 0 0 1 .353.146L8.354 4.06a.5.5 0 0 0 .353.147H13.5a.5.5 0 0 1 .5.5v1.086H2V3.5A.5.5 0 0 1 1.5 3ZM1 6.793V12.5a.5.5 0 0 0 .5.5h12a.5.5 0 0 0 .5-.5V6.793H1Z" fill="currentColor" />
  </svg>
);

export const SaveIcon: React.FC<IconProps> = ({ width = 16, height = 16 }) => (
  <svg width={width} height={height} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M2 2.5A.5.5 0 0 1 2.5 2h8.793l2.707 2.707V13.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11ZM5 3v3h5V3H5Zm3 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" fill="currentColor" />
  </svg>
);

export const SaveAsIcon: React.FC<IconProps> = ({ width = 16, height = 16 }) => (
  <svg width={width} height={height} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M2 2.5A.5.5 0 0 1 2.5 2h8.793l2.707 2.707V13.5a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11ZM5 3v3h5V3H5Zm3 6a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z" fill="currentColor" />
    <circle cx="13" cy="13" r="3" fill="var(--color-bg)" />
    <path d="M13 11v4m-2-2h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

export const ImportIcon: React.FC<IconProps> = ({ width = 16, height = 16 }) => (
  <svg width={width} height={height} viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M8 1.5v8m0 0L5.5 7m2.5 2.5L10.5 7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M3 10.5v2.5a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V10.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);
```

**Step 2: Verify TypeScript compiles**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx tsc --noEmit`
Expected: No errors.

**Step 3: Commit**

```
feat: add file I/O and import icon components
```

---

### Task 5: Frontend — File Open/Save Integration in CreateResourceModal

Wire up the Open, Save, and Save As buttons in the modal's context bar with state tracking and keyboard shortcuts.

**Files:**
- Modify: `frontend/src/ui/modals/CreateResourceModal.tsx`
- Modify: `frontend/src/ui/modals/CreateResourceModal.css`

**Step 1: Add imports and state**

At the top of `CreateResourceModal.tsx`, add to the Wails import block:

```tsx
import {
  GetResourceTemplates,
  ValidateResourceCreation,
  CreateResource,
  OpenResourceFile,
  SaveResourceFile,
  SaveResourceFileAs,
} from '@wailsjs/go/backend/App';
```

Add to the icon imports:

```tsx
import { CloseIcon, FolderOpenIcon, SaveIcon, SaveAsIcon, ImportIcon } from '@shared/components/icons/MenuIcons';
```

Inside the component, after the existing `isCreating` state (around line 159), add:

```tsx
// File I/O state.
const [currentFilePath, setCurrentFilePath] = useState<string | null>(null);
const [fileError, setFileError] = useState<string | null>(null);

// Import picker state.
const [isImportPickerOpen, setIsImportPickerOpen] = useState(false);
```

Add an auto-dismiss effect for file errors (clears after 5 seconds):

```tsx
// Auto-dismiss file errors after 5 seconds.
useEffect(() => {
  if (!fileError) return;
  const timer = setTimeout(() => setFileError(null), 5000);
  return () => clearTimeout(timer);
}, [fileError]);
```

In the reset block inside the `useEffect` for `isOpen` (around line 202-217), add the new state resets:

```tsx
setCurrentFilePath(null);
setFileError(null);
setIsImportPickerOpen(false);
```

**Step 2: Add handler functions**

After `handleCreate` (around line 588), add:

```tsx
// File Open handler — loads a manifest from disk into the editor.
const handleFileOpen = useCallback(async () => {
  setFileError(null);
  try {
    const result = await OpenResourceFile();
    if (!result || !result.path) return; // User cancelled.
    setYamlContent(result.content);
    setCurrentFilePath(result.path);
    setSelectedTemplate('Custom');
    setActiveView('yaml');
    setValidationSuccess(null);
    setValidationError(null);
    setRawError(null);
    // Sync namespace from the loaded file's YAML.
    const ns = extractNamespaceFromYaml(result.content);
    if (ns !== null) setSelectedNamespace(ns);
    // Warn if the file contains multiple YAML documents.
    if (result.content.includes('\n---\n') || result.content.startsWith('---\n')) {
      setFileError('File contains multiple YAML documents — only the first will be used for creation.');
    }
  } catch (err) {
    setFileError(err instanceof Error ? err.message : String(err));
  }
}, [extractNamespaceFromYaml]);

// File Save handler — saves to current path, or opens Save As dialog.
const handleFileSave = useCallback(async () => {
  setFileError(null);
  try {
    if (currentFilePath) {
      await SaveResourceFile(currentFilePath, yamlContent);
    } else {
      const path = await SaveResourceFileAs(yamlContent);
      if (path) setCurrentFilePath(path);
    }
  } catch (err) {
    setFileError(err instanceof Error ? err.message : String(err));
  }
}, [currentFilePath, yamlContent]);

// File Save As handler — always opens a save dialog.
const handleFileSaveAs = useCallback(async () => {
  setFileError(null);
  try {
    const path = await SaveResourceFileAs(yamlContent);
    if (path) setCurrentFilePath(path);
  } catch (err) {
    setFileError(err instanceof Error ? err.message : String(err));
  }
}, [yamlContent]);

// Import handler — receives YAML from the ImportResourcePicker.
const handleImportComplete = useCallback((importedYaml: string, kind: string, name: string) => {
  setYamlContent(importedYaml);
  setSelectedTemplate(`Imported: ${kind}/${name}`);
  setActiveView('yaml');
  setCurrentFilePath(null);
  setValidationSuccess(null);
  setValidationError(null);
  setRawError(null);
  setIsImportPickerOpen(false);
  const ns = extractNamespaceFromYaml(importedYaml);
  if (ns !== null) setSelectedNamespace(ns);
}, [extractNamespaceFromYaml]);
```

**Step 3: Add keyboard shortcuts**

After the existing `useShortcut` for Escape (around line 285), add:

```tsx
// File I/O keyboard shortcuts — only active when modal is open.
useShortcut({
  key: 'o',
  metaKey: true,
  handler: () => { if (isOpen) { handleFileOpen(); return true; } return false; },
  description: 'Open resource file',
  category: 'Modals',
  enabled: isOpen,
  view: 'global',
  priority: KeyboardContextPriority.CREATE_RESOURCE_MODAL,
});

useShortcut({
  key: 's',
  metaKey: true,
  handler: () => { if (isOpen) { handleFileSave(); return true; } return false; },
  description: 'Save resource file',
  category: 'Modals',
  enabled: isOpen,
  view: 'global',
  priority: KeyboardContextPriority.CREATE_RESOURCE_MODAL,
});

useShortcut({
  key: 's',
  metaKey: true,
  shiftKey: true,
  handler: () => { if (isOpen) { handleFileSaveAs(); return true; } return false; },
  description: 'Save resource file as',
  category: 'Modals',
  enabled: isOpen,
  view: 'global',
  priority: KeyboardContextPriority.CREATE_RESOURCE_MODAL,
});
```

**Step 4: Add context bar buttons to the JSX**

In the context bar div (around line 618-655), add the file action buttons. Place them after the "Show YAML" button but before the closing `</div>` of `create-resource-context-bar`:

```tsx
{/* File I/O and Import action buttons */}
<div className="create-resource-actions">
  <button
    type="button"
    className="create-resource-action-btn"
    onClick={handleFileOpen}
    title="Open file (Cmd+O)"
    data-create-resource-focusable="true"
  >
    <FolderOpenIcon />
  </button>
  <button
    type="button"
    className="create-resource-action-btn"
    onClick={handleFileSave}
    title={currentFilePath ? `Save (Cmd+S) — ${currentFilePath}` : 'Save (Cmd+S)'}
    data-create-resource-focusable="true"
  >
    <SaveIcon />
  </button>
  <button
    type="button"
    className="create-resource-action-btn"
    onClick={handleFileSaveAs}
    title="Save As (Cmd+Shift+S)"
    data-create-resource-focusable="true"
  >
    <SaveAsIcon />
  </button>
  <button
    type="button"
    className="create-resource-action-btn"
    onClick={() => setIsImportPickerOpen(true)}
    disabled={!hasCluster}
    title={hasCluster ? 'Import from cluster' : 'Connect to a cluster first'}
    data-create-resource-focusable="true"
  >
    <ImportIcon />
  </button>
</div>
```

Inside the `.create-resource-actions` div, before the Open button, add the file path display:

```tsx
{/* File path indicator — shown inside the context bar per design doc */}
{currentFilePath && (
  <span className="create-resource-file-path" title={currentFilePath}>
    {currentFilePath.split('/').slice(-2).join('/')}
  </span>
)}
```

After the context bar div (inside the `hasCluster` branch), add the error display:

```tsx
{/* File I/O error — auto-dismissed after 5s */}
{fileError && (
  <div className="create-resource-file-error">{fileError}</div>
)}
```

**Step 5: Add CSS for new elements**

Add to `CreateResourceModal.css`:

```css
/* ── File I/O action buttons ─────────────────────────────────────────── */

.create-resource-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  /* No margin-left: auto — the view toggle's margin-left: auto pushes both
     the toggle and this actions group to the right side together. */
}

.create-resource-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.create-resource-action-btn:hover:not(:disabled) {
  background: var(--color-hover);
  color: var(--color-text);
}

.create-resource-action-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* File path label — shown as subtle inline label in the context bar. */
.create-resource-file-path {
  font-size: 0.75rem;
  color: var(--color-text-tertiary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 150px;
  padding-right: var(--spacing-xs);
  border-right: 1px solid var(--color-border);
  margin-right: var(--spacing-xs);
}

/* File I/O error — auto-dismissed after 5s via useEffect timer. */
.create-resource-file-error {
  padding: var(--spacing-xs) 1rem;
  font-size: 0.8rem;
  color: var(--color-error);
  flex-shrink: 0;
  animation: fade-in 0.2s ease-in;
}

@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
```

Keep the existing `.create-resource-view-toggle` rule unchanged — its `margin-left: auto` pushes both the toggle button and the adjacent actions group to the right side of the context bar.

**Step 6: Verify TypeScript compiles**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx tsc --noEmit`
Expected: No errors.

**Step 7: Run frontend tests**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx vitest run`
Expected: All existing tests pass.

**Step 8: Commit**

```
feat: add Open/Save/Save As file actions to CreateResourceModal

Adds context bar buttons with keyboard shortcuts (Cmd+O, Cmd+S,
Cmd+Shift+S) for opening and saving YAML manifest files via native
OS dialogs. Tracks current file path for quick-save behavior.
```

---

### Task 6: Frontend — ImportResourcePicker Component

Build the import picker overlay for browsing and importing cluster objects.

**Files:**
- Create: `frontend/src/ui/modals/create-resource/ImportResourcePicker.tsx`
- Create: `frontend/src/ui/modals/create-resource/ImportResourcePicker.css`
- Reference: `frontend/src/ui/modals/CreateResourceModal.tsx` (modal pattern, Dropdown usage)
- Reference: `frontend/src/shared/components/dropdowns/Dropdown.tsx`

**Step 1: Create the CSS file**

```css
/* ImportResourcePicker.css — overlay for importing objects from clusters. */

.import-picker-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.import-picker {
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  width: 600px;
  max-width: 90vw;
  max-height: 70vh;
  display: flex;
  flex-direction: column;
  box-shadow: var(--shadow-lg, 0 8px 32px rgba(0, 0, 0, 0.2));
}

.import-picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-md) 1rem;
  border-bottom: 1px solid var(--color-border);
}

.import-picker-header h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}

.import-picker-filters {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) 1rem;
  border-bottom: 1px solid var(--color-border);
}

.import-picker-filter-field {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
}

.import-picker-filter-label {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--color-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.03em;
  white-space: nowrap;
}

.import-picker-search {
  padding: var(--spacing-sm) 1rem;
  border-bottom: 1px solid var(--color-border);
}

.import-picker-search input {
  width: 100%;
  padding: var(--spacing-xs) var(--spacing-sm);
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-bg);
  color: var(--color-text);
  font-size: 0.85rem;
}

.import-picker-search input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.import-picker-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: var(--spacing-xs) 0;
}

.import-picker-item {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  padding: var(--spacing-xs) 1rem;
  cursor: pointer;
  font-size: 0.85rem;
}

.import-picker-item:hover {
  background: var(--color-hover);
}

.import-picker-item.selected {
  background: var(--color-accent-bg, rgba(59, 130, 246, 0.1));
}

.import-picker-item-name {
  flex: 1;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.import-picker-item-namespace {
  color: var(--color-text-secondary);
  font-size: 0.8rem;
  min-width: 100px;
}

.import-picker-empty {
  padding: var(--spacing-lg);
  text-align: center;
  color: var(--color-text-secondary);
  font-size: 0.85rem;
}

.import-picker-error {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) 1rem;
  color: var(--color-error);
  font-size: 0.85rem;
}

.import-picker-retry-btn {
  flex-shrink: 0;
  padding: 2px 8px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: transparent;
  color: var(--color-text-secondary);
  font-size: 0.8rem;
  cursor: pointer;
}

.import-picker-retry-btn:hover {
  background: var(--color-hover);
  color: var(--color-text);
}

.import-picker-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) 1rem;
  border-top: 1px solid var(--color-border);
  background: var(--modal-footer-bg);
}

.import-picker-loading {
  padding: var(--spacing-lg);
  text-align: center;
  color: var(--color-text-secondary);
}
```

**Step 2: Create the component**

```tsx
/**
 * frontend/src/ui/modals/create-resource/ImportResourcePicker.tsx
 *
 * Overlay component for browsing and importing existing cluster objects
 * into the CreateResourceModal's YAML editor.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import './ImportResourcePicker.css';
import { Dropdown } from '@shared/components/dropdowns/Dropdown';
import type { DropdownOption } from '@shared/components/dropdowns/Dropdown';
import { CloseIcon } from '@shared/components/icons/MenuIcons';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import {
  GetClusterResourceKinds,
  ListClusterObjectsByKind,
  GetClusterObjectYAML,
} from '@wailsjs/go/backend/App';
import type { backend } from '@wailsjs/go/models';

interface ImportResourcePickerProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (yaml: string, kind: string, name: string) => void;
  defaultClusterId: string;
}

export const ImportResourcePicker: React.FC<ImportResourcePickerProps> = ({
  isOpen,
  onClose,
  onImport,
  defaultClusterId,
}) => {
  const { selectedClusterIds, getClusterMeta } = useKubeconfig();

  // Picker state.
  const [clusterId, setClusterId] = useState(defaultClusterId);
  const [kinds, setKinds] = useState<backend.ResourceKindInfo[]>([]);
  const [selectedKind, setSelectedKind] = useState<backend.ResourceKindInfo | null>(null);
  const [namespace, setNamespace] = useState('');
  const [debouncedNamespace, setDebouncedNamespace] = useState('');
  const [objects, setObjects] = useState<backend.ObjectSummary[]>([]);
  const [selectedObject, setSelectedObject] = useState<backend.ObjectSummary | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Loading and error states.
  const [isLoadingKinds, setIsLoadingKinds] = useState(false);
  const [isLoadingObjects, setIsLoadingObjects] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ref to guard against concurrent imports (double-click race condition).
  const isImportingRef = useRef(false);

  // Debounce namespace input — avoid firing API calls on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedNamespace(namespace), 300);
    return () => clearTimeout(timer);
  }, [namespace]);

  // Reset state and fetch kinds when picker opens.
  // Combined into a single effect to avoid the double-fetch issue of
  // separate reset + fetch effects both reacting to isOpen.
  useEffect(() => {
    if (!isOpen) return;
    const targetCluster = defaultClusterId;
    setClusterId(targetCluster);
    setKinds([]);
    setSelectedKind(null);
    setNamespace('');
    setDebouncedNamespace('');
    setObjects([]);
    setSelectedObject(null);
    setSearchQuery('');
    setError(null);
    isImportingRef.current = false;

    // Fetch kinds immediately for the default cluster.
    if (!targetCluster) return;
    setIsLoadingKinds(true);
    GetClusterResourceKinds(targetCluster)
      .then((result) => setKinds(result))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setIsLoadingKinds(false));
  }, [isOpen, defaultClusterId]);

  // Fetch kinds when user changes cluster (not on initial open — handled above).
  const handleClusterChange = useCallback((newClusterId: string) => {
    setClusterId(newClusterId);
    setSelectedKind(null);
    setNamespace('');
    setDebouncedNamespace('');
    setObjects([]);
    setSelectedObject(null);
    setError(null);
    setIsLoadingKinds(true);
    GetClusterResourceKinds(newClusterId)
      .then((result) => setKinds(result))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setIsLoadingKinds(false));
  }, []);

  // Fetch objects when kind or debounced namespace changes.
  useEffect(() => {
    if (!isOpen || !clusterId || !selectedKind) {
      setObjects([]);
      return;
    }
    setIsLoadingObjects(true);
    setError(null);
    setSelectedObject(null);
    ListClusterObjectsByKind(clusterId, selectedKind, debouncedNamespace)
      .then((result) => setObjects(result))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setIsLoadingObjects(false));
  }, [isOpen, clusterId, selectedKind, debouncedNamespace]);

  // Cluster dropdown options.
  const clusterOptions: DropdownOption[] = useMemo(
    () =>
      selectedClusterIds.map((id) => {
        const meta = getClusterMeta(id);
        return { value: id, label: meta.name || id };
      }),
    [selectedClusterIds, getClusterMeta]
  );

  // Kind dropdown options — grouped by category.
  const kindOptions: DropdownOption[] = useMemo(() => {
    const opts: DropdownOption[] = [];
    let lastCategory = '';
    for (const k of kinds) {
      if (k.category !== lastCategory) {
        lastCategory = k.category;
        opts.push({
          value: `_header_${k.category}`,
          label: k.category,
          disabled: true,
          group: 'header',
        });
      }
      opts.push({ value: `${k.apiVersion}/${k.kind}`, label: k.kind });
    }
    return opts;
  }, [kinds]);

  // Handle kind dropdown change.
  const handleKindChange = useCallback(
    (value: string | string[]) => {
      const kindKey = Array.isArray(value) ? (value[0] ?? '') : value;
      const found = kinds.find((k) => `${k.apiVersion}/${k.kind}` === kindKey);
      setSelectedKind(found ?? null);
      setNamespace('');
    },
    [kinds]
  );

  // Filter objects by search query.
  const filteredObjects = useMemo(() => {
    if (!searchQuery.trim()) return objects;
    const query = searchQuery.toLowerCase();
    return objects.filter(
      (obj) =>
        obj.name.toLowerCase().includes(query) ||
        obj.namespace.toLowerCase().includes(query)
    );
  }, [objects, searchQuery]);

  // Shared import logic — used by both the Import button and double-click.
  // Uses a ref guard to prevent concurrent imports from race conditions.
  const doImport = useCallback(async (obj: backend.ObjectSummary) => {
    if (!selectedKind || isImportingRef.current) return;
    isImportingRef.current = true;
    setIsImporting(true);
    setError(null);
    try {
      const yaml = await GetClusterObjectYAML(
        clusterId,
        selectedKind,
        obj.namespace,
        obj.name
      );
      onImport(yaml, selectedKind.kind, obj.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      isImportingRef.current = false;
      setIsImporting(false);
    }
  }, [clusterId, selectedKind, onImport]);

  // Handle import button click.
  const handleImport = useCallback(async () => {
    if (!selectedObject) return;
    await doImport(selectedObject);
  }, [selectedObject, doImport]);

  // Handle double-click on an object to import immediately.
  const handleDoubleClick = useCallback(
    (obj: backend.ObjectSummary) => {
      setSelectedObject(obj);
      doImport(obj);
    },
    [doImport]
  );

  if (!isOpen) return null;

  const selectedKindKey = selectedKind ? `${selectedKind.apiVersion}/${selectedKind.kind}` : '';

  return (
    <div className="import-picker-overlay" onClick={onClose}>
      <div className="import-picker" onClick={(e) => e.stopPropagation()}>
        <div className="import-picker-header">
          <h3>Import Resource from Cluster</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>

        <div className="import-picker-filters">
          <div className="import-picker-filter-field">
            <span className="import-picker-filter-label">Cluster</span>
            <Dropdown
              options={clusterOptions}
              value={clusterId}
              onChange={(v) => handleClusterChange(Array.isArray(v) ? (v[0] ?? '') : v)}
              placeholder="Select cluster"
              size="compact"
              ariaLabel="Import cluster"
            />
          </div>
          <div className="import-picker-filter-field">
            <span className="import-picker-filter-label">Kind</span>
            <Dropdown
              options={kindOptions}
              value={selectedKindKey}
              onChange={handleKindChange}
              placeholder={isLoadingKinds ? 'Loading...' : 'Select kind'}
              size="compact"
              ariaLabel="Resource kind"
              disabled={isLoadingKinds}
            />
          </div>
          {selectedKind?.namespaced && (
            <div className="import-picker-filter-field">
              <span className="import-picker-filter-label">Namespace</span>
              <input
                type="text"
                value={namespace}
                onChange={(e) => setNamespace(e.target.value)}
                placeholder="All namespaces"
                className="import-picker-namespace-input"
                style={{
                  padding: '2px 6px',
                  border: '1px solid var(--color-border)',
                  borderRadius: '4px',
                  background: 'var(--color-bg)',
                  color: 'var(--color-text)',
                  fontSize: '0.85rem',
                  width: '140px',
                }}
              />
            </div>
          )}
        </div>

        {selectedKind && (
          <div className="import-picker-search">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name..."
              autoFocus
            />
          </div>
        )}

        <div className="import-picker-list">
          {isLoadingObjects ? (
            <div className="import-picker-loading">Loading objects...</div>
          ) : !selectedKind ? (
            <div className="import-picker-empty">Select a resource kind to browse objects</div>
          ) : filteredObjects.length === 0 ? (
            <div className="import-picker-empty">
              {searchQuery ? 'No matching objects found' : 'No objects found'}
            </div>
          ) : (
            filteredObjects.map((obj) => (
              <div
                key={`${obj.namespace}/${obj.name}`}
                className={`import-picker-item ${selectedObject?.name === obj.name && selectedObject?.namespace === obj.namespace ? 'selected' : ''}`}
                onClick={() => setSelectedObject(obj)}
                onDoubleClick={() => handleDoubleClick(obj)}
              >
                <span className="import-picker-item-name">{obj.name}</span>
                {obj.namespace && (
                  <span className="import-picker-item-namespace">{obj.namespace}</span>
                )}
              </div>
            ))
          )}
        </div>

        {error && (
          <div className="import-picker-error">
            {error}
            <button
              className="import-picker-retry-btn"
              onClick={() => {
                setError(null);
                if (kinds.length === 0 && clusterId) {
                  // Retry kind listing.
                  setIsLoadingKinds(true);
                  GetClusterResourceKinds(clusterId)
                    .then((result) => setKinds(result))
                    .catch((err) => setError(err instanceof Error ? err.message : String(err)))
                    .finally(() => setIsLoadingKinds(false));
                } else if (selectedKind) {
                  // Retry object listing.
                  setIsLoadingObjects(true);
                  ListClusterObjectsByKind(clusterId, selectedKind, debouncedNamespace)
                    .then((result) => setObjects(result))
                    .catch((err) => setError(err instanceof Error ? err.message : String(err)))
                    .finally(() => setIsLoadingObjects(false));
                }
              }}
            >
              Retry
            </button>
          </div>
        )}

        <div className="import-picker-footer">
          <button className="button generic" onClick={onClose}>
            Cancel
          </button>
          <button
            className="button action"
            disabled={!selectedObject || isImporting}
            onClick={handleImport}
          >
            {isImporting ? 'Importing...' : 'Import'}
          </button>
        </div>
      </div>
    </div>
  );
};
```

**Step 3: Wire the picker into CreateResourceModal**

In `CreateResourceModal.tsx`, add the import at the top:

```tsx
import { ImportResourcePicker } from './create-resource/ImportResourcePicker';
```

Before the closing `</>` of the return statement (around line 805), add:

```tsx
{/* Import Resource Picker */}
<ImportResourcePicker
  isOpen={isImportPickerOpen}
  onClose={() => setIsImportPickerOpen(false)}
  onImport={handleImportComplete}
  defaultClusterId={targetClusterId}
/>
```

**Step 4: Verify TypeScript compiles**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx tsc --noEmit`
Expected: No errors.

**Step 5: Run frontend tests**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx vitest run`
Expected: All tests pass.

**Step 6: Commit**

```
feat: add ImportResourcePicker for importing objects from clusters

Adds a dedicated overlay component that lets users browse connected
clusters by kind, filter by namespace and name, and import an object's
cleaned YAML into the CreateResourceModal editor.
```

---

### Task 7: Frontend — ImportResourcePicker Tests

Write Vitest tests for the ImportResourcePicker component.

**Files:**
- Create: `frontend/src/ui/modals/create-resource/ImportResourcePicker.test.tsx`

**Step 1: Write the test file**

Test coverage should include:

**Basic rendering:**
- Renders nothing when `isOpen` is false
- Renders overlay when `isOpen` is true
- Calls `onClose` when Cancel is clicked
- Calls `onClose` when overlay backdrop is clicked
- Import button is disabled when no object is selected
- Shows "Select a resource kind" message initially
- Calls `GetClusterResourceKinds` when opened

**Interaction flows:**
- Selecting a kind triggers `ListClusterObjectsByKind` call
- Search input filters the displayed object list by name
- Clicking an object selects it and enables the Import button
- Import button click calls `GetClusterObjectYAML` and passes result to `onImport`
- Double-click on an object triggers import directly

**Error handling:**
- Shows error message when `GetClusterResourceKinds` fails
- Shows retry button when error is displayed
- Clicking retry re-fetches the data

**Race condition guard:**
- Rapid double-clicks only trigger one import (verify `GetClusterObjectYAML` called once)

The test file should mock `@wailsjs/go/backend/App` and `@modules/kubernetes/config/KubeconfigContext` following the existing test patterns in the project.

**Step 2: Run tests**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx vitest run src/ui/modals/create-resource/ImportResourcePicker.test.tsx`
Expected: All pass.

**Step 3: Commit**

```
test: add ImportResourcePicker component tests
```

---

### Task 8: Verification & Polish

Final verification pass — run all tests, linting, and typecheck.

**Step 1: Run backend tests**

Run: `cd /Volumes/git/luxury-yacht/app && go vet ./backend/... && go test ./backend/... -count=1`
Expected: All pass.

**Step 2: Run frontend tests**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx vitest run`
Expected: All pass.

**Step 3: Run TypeScript check**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx tsc --noEmit`
Expected: No errors.

**Step 4: Run lint**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npm run lint`
Expected: No errors (fix any that appear).

**Step 5: Update the design doc**

Mark all items as complete in `docs/plans/2026-03-08-create-modal-file-io-import-design.md` by adding a ✅ prefix to each section heading.

**Step 6: Commit**

```
chore: verify and polish file I/O and import features
```
