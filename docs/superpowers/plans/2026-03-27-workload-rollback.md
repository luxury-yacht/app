# Workload Rollback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a rollback action for Deployments, StatefulSets, and DaemonSets that shows full revision history with diffs and lets users roll back to any previous revision.

**Architecture:** Backend provides two new endpoints — `GetRevisionHistory` (normalizes Deployment ReplicaSets and StatefulSet/DaemonSet ControllerRevisions into a uniform shape) and `RollbackWorkload` (patches the workload's pod template to match a target revision). Frontend extracts the diff renderer from ObjectDiffModal into a shared `DiffViewer` component, then builds a `RollbackModal` that fetches revision history, displays a selectable revision list with on-demand diffs, and triggers rollback on confirmation. The action integrates into existing context menus and the object panel via the established action system.

**Tech Stack:** Go (Kubernetes client-go), React 19, TypeScript, Vitest, Wails v2

**Spec:** `docs/superpowers/specs/2026-03-27-workload-rollback-design.md`

---

## File Map

### New Files

| File | Purpose |
|------|---------|
| `backend/workload_rollback.go` | `RevisionEntry` type, `GetRevisionHistory`, `RollbackWorkload` |
| `backend/workload_rollback_test.go` | Backend tests |
| `frontend/src/shared/components/diff/diffUtils.ts` | `DisplayDiffLine`, `TruncationMap`, `mergeDiffLines`, `areTruncationMapsEqual` |
| `frontend/src/shared/components/diff/DiffViewer.tsx` | Reusable side-by-side diff display component |
| `frontend/src/shared/components/diff/DiffViewer.css` | Diff table styles (extracted from ObjectDiffModal.css) |
| `frontend/src/shared/components/diff/DiffViewer.test.tsx` | DiffViewer unit tests |
| `frontend/src/shared/components/modals/RollbackModal.tsx` | Rollback modal with revision list + diff |
| `frontend/src/shared/components/modals/RollbackModal.css` | Rollback modal styles |
| `frontend/src/shared/components/modals/RollbackModal.test.tsx` | RollbackModal unit tests |

### Modified Files

| File | Change |
|------|--------|
| `frontend/src/ui/modals/ObjectDiffModal.tsx` | Import from shared `diffUtils`, replace inline diff renderer with `DiffViewer` |
| `frontend/src/ui/modals/ObjectDiffModal.css` | Remove diff-table styles (moved to DiffViewer.css) |
| `frontend/src/shared/components/icons/MenuIcons.tsx` | Add `RollbackIcon` |
| `frontend/src/shared/hooks/useObjectActions.tsx` | Add `ROLLBACKABLE_KINDS`, `onRollback` handler, rollback permission |
| `frontend/src/core/capabilities/actionPlanner.ts` | Register `core.nodes.workload.rollback` |
| `frontend/src/modules/namespace/components/NsViewWorkloads.tsx` | Wire rollback action + modal |
| `frontend/src/modules/object-panel/components/ObjectPanel/types.ts` | Add `'rollback'` to `ResourceAction`, rollback state to `PanelState`/`PanelAction` |
| `frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelActions.ts` | Add rollback dispatch |

---

## Task 1: Backend — GetRevisionHistory for Deployments

**Files:**
- Create: `backend/workload_rollback.go`
- Create: `backend/workload_rollback_test.go`

- [ ] **Step 1: Write the test for Deployment revision history**

```go
// backend/workload_rollback_test.go
package backend

import (
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	cgofake "k8s.io/client-go/kubernetes/fake"
)

func TestGetRevisionHistoryDeployment(t *testing.T) {
	deploymentUID := types.UID("deploy-uid-123")
	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "web",
			Namespace: "default",
			UID:       deploymentUID,
			Annotations: map[string]string{
				"deployment.kubernetes.io/revision": "3",
			},
		},
		Spec: appsv1.DeploymentSpec{
			Template: corev1.PodTemplateSpec{
				Spec: corev1.PodSpec{
					Containers: []corev1.Container{
						{Name: "app", Image: "nginx:1.25"},
					},
				},
			},
		},
	}

	// Three ReplicaSets owned by this Deployment, each representing a revision.
	rs1 := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "web-rs1",
			Namespace: "default",
			Annotations: map[string]string{
				"deployment.kubernetes.io/revision":  "1",
				"kubernetes.io/change-cause":         "initial deploy",
			},
			OwnerReferences: []metav1.OwnerReference{
				{UID: deploymentUID, Kind: "Deployment", Name: "web"},
			},
			CreationTimestamp: metav1.Now(),
		},
		Spec: appsv1.ReplicaSetSpec{
			Template: corev1.PodTemplateSpec{
				Spec: corev1.PodSpec{
					Containers: []corev1.Container{
						{Name: "app", Image: "nginx:1.23"},
					},
				},
			},
		},
	}
	rs2 := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "web-rs2",
			Namespace: "default",
			Annotations: map[string]string{
				"deployment.kubernetes.io/revision": "2",
			},
			OwnerReferences: []metav1.OwnerReference{
				{UID: deploymentUID, Kind: "Deployment", Name: "web"},
			},
			CreationTimestamp: metav1.Now(),
		},
		Spec: appsv1.ReplicaSetSpec{
			Template: corev1.PodTemplateSpec{
				Spec: corev1.PodSpec{
					Containers: []corev1.Container{
						{Name: "app", Image: "nginx:1.24"},
					},
				},
			},
		},
	}
	rs3 := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "web-rs3",
			Namespace: "default",
			Annotations: map[string]string{
				"deployment.kubernetes.io/revision": "3",
			},
			OwnerReferences: []metav1.OwnerReference{
				{UID: deploymentUID, Kind: "Deployment", Name: "web"},
			},
			CreationTimestamp: metav1.Now(),
		},
		Spec: appsv1.ReplicaSetSpec{
			Template: corev1.PodTemplateSpec{
				Spec: corev1.PodSpec{
					Containers: []corev1.Container{
						{Name: "app", Image: "nginx:1.25"},
					},
				},
			},
		},
	}

	client := cgofake.NewClientset(deployment, rs1, rs2, rs3)
	app := &App{logger: NewLogger(100)}
	app.clusterClients = map[string]*clusterClients{
		"config:ctx": {
			meta:   ClusterMeta{ID: "config:ctx", Name: "ctx"},
			client: client,
		},
	}

	revisions, err := app.GetRevisionHistory("config:ctx", "default", "web", "Deployment")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Should return 3 revisions sorted descending by revision number.
	if len(revisions) != 3 {
		t.Fatalf("expected 3 revisions, got %d", len(revisions))
	}

	// First entry should be revision 3 (current).
	if revisions[0].Revision != 3 {
		t.Errorf("expected first revision to be 3, got %d", revisions[0].Revision)
	}
	if !revisions[0].Current {
		t.Error("expected revision 3 to be marked as current")
	}

	// Revision 2 should not be current.
	if revisions[1].Revision != 2 {
		t.Errorf("expected second revision to be 2, got %d", revisions[1].Revision)
	}
	if revisions[1].Current {
		t.Error("expected revision 2 to not be current")
	}

	// Revision 1 should have a change cause.
	if revisions[2].Revision != 1 {
		t.Errorf("expected third revision to be 1, got %d", revisions[2].Revision)
	}
	if revisions[2].ChangeCause != "initial deploy" {
		t.Errorf("expected change cause 'initial deploy', got %q", revisions[2].ChangeCause)
	}

	// Pod template should be non-empty YAML containing the container image.
	if revisions[0].PodTemplate == "" {
		t.Error("expected non-empty pod template for revision 3")
	}
}

func TestGetRevisionHistoryUnsupportedKind(t *testing.T) {
	client := cgofake.NewClientset()
	app := &App{logger: NewLogger(100)}
	app.clusterClients = map[string]*clusterClients{
		"config:ctx": {
			meta:   ClusterMeta{ID: "config:ctx", Name: "ctx"},
			client: client,
		},
	}

	_, err := app.GetRevisionHistory("config:ctx", "default", "test", "ReplicaSet")
	if err == nil {
		t.Fatal("expected error for unsupported kind")
	}
}

func TestGetRevisionHistoryNilClient(t *testing.T) {
	app := &App{logger: NewLogger(100)}
	app.clusterClients = map[string]*clusterClients{}

	_, err := app.GetRevisionHistory("missing", "default", "test", "Deployment")
	if err == nil {
		t.Fatal("expected error for missing cluster")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./backend/ -run TestGetRevisionHistory -v`
Expected: Compilation error — `GetRevisionHistory` not defined.

- [ ] **Step 3: Write the implementation**

```go
// backend/workload_rollback.go
package backend

import (
	"context"
	"fmt"
	"sort"
	"strconv"

	appsv1 "k8s.io/api/apps/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	sigsyaml "sigs.k8s.io/yaml"
)

// RevisionEntry represents a single revision in a workload's rollout history.
type RevisionEntry struct {
	Revision    int64  `json:"revision"`
	CreatedAt   string `json:"createdAt"`
	ChangeCause string `json:"changeCause"`
	Current     bool   `json:"current"`
	PodTemplate string `json:"podTemplate"`
}

// GetRevisionHistory returns the rollout revision history for a workload.
// Supported kinds: Deployment, StatefulSet, DaemonSet.
func (a *App) GetRevisionHistory(clusterID, namespace, name, workloadKind string) ([]RevisionEntry, error) {
	deps, err := a.getClusterDeps(clusterID)
	if err != nil {
		return nil, fmt.Errorf("cluster %q: %w", clusterID, err)
	}

	ctx := context.Background()
	if deps.Context != nil {
		ctx = deps.Context
	}

	switch workloadKind {
	case "Deployment":
		return a.getDeploymentRevisions(ctx, deps, namespace, name)
	default:
		return nil, fmt.Errorf("unsupported workload kind for revision history: %s", workloadKind)
	}
}

// getDeploymentRevisions retrieves revision history from ReplicaSets owned by the Deployment.
func (a *App) getDeploymentRevisions(ctx context.Context, deps *clusterDeps, namespace, name string) ([]RevisionEntry, error) {
	client := deps.KubernetesClient

	// Get the Deployment to find its UID and current revision.
	deployment, err := client.AppsV1().Deployments(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("get deployment %s/%s: %w", namespace, name, err)
	}

	currentRevStr := deployment.Annotations["deployment.kubernetes.io/revision"]
	currentRev, _ := strconv.ParseInt(currentRevStr, 10, 64)

	// List all ReplicaSets in the namespace and filter by owner.
	rsList, err := client.AppsV1().ReplicaSets(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("list replicasets in %s: %w", namespace, err)
	}

	var revisions []RevisionEntry
	for i := range rsList.Items {
		rs := &rsList.Items[i]
		if !isOwnedBy(rs.OwnerReferences, deployment.UID) {
			continue
		}

		revStr := rs.Annotations["deployment.kubernetes.io/revision"]
		rev, err := strconv.ParseInt(revStr, 10, 64)
		if err != nil {
			continue
		}

		podTemplateYaml, err := marshalPodTemplate(&rs.Spec.Template)
		if err != nil {
			podTemplateYaml = fmt.Sprintf("# error marshalling pod template: %v", err)
		}

		revisions = append(revisions, RevisionEntry{
			Revision:    rev,
			CreatedAt:   rs.CreationTimestamp.UTC().Format("2006-01-02T15:04:05Z"),
			ChangeCause: rs.Annotations["kubernetes.io/change-cause"],
			Current:     rev == currentRev,
			PodTemplate: podTemplateYaml,
		})
	}

	// Sort descending by revision number.
	sort.Slice(revisions, func(i, j int) bool {
		return revisions[i].Revision > revisions[j].Revision
	})

	return revisions, nil
}

// isOwnedBy checks if any owner reference matches the given UID.
func isOwnedBy(refs []metav1.OwnerReference, uid appsv1.UID) bool {
	for _, ref := range refs {
		if ref.UID == uid {
			return true
		}
	}
	return false
}

// marshalPodTemplate serializes a PodTemplateSpec to YAML.
func marshalPodTemplate(template *corev1.PodTemplateSpec) (string, error) {
	data, err := sigsyaml.Marshal(template)
	if err != nil {
		return "", err
	}
	return string(data), nil
}
```

The correct import block for the file (includes `corev1` for `marshalPodTemplate` and `types` for `isOwnedBy`):

```go
import (
	"context"
	"fmt"
	"sort"
	"strconv"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	sigsyaml "sigs.k8s.io/yaml"
)
```

And the `isOwnedBy` function signature uses `types.UID` (not `appsv1.UID`):

```go
func isOwnedBy(refs []metav1.OwnerReference, uid types.UID) bool {
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./backend/ -run TestGetRevisionHistory -v`
Expected: All 3 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/workload_rollback.go backend/workload_rollback_test.go
git commit -m "feat: add GetRevisionHistory for Deployments"
```

---

## Task 2: Backend — GetRevisionHistory for StatefulSets and DaemonSets

**Files:**
- Modify: `backend/workload_rollback.go`
- Modify: `backend/workload_rollback_test.go`

- [ ] **Step 1: Write tests for StatefulSet and DaemonSet revision history**

Add to `backend/workload_rollback_test.go`:

```go
func TestGetRevisionHistoryStatefulSet(t *testing.T) {
	ssUID := types.UID("ss-uid-456")
	ss := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "db",
			Namespace: "default",
			UID:       ssUID,
		},
		Status: appsv1.StatefulSetStatus{
			CurrentRevision: "db-rev3",
		},
	}

	// ControllerRevisions owned by this StatefulSet.
	cr1 := &appsv1.ControllerRevision{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "db-rev1",
			Namespace: "default",
			OwnerReferences: []metav1.OwnerReference{
				{UID: ssUID, Kind: "StatefulSet", Name: "db"},
			},
			CreationTimestamp: metav1.Now(),
		},
		Revision: 1,
		Data:     mustMarshalControllerRevisionData(t, &appsv1.StatefulSet{
			Spec: appsv1.StatefulSetSpec{
				Template: corev1.PodTemplateSpec{
					Spec: corev1.PodSpec{
						Containers: []corev1.Container{
							{Name: "db", Image: "postgres:14"},
						},
					},
				},
			},
		}),
	}
	cr2 := &appsv1.ControllerRevision{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "db-rev2",
			Namespace: "default",
			OwnerReferences: []metav1.OwnerReference{
				{UID: ssUID, Kind: "StatefulSet", Name: "db"},
			},
			CreationTimestamp: metav1.Now(),
		},
		Revision: 2,
		Data:     mustMarshalControllerRevisionData(t, &appsv1.StatefulSet{
			Spec: appsv1.StatefulSetSpec{
				Template: corev1.PodTemplateSpec{
					Spec: corev1.PodSpec{
						Containers: []corev1.Container{
							{Name: "db", Image: "postgres:15"},
						},
					},
				},
			},
		}),
	}
	cr3 := &appsv1.ControllerRevision{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "db-rev3",
			Namespace: "default",
			OwnerReferences: []metav1.OwnerReference{
				{UID: ssUID, Kind: "StatefulSet", Name: "db"},
			},
			CreationTimestamp: metav1.Now(),
		},
		Revision: 3,
		Data:     mustMarshalControllerRevisionData(t, &appsv1.StatefulSet{
			Spec: appsv1.StatefulSetSpec{
				Template: corev1.PodTemplateSpec{
					Spec: corev1.PodSpec{
						Containers: []corev1.Container{
							{Name: "db", Image: "postgres:16"},
						},
					},
				},
			},
		}),
	}

	client := cgofake.NewClientset(ss, cr1, cr2, cr3)
	app := &App{logger: NewLogger(100)}
	app.clusterClients = map[string]*clusterClients{
		"config:ctx": {
			meta:   ClusterMeta{ID: "config:ctx", Name: "ctx"},
			client: client,
		},
	}

	revisions, err := app.GetRevisionHistory("config:ctx", "default", "db", "StatefulSet")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(revisions) != 3 {
		t.Fatalf("expected 3 revisions, got %d", len(revisions))
	}

	// Revision 3 should be current (matches status.currentRevision name).
	if !revisions[0].Current {
		t.Error("expected revision 3 to be current")
	}
	if revisions[0].Revision != 3 {
		t.Errorf("expected revision 3 first, got %d", revisions[0].Revision)
	}

	// Pod template should contain the container image.
	if revisions[0].PodTemplate == "" {
		t.Error("expected non-empty pod template")
	}
}

func TestGetRevisionHistoryDaemonSet(t *testing.T) {
	dsUID := types.UID("ds-uid-789")
	ds := &appsv1.DaemonSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "agent",
			Namespace: "kube-system",
			UID:       dsUID,
		},
	}

	cr1 := &appsv1.ControllerRevision{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "agent-rev1",
			Namespace: "kube-system",
			OwnerReferences: []metav1.OwnerReference{
				{UID: dsUID, Kind: "DaemonSet", Name: "agent"},
			},
			CreationTimestamp: metav1.Now(),
		},
		Revision: 1,
		Data:     mustMarshalControllerRevisionData(t, &appsv1.DaemonSet{
			Spec: appsv1.DaemonSetSpec{
				Template: corev1.PodTemplateSpec{
					Spec: corev1.PodSpec{
						Containers: []corev1.Container{
							{Name: "agent", Image: "agent:1.0"},
						},
					},
				},
			},
		}),
	}
	cr2 := &appsv1.ControllerRevision{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "agent-rev2",
			Namespace: "kube-system",
			OwnerReferences: []metav1.OwnerReference{
				{UID: dsUID, Kind: "DaemonSet", Name: "agent"},
			},
			CreationTimestamp: metav1.Now(),
		},
		Revision: 2,
		Data:     mustMarshalControllerRevisionData(t, &appsv1.DaemonSet{
			Spec: appsv1.DaemonSetSpec{
				Template: corev1.PodTemplateSpec{
					Spec: corev1.PodSpec{
						Containers: []corev1.Container{
							{Name: "agent", Image: "agent:2.0"},
						},
					},
				},
			},
		}),
	}

	client := cgofake.NewClientset(ds, cr1, cr2)
	app := &App{logger: NewLogger(100)}
	app.clusterClients = map[string]*clusterClients{
		"config:ctx": {
			meta:   ClusterMeta{ID: "config:ctx", Name: "ctx"},
			client: client,
		},
	}

	revisions, err := app.GetRevisionHistory("config:ctx", "kube-system", "agent", "DaemonSet")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if len(revisions) != 2 {
		t.Fatalf("expected 2 revisions, got %d", len(revisions))
	}

	// Highest revision (2) is current for DaemonSets.
	if !revisions[0].Current {
		t.Error("expected revision 2 to be current")
	}
	if revisions[0].Revision != 2 {
		t.Errorf("expected revision 2 first, got %d", revisions[0].Revision)
	}
}
```

Add this test helper at the bottom of the file:

```go
// mustMarshalControllerRevisionData marshals a workload object into a runtime.RawExtension
// suitable for ControllerRevision.Data in tests.
func mustMarshalControllerRevisionData(t *testing.T, obj interface{}) runtime.RawExtension {
	t.Helper()
	data, err := json.Marshal(obj)
	if err != nil {
		t.Fatalf("failed to marshal controller revision data: %v", err)
	}
	return runtime.RawExtension{Raw: data}
}
```

Add these imports to the test file:

```go
import (
	"encoding/json"
	"k8s.io/apimachinery/pkg/runtime"
)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./backend/ -run TestGetRevisionHistory -v`
Expected: FAIL — StatefulSet/DaemonSet cases hit the unsupported kind default branch.

- [ ] **Step 3: Add StatefulSet and DaemonSet support to GetRevisionHistory**

In `backend/workload_rollback.go`, add the `"encoding/json"` import and two new cases to the switch in `GetRevisionHistory`:

```go
	case "StatefulSet":
		return a.getStatefulSetRevisions(ctx, deps, namespace, name)
	case "DaemonSet":
		return a.getDaemonSetRevisions(ctx, deps, namespace, name)
```

Add two new methods and a shared helper:

```go
// getStatefulSetRevisions retrieves revision history from ControllerRevisions owned by the StatefulSet.
func (a *App) getStatefulSetRevisions(ctx context.Context, deps *clusterDeps, namespace, name string) ([]RevisionEntry, error) {
	client := deps.KubernetesClient

	ss, err := client.AppsV1().StatefulSets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("get statefulset %s/%s: %w", namespace, name, err)
	}

	currentRevisionName := ss.Status.CurrentRevision
	return a.getControllerRevisionEntries(ctx, deps, namespace, ss.UID, currentRevisionName, "StatefulSet")
}

// getDaemonSetRevisions retrieves revision history from ControllerRevisions owned by the DaemonSet.
func (a *App) getDaemonSetRevisions(ctx context.Context, deps *clusterDeps, namespace, name string) ([]RevisionEntry, error) {
	client := deps.KubernetesClient

	ds, err := client.AppsV1().DaemonSets(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("get daemonset %s/%s: %w", namespace, name, err)
	}

	// DaemonSets don't expose currentRevision in status.
	// The highest revision number is the current one.
	return a.getControllerRevisionEntries(ctx, deps, namespace, ds.UID, "", "DaemonSet")
}

// getControllerRevisionEntries lists ControllerRevisions owned by a workload and builds RevisionEntry items.
// If currentRevisionName is non-empty, the revision matching that name is marked current.
// Otherwise the highest revision number is marked current.
func (a *App) getControllerRevisionEntries(
	ctx context.Context,
	deps *clusterDeps,
	namespace string,
	ownerUID types.UID,
	currentRevisionName string,
	workloadKind string,
) ([]RevisionEntry, error) {
	client := deps.KubernetesClient

	crList, err := client.AppsV1().ControllerRevisions(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("list controller revisions in %s: %w", namespace, err)
	}

	var revisions []RevisionEntry
	for i := range crList.Items {
		cr := &crList.Items[i]
		if !isOwnedBy(cr.OwnerReferences, ownerUID) {
			continue
		}

		podTemplateYaml, err := extractPodTemplateFromControllerRevision(cr, workloadKind)
		if err != nil {
			podTemplateYaml = fmt.Sprintf("# error extracting pod template: %v", err)
		}

		isCurrent := false
		if currentRevisionName != "" {
			isCurrent = cr.Name == currentRevisionName
		}

		revisions = append(revisions, RevisionEntry{
			Revision:    cr.Revision,
			CreatedAt:   cr.CreationTimestamp.UTC().Format("2006-01-02T15:04:05Z"),
			ChangeCause: cr.Annotations["kubernetes.io/change-cause"],
			Current:     isCurrent,
			PodTemplate: podTemplateYaml,
		})
	}

	// Sort descending by revision number.
	sort.Slice(revisions, func(i, j int) bool {
		return revisions[i].Revision > revisions[j].Revision
	})

	// If no currentRevisionName was provided, mark the highest revision as current.
	if currentRevisionName == "" && len(revisions) > 0 {
		revisions[0].Current = true
	}

	return revisions, nil
}

// extractPodTemplateFromControllerRevision deserializes the stored workload spec
// from a ControllerRevision and extracts the pod template as YAML.
func extractPodTemplateFromControllerRevision(cr *appsv1.ControllerRevision, workloadKind string) (string, error) {
	if cr.Data.Raw == nil {
		return "", fmt.Errorf("controller revision %s has no data", cr.Name)
	}

	switch workloadKind {
	case "StatefulSet":
		var ss appsv1.StatefulSet
		if err := json.Unmarshal(cr.Data.Raw, &ss); err != nil {
			return "", fmt.Errorf("unmarshal statefulset from revision: %w", err)
		}
		return marshalPodTemplate(&ss.Spec.Template)
	case "DaemonSet":
		var ds appsv1.DaemonSet
		if err := json.Unmarshal(cr.Data.Raw, &ds); err != nil {
			return "", fmt.Errorf("unmarshal daemonset from revision: %w", err)
		}
		return marshalPodTemplate(&ds.Spec.Template)
	default:
		return "", fmt.Errorf("unsupported kind for controller revision extraction: %s", workloadKind)
	}
}
```

Add `"encoding/json"` to the imports in `workload_rollback.go`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./backend/ -run TestGetRevisionHistory -v`
Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/workload_rollback.go backend/workload_rollback_test.go
git commit -m "feat: add GetRevisionHistory for StatefulSets and DaemonSets"
```

---

## Task 3: Backend — RollbackWorkload

**Files:**
- Modify: `backend/workload_rollback.go`
- Modify: `backend/workload_rollback_test.go`

- [ ] **Step 1: Write the rollback tests**

Add to `backend/workload_rollback_test.go`:

```go
func TestRollbackWorkloadDeployment(t *testing.T) {
	deploymentUID := types.UID("deploy-uid-rb")
	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "web",
			Namespace: "default",
			UID:       deploymentUID,
			Annotations: map[string]string{
				"deployment.kubernetes.io/revision": "2",
			},
		},
		Spec: appsv1.DeploymentSpec{
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{"app": "web"},
				},
				Spec: corev1.PodSpec{
					Containers: []corev1.Container{
						{Name: "app", Image: "nginx:1.25"},
					},
				},
			},
		},
	}
	rsOld := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "web-rs1",
			Namespace: "default",
			Annotations: map[string]string{
				"deployment.kubernetes.io/revision": "1",
			},
			OwnerReferences: []metav1.OwnerReference{
				{UID: deploymentUID, Kind: "Deployment", Name: "web"},
			},
		},
		Spec: appsv1.ReplicaSetSpec{
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{"app": "web"},
				},
				Spec: corev1.PodSpec{
					Containers: []corev1.Container{
						{Name: "app", Image: "nginx:1.23"},
					},
				},
			},
		},
	}
	rsCurrent := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "web-rs2",
			Namespace: "default",
			Annotations: map[string]string{
				"deployment.kubernetes.io/revision": "2",
			},
			OwnerReferences: []metav1.OwnerReference{
				{UID: deploymentUID, Kind: "Deployment", Name: "web"},
			},
		},
		Spec: appsv1.ReplicaSetSpec{
			Template: corev1.PodTemplateSpec{
				ObjectMeta: metav1.ObjectMeta{
					Labels: map[string]string{"app": "web"},
				},
				Spec: corev1.PodSpec{
					Containers: []corev1.Container{
						{Name: "app", Image: "nginx:1.25"},
					},
				},
			},
		},
	}

	client := cgofake.NewClientset(deployment, rsOld, rsCurrent)
	app := &App{logger: NewLogger(100)}
	app.clusterClients = map[string]*clusterClients{
		"config:ctx": {
			meta:   ClusterMeta{ID: "config:ctx", Name: "ctx"},
			client: client,
		},
	}

	err := app.RollbackWorkload("config:ctx", "default", "web", "Deployment", 1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// Verify the deployment was updated with the old image.
	updated, err := client.AppsV1().Deployments("default").Get(context.Background(), "web", metav1.GetOptions{})
	if err != nil {
		t.Fatalf("get updated deployment: %v", err)
	}
	image := updated.Spec.Template.Spec.Containers[0].Image
	if image != "nginx:1.23" {
		t.Errorf("expected image 'nginx:1.23' after rollback, got %q", image)
	}
}

func TestRollbackWorkloadStatefulSet(t *testing.T) {
	ssUID := types.UID("ss-uid-rb")
	ss := &appsv1.StatefulSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "db",
			Namespace: "default",
			UID:       ssUID,
		},
		Status: appsv1.StatefulSetStatus{
			CurrentRevision: "db-rev2",
		},
		Spec: appsv1.StatefulSetSpec{
			Template: corev1.PodTemplateSpec{
				Spec: corev1.PodSpec{
					Containers: []corev1.Container{
						{Name: "db", Image: "postgres:16"},
					},
				},
			},
		},
	}
	cr1 := &appsv1.ControllerRevision{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "db-rev1",
			Namespace: "default",
			OwnerReferences: []metav1.OwnerReference{
				{UID: ssUID, Kind: "StatefulSet", Name: "db"},
			},
		},
		Revision: 1,
		Data: mustMarshalControllerRevisionData(t, &appsv1.StatefulSet{
			Spec: appsv1.StatefulSetSpec{
				Template: corev1.PodTemplateSpec{
					Spec: corev1.PodSpec{
						Containers: []corev1.Container{
							{Name: "db", Image: "postgres:14"},
						},
					},
				},
			},
		}),
	}

	client := cgofake.NewClientset(ss, cr1)
	app := &App{logger: NewLogger(100)}
	app.clusterClients = map[string]*clusterClients{
		"config:ctx": {
			meta:   ClusterMeta{ID: "config:ctx", Name: "ctx"},
			client: client,
		},
	}

	err := app.RollbackWorkload("config:ctx", "default", "db", "StatefulSet", 1)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	updated, err := client.AppsV1().StatefulSets("default").Get(context.Background(), "db", metav1.GetOptions{})
	if err != nil {
		t.Fatalf("get updated statefulset: %v", err)
	}
	image := updated.Spec.Template.Spec.Containers[0].Image
	if image != "postgres:14" {
		t.Errorf("expected image 'postgres:14' after rollback, got %q", image)
	}
}

func TestRollbackWorkloadRevisionNotFound(t *testing.T) {
	deploymentUID := types.UID("deploy-uid-nf")
	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "web",
			Namespace: "default",
			UID:       deploymentUID,
			Annotations: map[string]string{
				"deployment.kubernetes.io/revision": "1",
			},
		},
	}
	rs1 := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "web-rs1",
			Namespace: "default",
			Annotations: map[string]string{
				"deployment.kubernetes.io/revision": "1",
			},
			OwnerReferences: []metav1.OwnerReference{
				{UID: deploymentUID, Kind: "Deployment", Name: "web"},
			},
		},
	}

	client := cgofake.NewClientset(deployment, rs1)
	app := &App{logger: NewLogger(100)}
	app.clusterClients = map[string]*clusterClients{
		"config:ctx": {
			meta:   ClusterMeta{ID: "config:ctx", Name: "ctx"},
			client: client,
		},
	}

	err := app.RollbackWorkload("config:ctx", "default", "web", "Deployment", 99)
	if err == nil {
		t.Fatal("expected error for missing revision")
	}
}

func TestRollbackWorkloadUnsupportedKind(t *testing.T) {
	client := cgofake.NewClientset()
	app := &App{logger: NewLogger(100)}
	app.clusterClients = map[string]*clusterClients{
		"config:ctx": {
			meta:   ClusterMeta{ID: "config:ctx", Name: "ctx"},
			client: client,
		},
	}

	err := app.RollbackWorkload("config:ctx", "default", "test", "ReplicaSet", 1)
	if err == nil {
		t.Fatal("expected error for unsupported kind")
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./backend/ -run TestRollbackWorkload -v`
Expected: Compilation error — `RollbackWorkload` not defined.

- [ ] **Step 3: Implement RollbackWorkload**

Add to `backend/workload_rollback.go`:

```go
// RollbackWorkload rolls back a workload to a specific revision by patching its pod template.
// Supported kinds: Deployment, StatefulSet, DaemonSet.
func (a *App) RollbackWorkload(clusterID, namespace, name, workloadKind string, toRevision int64) error {
	// Get the revision history to find the target revision's pod template.
	revisions, err := a.GetRevisionHistory(clusterID, namespace, name, workloadKind)
	if err != nil {
		return fmt.Errorf("get revision history: %w", err)
	}

	var targetTemplate string
	found := false
	for _, rev := range revisions {
		if rev.Revision == toRevision {
			targetTemplate = rev.PodTemplate
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("revision %d not found for %s %s/%s", toRevision, workloadKind, namespace, name)
	}

	// Deserialize the target pod template from YAML.
	var podTemplate corev1.PodTemplateSpec
	if err := sigsyaml.Unmarshal([]byte(targetTemplate), &podTemplate); err != nil {
		return fmt.Errorf("unmarshal target pod template: %w", err)
	}

	deps, err := a.getClusterDeps(clusterID)
	if err != nil {
		return fmt.Errorf("cluster %q: %w", clusterID, err)
	}

	ctx := context.Background()
	if deps.Context != nil {
		ctx = deps.Context
	}
	client := deps.KubernetesClient

	switch workloadKind {
	case "Deployment":
		deploy, err := client.AppsV1().Deployments(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return fmt.Errorf("get deployment: %w", err)
		}
		deploy.Spec.Template = podTemplate
		_, err = client.AppsV1().Deployments(namespace).Update(ctx, deploy, metav1.UpdateOptions{})
		if err != nil {
			return fmt.Errorf("update deployment: %w", err)
		}

	case "StatefulSet":
		ss, err := client.AppsV1().StatefulSets(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return fmt.Errorf("get statefulset: %w", err)
		}
		ss.Spec.Template = podTemplate
		_, err = client.AppsV1().StatefulSets(namespace).Update(ctx, ss, metav1.UpdateOptions{})
		if err != nil {
			return fmt.Errorf("update statefulset: %w", err)
		}

	case "DaemonSet":
		ds, err := client.AppsV1().DaemonSets(namespace).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return fmt.Errorf("get daemonset: %w", err)
		}
		ds.Spec.Template = podTemplate
		_, err = client.AppsV1().DaemonSets(namespace).Update(ctx, ds, metav1.UpdateOptions{})
		if err != nil {
			return fmt.Errorf("update daemonset: %w", err)
		}

	default:
		return fmt.Errorf("unsupported workload kind for rollback: %s", workloadKind)
	}

	a.logger.Infof("Rolled back %s %s/%s to revision %d in cluster %s", workloadKind, namespace, name, toRevision, clusterID)
	return nil
}
```

- [ ] **Step 4: Run all backend rollback tests**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./backend/ -run "TestGetRevisionHistory|TestRollbackWorkload" -v`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/workload_rollback.go backend/workload_rollback_test.go
git commit -m "feat: add RollbackWorkload endpoint"
```

---

## Task 4: Regenerate Wails TypeScript Bindings

**Files:**
- Modified (auto-generated): `frontend/wailsjs/go/backend/App.d.ts`
- Modified (auto-generated): `frontend/wailsjs/go/backend/App.js`
- Modified (auto-generated): `frontend/wailsjs/go/models.ts`

- [ ] **Step 1: Regenerate Wails bindings**

Run: `cd /Volumes/git/luxury-yacht/app && wails generate module`

This will update the auto-generated TypeScript files to include `GetRevisionHistory` and `RollbackWorkload` bindings plus the `RevisionEntry` model.

- [ ] **Step 2: Verify the generated bindings**

Check that the generated files contain:
- `App.d.ts`: `GetRevisionHistory(arg1, arg2, arg3, arg4): Promise<backend.RevisionEntry[]>` and `RollbackWorkload(arg1, arg2, arg3, arg4, arg5): Promise<void>`
- `models.ts`: `RevisionEntry` class with `revision`, `createdAt`, `changeCause`, `current`, `podTemplate` fields

- [ ] **Step 3: Commit**

```bash
git add frontend/wailsjs/
git commit -m "chore: regenerate Wails bindings for rollback endpoints"
```

---

## Task 5: Frontend — Extract diffUtils.ts

**Files:**
- Create: `frontend/src/shared/components/diff/diffUtils.ts`
- Modify: `frontend/src/ui/modals/ObjectDiffModal.tsx`

- [ ] **Step 1: Create the shared diffUtils module**

```typescript
// frontend/src/shared/components/diff/diffUtils.ts
/**
 * Shared diff utility types and functions used by DiffViewer and ObjectDiffModal.
 */
import type { DiffLine, DiffLineType } from '@modules/object-panel/components/ObjectPanel/Yaml/yamlDiff';

export type { DiffLineType };

export type DisplayDiffLine = DiffLine & {
  leftType: DiffLineType;
  rightType: DiffLineType;
};

export type TruncationMap = Record<number, { left: boolean; right: boolean }>;

export const areTruncationMapsEqual = (left: TruncationMap, right: TruncationMap): boolean => {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every((key) => {
    const index = Number(key);
    const leftValue = left[index];
    const rightValue = right[index];
    if (!rightValue) {
      return false;
    }
    return leftValue.left === rightValue.left && leftValue.right === rightValue.right;
  });
};

// Merge adjacent remove/add blocks so modifications display on a single row.
export const mergeDiffLines = (lines: DiffLine[]): DisplayDiffLine[] => {
  const merged: DisplayDiffLine[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.type === 'context') {
      merged.push({
        ...line,
        leftType: 'context',
        rightType: 'context',
      });
      continue;
    }

    const removed: DiffLine[] = [];
    const added: DiffLine[] = [];
    while (i < lines.length && lines[i].type !== 'context') {
      if (lines[i].type === 'removed') {
        removed.push(lines[i]);
      } else {
        added.push(lines[i]);
      }
      i += 1;
    }

    const maxCount = Math.max(removed.length, added.length);
    for (let idx = 0; idx < maxCount; idx += 1) {
      const removedLine = removed[idx];
      const addedLine = added[idx];
      if (removedLine && addedLine) {
        merged.push({
          type: 'context',
          value: '',
          leftLineNumber: removedLine.leftLineNumber,
          rightLineNumber: addedLine.rightLineNumber,
          leftType: 'removed',
          rightType: 'added',
        });
      } else if (removedLine) {
        merged.push({
          ...removedLine,
          leftType: 'removed',
          rightType: 'context',
        });
      } else if (addedLine) {
        merged.push({
          ...addedLine,
          leftType: 'context',
          rightType: 'added',
        });
      }
    }

    if (i < lines.length && lines[i].type === 'context') {
      i -= 1;
    }
  }

  return merged;
};
```

- [ ] **Step 2: Update ObjectDiffModal to import from diffUtils**

In `frontend/src/ui/modals/ObjectDiffModal.tsx`, remove the inline definitions of `DisplayDiffLine`, `TruncationMap`, `areTruncationMapsEqual`, and `mergeDiffLines` (lines 138–221). Replace with an import:

```typescript
import {
  type DisplayDiffLine,
  type TruncationMap,
  areTruncationMapsEqual,
  mergeDiffLines,
} from '@shared/components/diff/diffUtils';
```

- [ ] **Step 3: Verify ObjectDiffModal still compiles**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 4: Run existing ObjectDiffModal tests**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx vitest run src/ui/modals/ObjectDiffModal.test.tsx --reporter=verbose`
Expected: All existing tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shared/components/diff/diffUtils.ts frontend/src/ui/modals/ObjectDiffModal.tsx
git commit -m "refactor: extract diff utilities to shared/components/diff/diffUtils"
```

---

## Task 6: Frontend — Extract DiffViewer Component

**Files:**
- Create: `frontend/src/shared/components/diff/DiffViewer.tsx`
- Create: `frontend/src/shared/components/diff/DiffViewer.css`
- Create: `frontend/src/shared/components/diff/DiffViewer.test.tsx`
- Modify: `frontend/src/ui/modals/ObjectDiffModal.tsx`
- Modify: `frontend/src/ui/modals/ObjectDiffModal.css`

- [ ] **Step 1: Create DiffViewer.css**

Extract the diff-table styles (lines 219–351) from `ObjectDiffModal.css` into a new file:

```css
/* frontend/src/shared/components/diff/DiffViewer.css */
/**
 * Shared diff table styles used by DiffViewer.
 * Extracted from ObjectDiffModal.css.
 */

.object-diff-table {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-mono);
  overflow: auto;
  max-height: none;
  user-select: none;
  -webkit-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
  flex: 1;
}

.object-diff-table.selection-left .object-diff-cell-left,
.object-diff-table.selection-right .object-diff-cell-right {
  user-select: text;
  -webkit-user-select: text;
  -moz-user-select: text;
  -ms-user-select: text;
}

.object-diff-table.selection-left .object-diff-cell-right,
.object-diff-table.selection-right .object-diff-cell-left {
  user-select: none;
  -webkit-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
}

.object-diff-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.object-diff-cell {
  display: grid;
  grid-template-columns: 3rem 1fr;
  align-items: start;
  gap: var(--spacing-sm);
  padding: var(--spacing-xs) var(--spacing-md);
  border-bottom: 1px solid var(--color-border);
  min-height: 1.4rem;
  min-width: 0;
}

.object-diff-cell-left {
  border-right: 1px solid var(--color-border);
}

.object-diff-line-number {
  color: var(--color-text-tertiary);
  text-align: right;
  align-self: start;
  user-select: none;
  -webkit-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
  pointer-events: none;
}

.object-diff-line-gutter {
  display: grid;
  grid-template-columns: 1rem 0.7fr;
  align-items: start;
  gap: var(--spacing-xs);
  user-select: none;
  -webkit-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
}

.object-diff-expand-toggle,
.object-diff-expand-placeholder {
  width: 0.1rem;
  height: 0.5rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.object-diff-expand-toggle {
  border: none;
  padding: 0;
  background: transparent;
  color: var(--color-text-tertiary);
  font-size: inherit;
  line-height: 1;
  cursor: pointer;
}

.object-diff-line-text {
  color: var(--color-text);
  display: block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: pre;
  user-select: inherit;
  -webkit-user-select: inherit;
  -moz-user-select: inherit;
  -ms-user-select: inherit;
}

.object-diff-cell-expanded .object-diff-line-text {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
  overflow: visible;
  text-overflow: clip;
}

.object-diff-cell-added {
  background: var(--color-success-bg);
}

.object-diff-cell-added .object-diff-line-text,
.object-diff-cell-added .object-diff-line-number {
  color: var(--color-success);
}

.object-diff-cell-removed {
  background: var(--color-error-bg);
}

.object-diff-cell-removed .object-diff-line-text,
.object-diff-cell-removed .object-diff-line-number {
  color: var(--color-error);
}

.object-diff-cell-muted .object-diff-line-text,
.object-diff-cell-muted .object-diff-line-number {
  color: var(--color-text-tertiary);
}
```

- [ ] **Step 2: Create DiffViewer.tsx**

```tsx
// frontend/src/shared/components/diff/DiffViewer.tsx
/**
 * Reusable side-by-side diff viewer component.
 * Extracted from ObjectDiffModal — renders a diff table from pre-computed DisplayDiffLine data.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import type { DisplayDiffLine, TruncationMap } from './diffUtils';
import { areTruncationMapsEqual } from './diffUtils';
import './DiffViewer.css';

export interface DiffViewerProps {
  /** Merged diff lines to display. */
  lines: DisplayDiffLine[];
  /** Original left-side text (newline-separated), used to look up line content. */
  leftText: string;
  /** Original right-side text (newline-separated), used to look up line content. */
  rightText: string;
  /** Line numbers on the left side that should be visually muted. */
  leftMutedLines?: Set<number>;
  /** Line numbers on the right side that should be visually muted. */
  rightMutedLines?: Set<number>;
  /** When true, only rows with at least one changed side are shown. */
  showDiffOnly?: boolean;
  /** Additional CSS class name for the table container. */
  className?: string;
}

const getLineText = (lines: string[], lineNumber?: number | null): string => {
  if (!lineNumber || lineNumber < 1) {
    return '';
  }
  return lines[lineNumber - 1] ?? '';
};

const DiffViewer: React.FC<DiffViewerProps> = ({
  lines,
  leftText,
  rightText,
  leftMutedLines,
  rightMutedLines,
  showDiffOnly = false,
  className,
}) => {
  const [selectionSide, setSelectionSide] = useState<'left' | 'right'>('left');
  const [expandedRows, setExpandedRows] = useState<Set<number>>(() => new Set());
  const [truncatedRows, setTruncatedRows] = useState<TruncationMap>({});
  const diffTableRef = useRef<HTMLDivElement>(null);
  const truncatedRowsRef = useRef<TruncationMap>({});

  const leftDisplayLines = useMemo(() => leftText.split('\n'), [leftText]);
  const rightDisplayLines = useMemo(() => rightText.split('\n'), [rightText]);

  const emptyMutedSet = useMemo(() => new Set<number>(), []);
  const resolvedLeftMuted = leftMutedLines ?? emptyMutedSet;
  const resolvedRightMuted = rightMutedLines ?? emptyMutedSet;

  const visibleLines = useMemo(() => {
    if (!showDiffOnly) {
      return lines;
    }
    return lines.filter(
      (line) => line.leftType !== 'context' || line.rightType !== 'context'
    );
  }, [lines, showDiffOnly]);

  // Keep ref in sync.
  useEffect(() => {
    truncatedRowsRef.current = truncatedRows;
  }, [truncatedRows]);

  // Reset expansion/truncation when lines change.
  useEffect(() => {
    setExpandedRows(new Set());
    setTruncatedRows({});
  }, [visibleLines]);

  // Measure text overflow to decide which rows should show expand/collapse toggles.
  const computeTruncation = useCallback(() => {
    const table = diffTableRef.current;
    if (!table) {
      return;
    }

    const next: TruncationMap = {};
    const prev = truncatedRowsRef.current;
    const nodes = table.querySelectorAll<HTMLElement>(
      '.object-diff-line-text[data-row-index][data-side]'
    );

    nodes.forEach((node) => {
      const rowIndex = Number(node.dataset.rowIndex);
      if (Number.isNaN(rowIndex)) {
        return;
      }
      if (expandedRows.has(rowIndex)) {
        if (prev[rowIndex]) {
          next[rowIndex] = { ...prev[rowIndex] };
        }
        return;
      }

      const side = node.dataset.side === 'right' ? 'right' : 'left';
      const isTruncated = node.scrollWidth > node.clientWidth;
      if (!next[rowIndex]) {
        next[rowIndex] = { left: false, right: false };
      }
      next[rowIndex][side] = isTruncated;
    });

    expandedRows.forEach((rowIndex) => {
      if (prev[rowIndex] && !next[rowIndex]) {
        next[rowIndex] = { ...prev[rowIndex] };
      }
    });

    setTruncatedRows((current) => (areTruncationMapsEqual(current, next) ? current : next));
  }, [expandedRows]);

  useEffect(() => {
    if (!diffTableRef.current) {
      return;
    }
    const frame = requestAnimationFrame(() => computeTruncation());
    return () => cancelAnimationFrame(frame);
  }, [computeTruncation, visibleLines]);

  useEffect(() => {
    const table = diffTableRef.current;
    if (!table || typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => computeTruncation());
    observer.observe(table);
    return () => observer.disconnect();
  }, [computeTruncation]);

  const toggleExpandedRow = (rowIndex: number) => {
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(rowIndex)) {
        next.delete(rowIndex);
      } else {
        next.add(rowIndex);
      }
      return next;
    });
  };

  const selectSideText = (side: 'left' | 'right') => {
    const table = diffTableRef.current;
    if (!table) {
      return;
    }
    const selector =
      side === 'left'
        ? '.object-diff-cell-left .object-diff-line-text'
        : '.object-diff-cell-right .object-diff-line-text';
    const nodes = Array.from(table.querySelectorAll<HTMLElement>(selector));
    if (nodes.length === 0) {
      return;
    }
    const selection = window.getSelection();
    if (!selection) {
      return;
    }
    const firstNode = nodes[0].firstChild ?? nodes[0];
    const lastNode = nodes[nodes.length - 1].firstChild ?? nodes[nodes.length - 1];
    const range = document.createRange();
    range.setStart(firstNode, 0);
    if (lastNode.nodeType === Node.TEXT_NODE) {
      range.setEnd(lastNode, lastNode.textContent?.length ?? 0);
    } else {
      range.setEnd(lastNode, lastNode.childNodes.length);
    }
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const renderDiffRow = (line: DisplayDiffLine, index: number) => {
    const leftTextContent = getLineText(leftDisplayLines, line.leftLineNumber);
    const rightTextContent = getLineText(rightDisplayLines, line.rightLineNumber);
    const leftNumber =
      line.leftLineNumber !== null && line.leftLineNumber !== undefined ? line.leftLineNumber : '';
    const rightNumber =
      line.rightLineNumber !== null && line.rightLineNumber !== undefined
        ? line.rightLineNumber
        : '';
    const leftType = line.leftType;
    const rightType = line.rightType;
    const leftMuted =
      line.leftLineNumber !== null &&
      line.leftLineNumber !== undefined &&
      resolvedLeftMuted.has(line.leftLineNumber);
    const rightMuted =
      line.rightLineNumber !== null &&
      line.rightLineNumber !== undefined &&
      resolvedRightMuted.has(line.rightLineNumber);
    const rowTruncation = truncatedRows[index];
    const isExpanded = expandedRows.has(index);
    const leftHasToggle = Boolean(rowTruncation?.left);
    const rightHasToggle = Boolean(rowTruncation?.right);
    const toggleSymbol = isExpanded ? '▼' : '▶︎';

    const renderLineGutter = (
      side: 'left' | 'right',
      lineNumber: number | string,
      showToggle: boolean
    ) => (
      <span className="object-diff-line-gutter">
        {showToggle ? (
          <button
            type="button"
            className="object-diff-expand-toggle"
            onMouseDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              toggleExpandedRow(index);
            }}
            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${side} line ${lineNumber}`}
          >
            {toggleSymbol}
          </button>
        ) : (
          <span className="object-diff-expand-placeholder" aria-hidden="true" />
        )}
        <span className="object-diff-line-number">{lineNumber}</span>
      </span>
    );

    return (
      <div key={`diff-${index}`} className={`object-diff-row object-diff-row-${line.type}`}>
        <div
          className={[
            'object-diff-cell',
            'object-diff-cell-left',
            `object-diff-cell-${leftType}`,
            isExpanded ? 'object-diff-cell-expanded' : '',
            leftMuted ? 'object-diff-cell-muted' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {renderLineGutter('left', leftNumber, leftHasToggle)}
          <span className="object-diff-line-text" data-row-index={index} data-side="left">
            {leftTextContent}
          </span>
        </div>
        <div
          className={[
            'object-diff-cell',
            'object-diff-cell-right',
            `object-diff-cell-${rightType}`,
            isExpanded ? 'object-diff-cell-expanded' : '',
            rightMuted ? 'object-diff-cell-muted' : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {renderLineGutter('right', rightNumber, rightHasToggle)}
          <span className="object-diff-line-text" data-row-index={index} data-side="right">
            {rightTextContent}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div
      className={`object-diff-table selection-${selectionSide}${className ? ` ${className}` : ''}`}
      ref={diffTableRef}
      onMouseDown={(event) => {
        const target = event.target as HTMLElement | null;
        if (target?.closest('.object-diff-cell-left')) {
          flushSync(() => setSelectionSide('left'));
          return;
        }
        if (target?.closest('.object-diff-cell-right')) {
          flushSync(() => setSelectionSide('right'));
        }
      }}
      onClick={(event) => {
        if (event.detail !== 3) {
          return;
        }
        const target = event.target as HTMLElement | null;
        const side = target?.closest('.object-diff-cell-left')
          ? 'left'
          : target?.closest('.object-diff-cell-right')
            ? 'right'
            : null;
        if (!side) {
          return;
        }
        event.preventDefault();
        flushSync(() => setSelectionSide(side));
        selectSideText(side);
      }}
    >
      {visibleLines.map(renderDiffRow)}
    </div>
  );
};

export default DiffViewer;
```

- [ ] **Step 3: Write DiffViewer tests**

```tsx
// frontend/src/shared/components/diff/DiffViewer.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { DisplayDiffLine } from './diffUtils';
import DiffViewer from './DiffViewer';

const contextLine = (leftNum: number, rightNum: number): DisplayDiffLine => ({
  type: 'context',
  value: '',
  leftLineNumber: leftNum,
  rightLineNumber: rightNum,
  leftType: 'context',
  rightType: 'context',
});

const changedLine = (leftNum: number | null, rightNum: number | null): DisplayDiffLine => ({
  type: 'context',
  value: '',
  leftLineNumber: leftNum,
  rightLineNumber: rightNum,
  leftType: leftNum !== null ? 'removed' : 'context',
  rightType: rightNum !== null ? 'added' : 'context',
});

describe('DiffViewer', () => {
  it('renders context lines with correct text', () => {
    const lines: DisplayDiffLine[] = [contextLine(1, 1)];
    render(
      <DiffViewer
        lines={lines}
        leftText="hello world"
        rightText="hello world"
      />
    );
    const textElements = screen.getAllByText('hello world');
    expect(textElements.length).toBe(2); // left + right
  });

  it('applies added/removed classes', () => {
    const lines: DisplayDiffLine[] = [changedLine(1, 1)];
    render(
      <DiffViewer
        lines={lines}
        leftText="old line"
        rightText="new line"
      />
    );
    const cells = document.querySelectorAll('.object-diff-cell');
    const leftCell = cells[0];
    const rightCell = cells[1];
    expect(leftCell.classList.contains('object-diff-cell-removed')).toBe(true);
    expect(rightCell.classList.contains('object-diff-cell-added')).toBe(true);
  });

  it('filters to diff-only when showDiffOnly is true', () => {
    const lines: DisplayDiffLine[] = [
      contextLine(1, 1),
      changedLine(2, 2),
      contextLine(3, 3),
    ];
    const { container } = render(
      <DiffViewer
        lines={lines}
        leftText="aaa\nold\nccc"
        rightText="aaa\nnew\nccc"
        showDiffOnly={true}
      />
    );
    const rows = container.querySelectorAll('.object-diff-row');
    // Only the changed row should be visible.
    expect(rows.length).toBe(1);
  });

  it('applies muted class to specified lines', () => {
    const lines: DisplayDiffLine[] = [contextLine(1, 1)];
    const leftMuted = new Set([1]);
    render(
      <DiffViewer
        lines={lines}
        leftText="uid: abc"
        rightText="uid: def"
        leftMutedLines={leftMuted}
      />
    );
    const leftCell = document.querySelector('.object-diff-cell-left');
    expect(leftCell?.classList.contains('object-diff-cell-muted')).toBe(true);
  });

  it('renders empty when no lines provided', () => {
    const { container } = render(
      <DiffViewer lines={[]} leftText="" rightText="" />
    );
    const rows = container.querySelectorAll('.object-diff-row');
    expect(rows.length).toBe(0);
  });
});
```

- [ ] **Step 4: Run DiffViewer tests**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx vitest run src/shared/components/diff/DiffViewer.test.tsx --reporter=verbose`
Expected: All tests PASS.

- [ ] **Step 5: Update ObjectDiffModal to use DiffViewer**

In `frontend/src/ui/modals/ObjectDiffModal.tsx`:

1. Add import: `import DiffViewer from '@shared/components/diff/DiffViewer';`
2. Remove the inline `getLineText`, `selectSideText`, `toggleExpandedRow`, `renderDiffRow` functions (lines ~991-1149).
3. Remove the `selectionSide`, `expandedRows`, `truncatedRows` state declarations and all their associated `useEffect`/`useCallback` hooks (the `computeTruncation` callback, the ResizeObserver effect, the rAF effect, the `truncatedRowsRef`).
4. In `renderDiffContent()`, replace the `<div className={...object-diff-table...}>` block (lines ~1204-1237) with:

```tsx
    return (
      <DiffViewer
        lines={displayDiffLines}
        leftText={leftYamlNormalized}
        rightText={rightYamlNormalized}
        leftMutedLines={leftMutedLines}
        rightMutedLines={rightMutedLines}
        showDiffOnly={showDiffOnly}
      />
    );
```

Note: The `displayDiffLines` computation (`useMemo(() => mergeDiffLines(...)`) stays in ObjectDiffModal since it feeds both the `DiffViewer` and the `diffTruncated` / `showDiffOnly && visibleDiffLines.length === 0` checks in `renderDiffContent`. But the `visibleDiffLines` memo can be removed since DiffViewer handles filtering internally. Update `renderDiffContent` to check `displayDiffLines.length === 0` instead of `visibleDiffLines.length === 0` for the "no diffs" case, or keep it checking the unfiltered lines:

```tsx
    if (showDiffOnly && displayDiffLines.every(
      (line) => line.leftType === 'context' && line.rightType === 'context'
    )) {
      return (
        <div className="object-diff-empty object-diff-success">
          No diffs. Compared objects are identical.
        </div>
      );
    }
```

- [ ] **Step 6: Remove diff-table styles from ObjectDiffModal.css**

In `frontend/src/ui/modals/ObjectDiffModal.css`, remove lines 219–351 (the `.object-diff-table` through `.object-diff-cell-muted` styles). Also update the media query at the bottom — keep the `.object-diff-selector-grid` and `.object-diff-column-headers` rules, but move the `.object-diff-row` and `.object-diff-cell-left` responsive rules into `DiffViewer.css`:

Add to the bottom of `DiffViewer.css`:

```css
@media (max-width: 900px) {
  .object-diff-row {
    grid-template-columns: 1fr;
  }

  .object-diff-cell-left {
    border-right: none;
  }
}
```

- [ ] **Step 7: Run all tests to verify nothing broke**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx vitest run --reporter=verbose 2>&1 | tail -20`
Expected: All tests PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/shared/components/diff/ frontend/src/ui/modals/ObjectDiffModal.tsx frontend/src/ui/modals/ObjectDiffModal.css
git commit -m "refactor: extract DiffViewer component from ObjectDiffModal"
```

---

## Task 7: Frontend — RollbackIcon

**Files:**
- Modify: `frontend/src/shared/components/icons/MenuIcons.tsx`

- [ ] **Step 1: Add RollbackIcon to MenuIcons.tsx**

Add the following export after the existing icons (e.g. after `RestartIcon`):

```tsx
export const RollbackIcon: React.FC<IconProps> = ({
  width = 16,
  height = 16,
  fill = 'currentColor',
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill={fill}
    width={width}
    height={height}
  >
    <path d="M5.82843 6.99955L8.36396 9.53509L6.94975 10.9493L2 5.99955L6.94975 1.0498L8.36396 2.46402L5.82843 4.99955H13C17.4183 4.99955 21 8.58127 21 12.9996C21 17.4178 17.4183 20.9996 13 20.9996H4V18.9996H13C16.3137 18.9996 19 16.3133 19 12.9996C19 9.68584 16.3137 6.99955 13 6.99955H5.82843Z" />
  </svg>
);
```

This is a counter-clockwise arrow (undo/rollback) from the Remix Icon set — visually distinct from the circular restart icon.

- [ ] **Step 2: Verify it compiles**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx tsc --noEmit 2>&1 | head -10`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/shared/components/icons/MenuIcons.tsx
git commit -m "feat: add RollbackIcon to MenuIcons"
```

---

## Task 8: Frontend — RollbackModal Component

**Files:**
- Create: `frontend/src/shared/components/modals/RollbackModal.tsx`
- Create: `frontend/src/shared/components/modals/RollbackModal.css`
- Create: `frontend/src/shared/components/modals/RollbackModal.test.tsx`

- [ ] **Step 1: Create RollbackModal.css**

```css
/* frontend/src/shared/components/modals/RollbackModal.css */

.rollback-modal {
  max-width: 80vw;
  width: 80vw;
  height: 80vh;
  display: flex;
  flex-direction: column;
}

.rollback-modal .modal-content {
  display: flex;
  flex: 1;
  overflow: hidden;
  gap: 0;
}

.rollback-revision-list {
  width: 280px;
  min-width: 280px;
  border-right: 1px solid var(--color-border);
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.rollback-revision-item {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
  padding: var(--spacing-sm) var(--spacing-md);
  border-bottom: 1px solid var(--color-border);
  cursor: pointer;
  background: transparent;
  border: none;
  border-bottom: 1px solid var(--color-border);
  text-align: left;
  width: 100%;
  font-family: inherit;
  font-size: inherit;
  color: inherit;
}

.rollback-revision-item:hover {
  background: var(--color-bg-hover);
}

.rollback-revision-item.selected {
  background: var(--color-bg-selected);
}

.rollback-revision-item.current {
  opacity: 0.5;
  cursor: default;
}

.rollback-revision-item.current:hover {
  background: transparent;
}

.rollback-revision-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.rollback-revision-number {
  font-weight: 600;
  font-size: 0.85rem;
}

.rollback-revision-badge {
  font-size: 0.7rem;
  padding: 1px 6px;
  border-radius: 3px;
  background: var(--color-info-bg);
  color: var(--color-info);
}

.rollback-revision-meta {
  font-size: 0.75rem;
  color: var(--color-text-secondary);
}

.rollback-revision-cause {
  font-size: 0.75rem;
  color: var(--color-text-tertiary);
  font-style: italic;
}

.rollback-diff-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.rollback-diff-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-sm) var(--spacing-md);
  border-bottom: 1px solid var(--color-border);
  font-size: 0.8rem;
  color: var(--color-text-secondary);
}

.rollback-diff-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-tertiary);
  font-size: 0.85rem;
}

.rollback-loading {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
}

.rollback-error {
  padding: var(--spacing-md);
  color: var(--color-error);
}

.rollback-footer-error {
  color: var(--color-error);
  font-size: 0.8rem;
  margin-right: auto;
}
```

- [ ] **Step 2: Create RollbackModal.tsx**

```tsx
// frontend/src/shared/components/modals/RollbackModal.tsx
/**
 * Modal for rolling back a workload to a previous revision.
 * Shows revision history with diffs against the current state.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

import * as app from '@wailsjs/go/backend/App';
import type { backend } from '@wailsjs/go/models';
import { useShortcut, useKeyboardContext } from '@ui/shortcuts';
import { useModalFocusTrap } from './useModalFocusTrap';
import { computeLineDiff } from '@modules/object-panel/components/ObjectPanel/Yaml/yamlDiff';
import { mergeDiffLines } from '@shared/components/diff/diffUtils';
import DiffViewer from '@shared/components/diff/DiffViewer';
import ConfirmationModal from './ConfirmationModal';
import './RollbackModal.css';

export interface RollbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  clusterId: string;
  namespace: string;
  name: string;
  kind: string;
}

// Format an RFC3339 timestamp as a relative age string.
const formatAge = (isoString: string): string => {
  const date = new Date(isoString);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

const RollbackModal: React.FC<RollbackModalProps> = ({
  isOpen,
  onClose,
  clusterId,
  namespace,
  name,
  kind,
}) => {
  const [revisions, setRevisions] = useState<backend.RevisionEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedRevision, setSelectedRevision] = useState<number | null>(null);
  const [showDiffOnly, setShowDiffOnly] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [rollbackLoading, setRollbackLoading] = useState(false);
  const [rollbackError, setRollbackError] = useState<string | null>(null);

  const { pushContext, popContext } = useKeyboardContext();
  const modalRef = useModalFocusTrap(isOpen);

  // Register keyboard context when modal is open.
  useEffect(() => {
    if (isOpen) {
      pushContext('rollback-modal');
      return () => popContext('rollback-modal');
    }
  }, [isOpen, pushContext, popContext]);

  useShortcut('rollback-modal', 'Escape', onClose);

  // Fetch revision history when modal opens.
  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);
    setSelectedRevision(null);
    setRollbackError(null);

    app.GetRevisionHistory(clusterId, namespace, name, kind)
      .then((result) => {
        setRevisions(result ?? []);
        // Auto-select the most recent non-current revision.
        const firstNonCurrent = (result ?? []).find((r) => !r.current);
        if (firstNonCurrent) {
          setSelectedRevision(firstNonCurrent.revision);
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setLoading(false));
  }, [isOpen, clusterId, namespace, name, kind]);

  // Find the current and selected revision data.
  const currentRevision = useMemo(
    () => revisions.find((r) => r.current),
    [revisions]
  );
  const selectedRevisionData = useMemo(
    () => revisions.find((r) => r.revision === selectedRevision),
    [revisions, selectedRevision]
  );

  // Compute the diff between current and selected revision pod templates.
  const diffData = useMemo(() => {
    if (!currentRevision || !selectedRevisionData) return null;
    const result = computeLineDiff(currentRevision.podTemplate, selectedRevisionData.podTemplate);
    return {
      lines: mergeDiffLines(result.lines),
      truncated: result.truncated,
    };
  }, [currentRevision, selectedRevisionData]);

  const handleRollback = useCallback(async () => {
    if (selectedRevision === null) return;
    setRollbackLoading(true);
    setRollbackError(null);
    try {
      await app.RollbackWorkload(clusterId, namespace, name, kind, selectedRevision);
      setConfirmOpen(false);
      onClose();
    } catch (err) {
      setRollbackError(err instanceof Error ? err.message : String(err));
    } finally {
      setRollbackLoading(false);
    }
  }, [clusterId, namespace, name, kind, selectedRevision, onClose]);

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  if (!isOpen) return null;

  const hasRevisionsToRollback = revisions.filter((r) => !r.current).length > 0;

  return createPortal(
    <div className="modal-overlay" onMouseDown={handleBackdropClick}>
      <div className="modal-container rollback-modal" ref={modalRef}>
        <div className="modal-header">
          <h2>Rollback {kind} — {name}</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="modal-content">
          {loading && <div className="rollback-loading">Loading revision history…</div>}

          {error && <div className="rollback-error">{error}</div>}

          {!loading && !error && !hasRevisionsToRollback && (
            <div className="rollback-diff-empty">
              No previous revisions available for rollback.
            </div>
          )}

          {!loading && !error && hasRevisionsToRollback && (
            <>
              {/* Revision list */}
              <div className="rollback-revision-list">
                {revisions.map((rev) => (
                  <button
                    key={rev.revision}
                    type="button"
                    className={[
                      'rollback-revision-item',
                      rev.current ? 'current' : '',
                      selectedRevision === rev.revision ? 'selected' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    onClick={() => {
                      if (!rev.current) setSelectedRevision(rev.revision);
                    }}
                    disabled={rev.current}
                  >
                    <div className="rollback-revision-header">
                      <span className="rollback-revision-number">Revision {rev.revision}</span>
                      {rev.current && <span className="rollback-revision-badge">current</span>}
                    </div>
                    <span className="rollback-revision-meta">{formatAge(rev.createdAt)}</span>
                    {rev.changeCause && (
                      <span className="rollback-revision-cause">{rev.changeCause}</span>
                    )}
                  </button>
                ))}
              </div>

              {/* Diff panel */}
              <div className="rollback-diff-panel">
                {selectedRevisionData && diffData ? (
                  <>
                    <div className="rollback-diff-header">
                      <span>Current → Revision {selectedRevision}</span>
                      <label>
                        <input
                          type="checkbox"
                          checked={showDiffOnly}
                          onChange={(e) => setShowDiffOnly(e.target.checked)}
                        />{' '}
                        Diff only
                      </label>
                    </div>
                    {diffData.lines.length === 0 ? (
                      <div className="rollback-diff-empty">
                        No differences — this revision is identical to the current state.
                      </div>
                    ) : (
                      <DiffViewer
                        lines={diffData.lines}
                        leftText={currentRevision?.podTemplate ?? ''}
                        rightText={selectedRevisionData.podTemplate}
                        showDiffOnly={showDiffOnly}
                      />
                    )}
                  </>
                ) : (
                  <div className="rollback-diff-empty">Select a revision to view changes.</div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          {rollbackError && <span className="rollback-footer-error">{rollbackError}</span>}
          <button type="button" className="button cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="button warning"
            disabled={selectedRevision === null || loading || rollbackLoading}
            onClick={() => setConfirmOpen(true)}
          >
            {rollbackLoading ? 'Rolling back…' : `Rollback to Revision ${selectedRevision ?? ''}`}
          </button>
        </div>
      </div>

      <ConfirmationModal
        isOpen={confirmOpen}
        title={`Rollback ${kind}`}
        message={`Are you sure you want to rollback ${kind.toLowerCase()} "${name}" to revision ${selectedRevision}?\n\nThis will update the pod template to match the selected revision.`}
        confirmText="Rollback"
        cancelText="Cancel"
        confirmButtonClass="button warning"
        onConfirm={handleRollback}
        onCancel={() => {
          setConfirmOpen(false);
          setRollbackError(null);
        }}
      />
    </div>,
    document.body
  );
};

export default RollbackModal;
```

- [ ] **Step 3: Write RollbackModal tests**

```tsx
// frontend/src/shared/components/modals/RollbackModal.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

import RollbackModal from './RollbackModal';

// Mock Wails bindings.
const mockGetRevisionHistory = vi.fn();
const mockRollbackWorkload = vi.fn();

vi.mock('@wailsjs/go/backend/App', () => ({
  GetRevisionHistory: (...args: unknown[]) => mockGetRevisionHistory(...args),
  RollbackWorkload: (...args: unknown[]) => mockRollbackWorkload(...args),
}));

// Mock keyboard context.
vi.mock('@ui/shortcuts', () => ({
  useShortcut: vi.fn(),
  useKeyboardContext: () => ({ pushContext: vi.fn(), popContext: vi.fn() }),
}));

// Mock focus trap.
vi.mock('./useModalFocusTrap', () => ({
  useModalFocusTrap: () => ({ current: null }),
}));

const sampleRevisions = [
  {
    revision: 3,
    createdAt: new Date().toISOString(),
    changeCause: '',
    current: true,
    podTemplate: 'spec:\n  containers:\n  - image: nginx:1.25',
  },
  {
    revision: 2,
    createdAt: new Date(Date.now() - 3600000).toISOString(),
    changeCause: 'update image',
    current: false,
    podTemplate: 'spec:\n  containers:\n  - image: nginx:1.24',
  },
  {
    revision: 1,
    createdAt: new Date(Date.now() - 7200000).toISOString(),
    changeCause: 'initial deploy',
    current: false,
    podTemplate: 'spec:\n  containers:\n  - image: nginx:1.23',
  },
];

const defaultProps = {
  isOpen: true,
  onClose: vi.fn(),
  clusterId: 'config:ctx',
  namespace: 'default',
  name: 'web',
  kind: 'Deployment',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RollbackModal', () => {
  it('renders loading state then revision list', async () => {
    mockGetRevisionHistory.mockResolvedValue(sampleRevisions);
    render(<RollbackModal {...defaultProps} />);

    // Should show loading initially.
    expect(screen.getByText('Loading revision history…')).toBeTruthy();

    // After loading, should show revision list.
    await waitFor(() => {
      expect(screen.getByText('Revision 3')).toBeTruthy();
      expect(screen.getByText('Revision 2')).toBeTruthy();
      expect(screen.getByText('Revision 1')).toBeTruthy();
    });

    // Current badge should appear on revision 3.
    expect(screen.getByText('current')).toBeTruthy();
  });

  it('auto-selects most recent non-current revision', async () => {
    mockGetRevisionHistory.mockResolvedValue(sampleRevisions);
    render(<RollbackModal {...defaultProps} />);

    await waitFor(() => {
      // The rollback button should target revision 2.
      expect(screen.getByText('Rollback to Revision 2')).toBeTruthy();
    });
  });

  it('shows error state when fetch fails', async () => {
    mockGetRevisionHistory.mockRejectedValue(new Error('cluster not found'));
    render(<RollbackModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('cluster not found')).toBeTruthy();
    });
  });

  it('shows empty message when no revisions to roll back to', async () => {
    mockGetRevisionHistory.mockResolvedValue([
      { ...sampleRevisions[0], revision: 1 },
    ]);
    render(<RollbackModal {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByText('No previous revisions available for rollback.')).toBeTruthy();
    });
  });

  it('does not render when isOpen is false', () => {
    const { container } = render(<RollbackModal {...defaultProps} isOpen={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('displays the modal title with kind and name', async () => {
    mockGetRevisionHistory.mockResolvedValue(sampleRevisions);
    render(<RollbackModal {...defaultProps} />);
    expect(screen.getByText('Rollback Deployment — web')).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run RollbackModal tests**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx vitest run src/shared/components/modals/RollbackModal.test.tsx --reporter=verbose`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shared/components/modals/RollbackModal.tsx frontend/src/shared/components/modals/RollbackModal.css frontend/src/shared/components/modals/RollbackModal.test.tsx
git commit -m "feat: add RollbackModal component with revision history and diff"
```

---

## Task 9: Frontend — Action Integration (useObjectActions + actionPlanner)

**Files:**
- Modify: `frontend/src/shared/hooks/useObjectActions.tsx`
- Modify: `frontend/src/core/capabilities/actionPlanner.ts`

- [ ] **Step 1: Add rollback to useObjectActions.tsx**

1. Add `RollbackIcon` to the import from `MenuIcons`:

```typescript
import {
  OpenIcon,
  RestartIcon,
  ScaleIcon,
  DeleteIcon,
  PortForwardIcon,
  RollbackIcon,
} from '@shared/components/icons/MenuIcons';
```

2. Add the `ROLLBACKABLE_KINDS` constant (after `RESTARTABLE_KINDS`):

```typescript
export const ROLLBACKABLE_KINDS = ['Deployment', 'StatefulSet', 'DaemonSet'];
```

3. Add `onRollback` to `ObjectActionHandlers`:

```typescript
export interface ObjectActionHandlers {
  onOpen?: () => void;
  onRestart?: () => void;
  onRollback?: () => void;
  onScale?: () => void;
  // ... rest unchanged
}
```

4. Add `rollback` to the permissions in `BuildObjectActionsOptions`:

```typescript
  permissions: {
    restart?: PermissionStatus | null;
    rollback?: PermissionStatus | null;
    scale?: PermissionStatus | null;
    delete?: PermissionStatus | null;
    portForward?: PermissionStatus | null;
  };
```

5. In `buildObjectActionItems`, destructure `rollback: rollbackStatus` from permissions and include it in `anyPending`:

```typescript
  const {
    restart: restartStatus,
    rollback: rollbackStatus,
    scale: scaleStatus,
    delete: deleteStatus,
    portForward: portForwardStatus,
  } = permissions;

  const anyPending =
    restartStatus?.pending ||
    rollbackStatus?.pending ||
    scaleStatus?.pending ||
    deleteStatus?.pending ||
    portForwardStatus?.pending;
```

6. Add the Rollback menu item after Restart (insert before the Scale section):

```typescript
  // Rollback
  if (
    ROLLBACKABLE_KINDS.includes(normalizedKind) &&
    rollbackStatus?.allowed &&
    !rollbackStatus.pending &&
    handlers.onRollback
  ) {
    menuItems.push({
      label: 'Rollback',
      icon: <RollbackIcon />,
      onClick: handlers.onRollback,
      disabled: actionLoading,
    });
  }
```

7. In the `useObjectActions` hook, add `rollbackStatus` lookup (rollback uses `patch` permission, same as restart — reuse the same permission key):

```typescript
    const rollbackStatus = restartStatus; // Same permission: patch on the workload kind.
```

Then pass it in the `permissions` object:

```typescript
      permissions: {
        restart: restartStatus,
        rollback: rollbackStatus,
        scale: scaleStatus,
        delete: deleteStatus,
        portForward: portForwardStatus,
      },
```

- [ ] **Step 2: Register rollback capability in actionPlanner.ts**

In `frontend/src/core/capabilities/actionPlanner.ts`:

1. Add `'core.nodes.workload.rollback'` to the `CapabilityActionId` union type.

2. Add a new `registerNamespaceAction` call. Follow the exact pattern used by the restart action — look at the `ownerRestartDefinition` function and create an analogous `ownerRollbackDefinition`. The capability definition should use the `patch` verb on the workload kind (same as restart):

```typescript
const ownerRollbackDefinition = (
  namespace: string,
  kind: string,
  ownerKind: string
): CapabilityDefinition => ({
  apiVersion: 'apps/v1',
  resource: kind.toLowerCase() + 's',
  namespace,
  verb: 'patch',
  ownerKind,
});

registerNamespaceAction({
  id: 'core.nodes.workload.rollback',
  build: ({ namespace, ownerKinds }) => {
    const definitions: CapabilityDefinition[] = [];
    for (const [key, value] of Object.entries(RestartableOwnerKind)) {
      if (ownerKinds.has(value)) {
        definitions.push(ownerRollbackDefinition(namespace, key, value));
      }
    }
    return definitions;
  },
});
```

Note: `RestartableOwnerKind` is the same mapping as for restart — Deployments, StatefulSets, DaemonSets. Reuse the existing constant rather than creating a new one.

- [ ] **Step 3: Verify it compiles**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 4: Run useObjectActions tests if they exist**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx vitest run --reporter=verbose 2>&1 | grep -i "object.*action\|PASS\|FAIL" | head -20`
Expected: All existing tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/shared/hooks/useObjectActions.tsx frontend/src/core/capabilities/actionPlanner.ts
git commit -m "feat: add rollback action to menu system and capability planner"
```

---

## Task 10: Frontend — Object Panel Types and Actions

**Files:**
- Modify: `frontend/src/modules/object-panel/components/ObjectPanel/types.ts`
- Modify: `frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelActions.ts`

- [ ] **Step 1: Update Object Panel types**

In `frontend/src/modules/object-panel/components/ObjectPanel/types.ts`:

1. Add `showRollbackModal` to `PanelState`:

```typescript
export type PanelState = {
  // UI state
  activeTab: ViewType;

  // Action state
  actionLoading: boolean;
  actionError: string | null;
  scaleReplicas: number;
  showScaleInput: boolean;
  showRestartConfirm: boolean;
  showDeleteConfirm: boolean;
  showRollbackModal: boolean;

  // Resource deletion state
  resourceDeleted: boolean;
  deletedResourceName: string;
};
```

2. Add `SHOW_ROLLBACK_MODAL` to `PanelAction`:

```typescript
export type PanelAction =
  | { type: 'SET_ACTIVE_TAB'; payload: ViewType }
  | { type: 'SET_ACTION_LOADING'; payload: boolean }
  | { type: 'SET_ACTION_ERROR'; payload: string | null }
  | { type: 'SET_SCALE_REPLICAS'; payload: number }
  | { type: 'SHOW_SCALE_INPUT'; payload: boolean }
  | { type: 'SHOW_RESTART_CONFIRM'; payload: boolean }
  | { type: 'SHOW_DELETE_CONFIRM'; payload: boolean }
  | { type: 'SHOW_ROLLBACK_MODAL'; payload: boolean }
  | { type: 'SET_RESOURCE_DELETED'; payload: { deleted: boolean; name: string } }
  | { type: 'RESET_STATE' };
```

3. Add `'rollback'` to `ResourceAction`:

```typescript
export type ResourceAction = 'restart' | 'delete' | 'scale' | 'rollback';
```

- [ ] **Step 2: Update the Object Panel reducer**

Find the reducer function (likely in the ObjectPanel component or a separate reducer file) and add handling for `SHOW_ROLLBACK_MODAL`. Search for where the existing `SHOW_RESTART_CONFIRM` case is handled and add the new case following the same pattern. Also set `showRollbackModal: false` in the initial state and in `RESET_STATE`.

- [ ] **Step 3: Update useObjectPanelActions**

In `frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelActions.ts`:

1. Add `showRollbackModal` / `hideRollbackModal` to the `ObjectPanelActions` interface:

```typescript
interface ObjectPanelActions {
  handleAction: (
    action: ResourceAction,
    confirmModalType?: 'showRestartConfirm' | 'showDeleteConfirm',
    scaleOverride?: number
  ) => Promise<void>;
  setScaleReplicas: (value: number) => void;
  showScaleInput: (replicas?: number) => void;
  hideScaleInput: () => void;
  showRestartConfirm: () => void;
  hideRestartConfirm: () => void;
  showDeleteConfirm: () => void;
  hideDeleteConfirm: () => void;
  showRollbackModal: () => void;
  hideRollbackModal: () => void;
}
```

2. Add the callback implementations:

```typescript
  const showRollbackModal = useCallback(() => {
    dispatch({ type: 'SHOW_ROLLBACK_MODAL', payload: true });
  }, [dispatch]);

  const hideRollbackModal = useCallback(() => {
    dispatch({ type: 'SHOW_ROLLBACK_MODAL', payload: false });
  }, [dispatch]);
```

3. The `handleAction` switch does NOT need a `'rollback'` case — the rollback action opens the RollbackModal directly (via `showRollbackModal`), it doesn't go through `handleAction`. The modal handles the API call internally.

4. Add the new functions to the return object:

```typescript
  return {
    handleAction,
    setScaleReplicas,
    showScaleInput,
    hideScaleInput,
    showRestartConfirm,
    hideRestartConfirm,
    showDeleteConfirm,
    hideDeleteConfirm,
    showRollbackModal,
    hideRollbackModal,
  };
```

- [ ] **Step 4: Wire RollbackModal into the Object Panel component**

Find the ObjectPanel component that renders `ConfirmationModal` and `ScaleModal`. Add:

```tsx
import RollbackModal from '@shared/components/modals/RollbackModal';
```

And render it alongside the other modals:

```tsx
<RollbackModal
  isOpen={state.showRollbackModal}
  onClose={actions.hideRollbackModal}
  clusterId={objectData?.clusterId ?? ''}
  namespace={objectData?.namespace ?? ''}
  name={objectData?.name ?? ''}
  kind={objectData?.kind ?? ''}
/>
```

Wire the `onRollback` handler in the Object Panel's action menu to call `actions.showRollbackModal()`.

- [ ] **Step 5: Verify it compiles**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/object-panel/
git commit -m "feat: wire rollback action into object panel"
```

---

## Task 11: Frontend — NsViewWorkloads Integration

**Files:**
- Modify: `frontend/src/modules/namespace/components/NsViewWorkloads.tsx`

- [ ] **Step 1: Add rollback state and modal**

1. Add import:

```typescript
import RollbackModal from '@shared/components/modals/RollbackModal';
```

2. Add state (alongside the existing `restartConfirm`, `deleteConfirm`, `scaleState`):

```typescript
    const [rollbackTarget, setRollbackTarget] = useState<WorkloadData | null>(null);
```

3. Add `onRollback` handler in the `getContextMenuItems` callback, alongside the existing `onRestart`:

```typescript
            onRollback: () => setRollbackTarget(row),
```

4. Add `rollback` to the permissions object in `getContextMenuItems`. Since rollback uses the same `patch` permission as restart, reuse `restartStatus`:

```typescript
          permissions: {
            restart: restartStatus,
            rollback: restartStatus,
            scale: scaleStatus,
            delete: deleteStatus,
            portForward: portForwardStatus,
          },
```

5. Render the `RollbackModal` alongside the other modals (after `PortForwardModal`):

```tsx
        <RollbackModal
          isOpen={rollbackTarget !== null}
          onClose={() => setRollbackTarget(null)}
          clusterId={rollbackTarget?.clusterId ?? ''}
          namespace={rollbackTarget?.namespace ?? ''}
          name={rollbackTarget?.name ?? ''}
          kind={rollbackTarget?.kind ?? ''}
        />
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx tsc --noEmit 2>&1 | head -20`
Expected: No errors.

- [ ] **Step 3: Run all frontend tests**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx vitest run --reporter=verbose 2>&1 | tail -20`
Expected: All tests PASS.

- [ ] **Step 4: Run all backend tests**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./backend/ -v 2>&1 | tail -20`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/namespace/components/NsViewWorkloads.tsx
git commit -m "feat: wire rollback action into NsViewWorkloads"
```

---

## Task 12: Final Verification

- [ ] **Step 1: Run full backend test suite**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./... 2>&1 | tail -20`
Expected: All tests PASS.

- [ ] **Step 2: Run full frontend test suite**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx vitest run --reporter=verbose 2>&1 | tail -30`
Expected: All tests PASS.

- [ ] **Step 3: Run TypeScript checks**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Run linter**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx eslint src/ --ext .ts,.tsx 2>&1 | tail -20`
Expected: No errors.
