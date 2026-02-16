# Ephemeral Debug Containers Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Status (as of February 16, 2026):**
- ✅ Task 1 complete
- ✅ Task 2 complete
- ✅ Task 3 complete
- ✅ Task 4 complete
- ✅ Task 5 complete
- ✅ Task 6 complete
- ✅ Task 7 complete
- ⬜ Task 8 pending manual smoke test in a live cluster
- ✅ Task 9 complete

**Goal:** Allow users to create ephemeral debug containers on running pods and shell into them, all from the existing Shell tab.

**Architecture:** Backend adds a `CreateDebugContainer` Go function that patches a pod's ephemeral containers subresource, polls until running, and returns the container name. Frontend extends the Shell tab with a Shell/Debug mode toggle; Debug mode shows an image dropdown (presets + custom), target container picker, and a Debug button that creates the container then auto-connects a shell.

**Tech Stack:** Go (client-go ephemeral containers API), React (existing Shell tab + SegmentedButton component), Vitest (frontend tests), testify + fake clientset (backend tests)

---

### Task 1: Backend — Add `DebugContainerRequest` type ✅

**Files:**
- Modify: `backend/resources/types/types.go` (after line 117, below `ShellSession`)
- Modify: `backend/types.go` (add type alias)

**Step 1: Add the request/response types to `backend/resources/types/types.go`**

Insert after the `ShellStatusEvent` block (~line 132):

```go
// DebugContainerRequest describes the parameters for creating an ephemeral debug container.
type DebugContainerRequest struct {
	Namespace       string `json:"namespace"`
	PodName         string `json:"podName"`
	Image           string `json:"image"`
	TargetContainer string `json:"targetContainer,omitempty"`
}

// DebugContainerResponse contains the result of creating an ephemeral debug container.
type DebugContainerResponse struct {
	ContainerName string `json:"containerName"`
	PodName       string `json:"podName"`
	Namespace     string `json:"namespace"`
}
```

**Step 2: Add type aliases in `backend/types.go`**

Add these lines to the type alias block:

```go
DebugContainerRequest  = types.DebugContainerRequest
DebugContainerResponse = types.DebugContainerResponse
```

**Step 3: Verify it compiles**

Run: `cd /Volumes/git/luxury-yacht/app && go build ./...`
Expected: Clean build, no errors.

**Step 4: Commit**

---

### Task 2: Backend — Implement `CreateDebugContainer` service method ✅

**Files:**
- Create: `backend/resources/pods/debug.go`
- Create: `backend/resources/pods/debug_test.go`

**Step 1: Write the failing test**

Create `backend/resources/pods/debug_test.go`:

```go
package pods

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	cgotesting "k8s.io/client-go/testing"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/testsupport"
)

// fakeEphemeralStatusReactor is a PrependReactor that populates
// EphemeralContainerStatuses with a Running state whenever
// UpdateEphemeralContainers is called. This simulates the kubelet
// starting the container so waitForEphemeralContainer can succeed.
func fakeEphemeralStatusReactor(client *fake.Clientset) {
	client.PrependReactor("update", "pods/ephemeralcontainers", func(action cgotesting.Action) (bool, runtime.Object, error) {
		updateAction := action.(cgotesting.UpdateAction)
		pod := updateAction.GetObject().(*corev1.Pod)

		// For each ephemeral container without a matching status, add a Running status.
		existing := make(map[string]bool)
		for _, cs := range pod.Status.EphemeralContainerStatuses {
			existing[cs.Name] = true
		}
		for _, ec := range pod.Spec.EphemeralContainers {
			if !existing[ec.Name] {
				pod.Status.EphemeralContainerStatuses = append(pod.Status.EphemeralContainerStatuses, corev1.ContainerStatus{
					Name: ec.Name,
					State: corev1.ContainerState{
						Running: &corev1.ContainerStateRunning{
							StartedAt: metav1.Now(),
						},
					},
				})
			}
		}

		// Persist the updated pod so subsequent Get calls return the status.
		ns := pod.Namespace
		name := pod.Name
		_, err := client.CoreV1().Pods(ns).UpdateStatus(context.Background(), pod, metav1.UpdateOptions{})
		if err != nil {
			return false, nil, err
		}

		// Return false so the default reactor also processes the update.
		return false, nil, nil
	})
}

func TestCreateDebugContainerSuccess(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "demo-pod",
			Namespace: "team-a",
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{
				{Name: "app", Image: "nginx:latest"},
			},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
		},
	}
	client := fake.NewClientset(pod)
	fakeEphemeralStatusReactor(client)

	deps := common.Dependencies{
		Context:          context.Background(),
		Logger:           testsupport.NewTestLogger(t),
		KubernetesClient: client,
	}
	svc := NewService(deps)

	resp, err := svc.CreateDebugContainer("team-a", "demo-pod", "busybox:latest", "app")
	require.NoError(t, err)
	require.NotEmpty(t, resp.ContainerName)
	require.Equal(t, "demo-pod", resp.PodName)
	require.Equal(t, "team-a", resp.Namespace)

	// Verify the ephemeral container was added to the pod.
	updated, err := client.CoreV1().Pods("team-a").Get(context.Background(), "demo-pod", metav1.GetOptions{})
	require.NoError(t, err)
	require.Len(t, updated.Spec.EphemeralContainers, 1)
	ec := updated.Spec.EphemeralContainers[0]
	require.Equal(t, "busybox:latest", ec.Image)
	require.Equal(t, "app", ec.TargetContainerName)
	require.True(t, ec.Stdin)
	require.True(t, ec.TTY)

	// Verify the status was populated (reactor did its job).
	require.Len(t, updated.Status.EphemeralContainerStatuses, 1)
	require.NotNil(t, updated.Status.EphemeralContainerStatuses[0].State.Running)
}

func TestCreateDebugContainerPollTimeout(t *testing.T) {
	// No reactor — status never becomes Running, so poll should time out.
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "demo-pod",
			Namespace: "team-a",
		},
		Spec: corev1.PodSpec{
			Containers: []corev1.Container{
				{Name: "app", Image: "nginx:latest"},
			},
		},
		Status: corev1.PodStatus{
			Phase: corev1.PodRunning,
		},
	}
	client := fake.NewClientset(pod)
	deps := common.Dependencies{
		Context:          context.Background(),
		Logger:           testsupport.NewTestLogger(t),
		KubernetesClient: client,
	}
	svc := NewService(deps)

	_, err := svc.CreateDebugContainer("team-a", "demo-pod", "busybox:latest", "app")
	require.Error(t, err)
	require.Contains(t, err.Error(), "timed out waiting for debug container")
}

func TestCreateDebugContainerMissingImage(t *testing.T) {
	client := fake.NewClientset()
	deps := common.Dependencies{
		Context:          context.Background(),
		Logger:           testsupport.NewTestLogger(t),
		KubernetesClient: client,
	}
	svc := NewService(deps)

	_, err := svc.CreateDebugContainer("team-a", "demo-pod", "", "app")
	require.Error(t, err)
	require.Contains(t, err.Error(), "image is required")
}

func TestCreateDebugContainerNilClient(t *testing.T) {
	deps := common.Dependencies{
		Context: context.Background(),
		Logger:  testsupport.NewTestLogger(t),
	}
	svc := NewService(deps)

	_, err := svc.CreateDebugContainer("team-a", "demo-pod", "busybox", "app")
	require.Error(t, err)
	require.Contains(t, err.Error(), "kubernetes client not initialized")
}
```

**Step 2: Run test to verify it fails**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./backend/resources/pods/ -run TestCreateDebugContainer -v`
Expected: FAIL — `svc.CreateDebugContainer` undefined.

**Step 3: Write the implementation**

Create `backend/resources/pods/debug.go`:

```go
/*
 * backend/resources/pods/debug.go
 *
 * Ephemeral debug container creation.
 * - Creates an ephemeral container on a running pod.
 * - Polls until the container reaches Running state.
 */

package pods

import (
	"context"
	"fmt"
	"time"

	"github.com/google/uuid"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/resources/types"
)

const (
	// debugContainerPollInterval is how often we check if the ephemeral container is running.
	debugContainerPollInterval = 500 * time.Millisecond

	// debugContainerPollTimeout is the maximum time to wait for the container to start.
	debugContainerPollTimeout = 30 * time.Second
)

// CreateDebugContainer adds an ephemeral debug container to the specified pod
// and waits for it to reach Running state. Returns an error if the container
// does not reach Running state within the poll timeout.
func (s *Service) CreateDebugContainer(namespace, podName, image, targetContainer string) (*types.DebugContainerResponse, error) {
	if s.deps.KubernetesClient == nil {
		return nil, fmt.Errorf("kubernetes client not initialized")
	}
	if image == "" {
		return nil, fmt.Errorf("image is required")
	}

	ctx, cancel := context.WithTimeout(s.ctx(), debugContainerPollTimeout)
	defer cancel()

	// Fetch the current pod to append an ephemeral container.
	pod, err := s.deps.KubernetesClient.CoreV1().Pods(namespace).Get(ctx, podName, metav1.GetOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to get pod: %w", err)
	}

	// Generate a unique name for the debug container.
	shortID := uuid.NewString()[:8]
	containerName := fmt.Sprintf("debug-%s", shortID)

	ec := corev1.EphemeralContainer{
		EphemeralContainerCommon: corev1.EphemeralContainerCommon{
			Name:  containerName,
			Image: image,
			Stdin: true,
			TTY:   true,
		},
	}
	if targetContainer != "" {
		ec.TargetContainerName = targetContainer
	}

	pod.Spec.EphemeralContainers = append(pod.Spec.EphemeralContainers, ec)

	// Update the pod's ephemeral containers subresource.
	_, err = s.deps.KubernetesClient.CoreV1().Pods(namespace).UpdateEphemeralContainers(ctx, podName, pod, metav1.UpdateOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to create debug container: %w", err)
	}

	// Poll until the ephemeral container is running. If this fails, return the
	// error so the frontend knows the container isn't ready for exec yet.
	if err := s.waitForEphemeralContainer(ctx, namespace, podName, containerName); err != nil {
		return nil, fmt.Errorf("debug container %s created but failed to start: %w", containerName, err)
	}

	return &types.DebugContainerResponse{
		ContainerName: containerName,
		PodName:       podName,
		Namespace:     namespace,
	}, nil
}

// waitForEphemeralContainer polls the pod status until the named ephemeral container is running.
func (s *Service) waitForEphemeralContainer(ctx context.Context, namespace, podName, containerName string) error {
	ticker := time.NewTicker(debugContainerPollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return fmt.Errorf("timed out waiting for debug container %q to start", containerName)
		case <-ticker.C:
			pod, err := s.deps.KubernetesClient.CoreV1().Pods(namespace).Get(ctx, podName, metav1.GetOptions{})
			if err != nil {
				return fmt.Errorf("failed to poll pod status: %w", err)
			}
			for _, cs := range pod.Status.EphemeralContainerStatuses {
				if cs.Name == containerName && cs.State.Running != nil {
					return nil
				}
			}
		}
	}
}
```

**Step 4: Run tests to verify they pass**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./backend/resources/pods/ -run TestCreateDebugContainer -v -timeout 60s`
Expected: All four tests PASS. `TestCreateDebugContainerPollTimeout` will take up to 30s (the poll timeout). Consider reducing `debugContainerPollTimeout` in the test via a helper or using a short context deadline.

**Step 5: Commit**

---

### Task 3: Backend — Add app-level wrapper and update container validation ✅

**Files:**
- Modify: `backend/resources_pods.go` (add `CreateDebugContainer` wrapper)
- Modify: `backend/shell_sessions.go:179-181` (update `hasContainer` to accept ephemeral containers)
- Modify: `backend/resources/pods/logs.go:87-94` (add ephemeral containers to `PodContainers`)

**Step 1: Add the app wrapper to `backend/resources_pods.go`**

Add after the `GetPodContainers` function:

```go
// CreateDebugContainer adds an ephemeral debug container to a running pod.
func (a *App) CreateDebugContainer(clusterID string, req DebugContainerRequest) (*DebugContainerResponse, error) {
	deps, _, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}
	service := pods.NewService(deps)
	return service.CreateDebugContainer(req.Namespace, req.PodName, req.Image, req.TargetContainer)
}
```

**Step 2: Update `hasContainer` in `backend/shell_sessions.go`**

The current validation at line 179 only checks `pod.Spec.Containers`. Ephemeral containers won't be found there. Update lines 179-181:

```go
if !hasContainer(pod.Spec.Containers, container) && !hasEphemeralContainer(pod.Spec.EphemeralContainers, container) {
	return nil, fmt.Errorf("container %q not found in pod %s", container, req.PodName)
}
```

Add a new helper after `hasContainer` (line 374):

```go
func hasEphemeralContainer(containers []corev1.EphemeralContainer, name string) bool {
	for _, c := range containers {
		if c.Name == name {
			return true
		}
	}
	return false
}
```

**Step 3: Update shell session container inventory in `backend/shell_sessions.go`**

The `Containers` field in the `ShellSession` response (line 272-275) only lists `pod.Spec.Containers`. This is what populates the Shell tab's container dropdown for reconnects. Add ephemeral containers so they appear in the dropdown after creation.

Replace lines 272-275:

```go
containers := make([]string, 0, len(pod.Spec.Containers)+len(pod.Spec.EphemeralContainers))
for _, c := range pod.Spec.Containers {
	containers = append(containers, c.Name)
}
for _, c := range pod.Spec.EphemeralContainers {
	containers = append(containers, c.Name)
}
```

**Step 4: Update `PodContainers` in `backend/resources/pods/logs.go`**

Add ephemeral containers after the regular containers loop (after line 93, before the return):

```go
for _, c := range pod.Spec.EphemeralContainers {
	containers = append(containers, c.Name+" (debug)")
}
```

**Step 5: Update `getActualContainerName` in `frontend/src/modules/object-panel/components/ObjectPanel/Logs/LogViewer.tsx`**

The current helper at line 738-740 only strips `" (init)"` but not `" (debug)"`. When a user selects a debug container from the log filter, the backend would receive an invalid container name like `debug-abc (debug)`.

Update line 739:

```typescript
const getActualContainerName = (displayName: string) => {
  return displayName.replace(' (init)', '').replace(' (debug)', '');
};
```

**Step 6: Add a test for ephemeral containers in `PodContainers`**

Add to `backend/resources/pods/logs_test.go` (in the existing test file, find the `TestPodContainersSuccess` area):

```go
func TestPodContainersIncludesEphemeral(t *testing.T) {
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: "demo-pod", Namespace: "team-a"},
		Spec: corev1.PodSpec{
			Containers:          []corev1.Container{{Name: "app"}},
			EphemeralContainers: []corev1.EphemeralContainer{{EphemeralContainerCommon: corev1.EphemeralContainerCommon{Name: "debug-abc"}}},
		},
	}
	client := fake.NewClientset(pod)
	deps := common.Dependencies{
		Context:          context.Background(),
		Logger:           testsupport.NewTestLogger(t),
		KubernetesClient: client,
	}
	svc := NewService(deps)
	containers, err := svc.PodContainers("team-a", "demo-pod")
	require.NoError(t, err)
	require.Contains(t, containers, "app")
	require.Contains(t, containers, "debug-abc (debug)")
}
```

**Step 7: Run all pod tests**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./backend/resources/pods/ -v`
Expected: All tests PASS.

**Step 8: Verify full build**

Run: `cd /Volumes/git/luxury-yacht/app && go build ./...`
Expected: Clean build.

**Step 9: Commit**

---

### Task 4: Frontend — Add capability check for debug containers ✅

**Files:**
- Modify: `frontend/src/modules/object-panel/components/ObjectPanel/constants.ts` (add `debug: true` to pod capability map at line 24)
- Modify: `frontend/src/modules/object-panel/components/ObjectPanel/types.ts` (add `debug` to `ResourceCapability`, `FeatureSupport`, `CapabilityIdMap`, `CapabilityStates`, `CapabilityReasons`, and `createEmptyCapabilityIdMap`)
- Modify: `frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelFeatureSupport.ts` (add `debug: false` to defaults, add `debug: Boolean(definition.debug)` to mapping)
- Modify: `frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelCapabilities.ts` (add capability descriptor)
- Modify: `frontend/src/modules/object-panel/components/ObjectPanel/Shell/ShellTab.tsx` (add `debugDisabledReason?: string` prop to `ShellTabProps`; no behavior change yet)
- Modify: `frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanelContent.tsx` (pass `debugDisabledReason` prop to ShellTab)

**Step 1: Add `debug: true` to the pod resource capability in `constants.ts`**

Update line 24:

```typescript
pod: { logs: true, delete: true, shell: true, debug: true },
```

**Step 2: Add `debug` to all relevant types in `types.ts`**

Six additions, all mirroring how `shell` is declared:

```typescript
// ResourceCapability (line 17-26): add alongside shell
debug?: boolean;

// FeatureSupport (line 28-39): add alongside shell
debug: boolean;

// CapabilityIdMap (line 54-64): add alongside shell
debug?: string;

// CapabilityStates (line 72-81): add alongside shell
debug: CapabilityState;

// CapabilityReasons (line 83-89): add alongside shell
debug?: string;

// createEmptyCapabilityIdMap (line 91-101): add alongside shell
debug: undefined,
```

**Step 3: Wire `debug` in `useObjectPanelFeatureSupport.ts`**

Add `debug: false` to both default objects (alongside existing `shell: false`), and add `debug: Boolean(definition.debug)` to the mapping (alongside `shell: Boolean(definition.shell)`).

**Step 4: Add capability descriptor and plumbing in `useObjectPanelCapabilities.ts`**

Four changes in this file:

**4a.** Add the descriptor (after the shell-exec check, ~line 197):

```typescript
if (featureSupport.debug) {
  add(
    {
      id: 'debug-ephemeral',
      verb: 'update',
      resourceKind: 'Pod',
      namespace,
      name: resourceName,
      subresource: 'ephemeralcontainers',
    },
    'debug'
  );
}
```

**4b.** Add `debug` to `createDefaultCapabilityStates` (~line 45-54, alongside `shell`):

```typescript
debug: createCapabilityState(),
```

**4c.** Add `debug` to the `capabilityStates` useMemo return object (~line 280-289, alongside `shell`):

```typescript
debug: getCapabilityState(capabilityDescriptorInfo.idMap.debug),
```

**4d.** Add `debug` to the `capabilityReasons` useMemo (~line 319-334, alongside `shell`):

In the return object:
```typescript
debug: capabilityStates.debug.reason,
```

In the dependency array:
```typescript
capabilityStates.debug.reason,
```

**Step 5: Add `debugDisabledReason` prop to `ShellTabProps`**

In `ShellTab.tsx`, update `ShellTabProps`:

```typescript
debugDisabledReason?: string;
```

This is a type-plumbing change only in Task 4 so `ObjectPanelContent` can pass the prop without breaking TypeScript builds. Debug-mode behavior still lands in Task 5.

**Step 6: Pass the capability state to ShellTab**

The ShellTab needs to know whether debug is allowed. Add a `debugDisabledReason` prop (same pattern as the existing `disabledReason` prop for shell). When the `debug` capability is denied, pass the reason string; when allowed, pass `undefined`.

In `ObjectPanelContent.tsx` where ShellTab is rendered (~line 246-260), add:

```typescript
debugDisabledReason={capabilityReasons.debug}
```

**Step 7: Run frontend tests**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npm test -- --run --reporter verbose`
Expected: All tests PASS.

**Step 8: Commit**

---

### Task 5: Frontend — Add Debug mode toggle to Shell tab ✅

**Files:**
- Modify: `frontend/src/modules/object-panel/components/ObjectPanel/Shell/ShellTab.tsx`
- Modify: `frontend/src/modules/object-panel/components/ObjectPanel/Shell/ShellTab.css`

`ShellTabProps` already includes `debugDisabledReason?: string` from Task 4. In this task, wire behavior: when set, the Debug button is disabled and the warning text shows the permission reason instead of the persistence note.

**Step 1: Write the failing test**

Add to `frontend/src/modules/object-panel/components/ObjectPanel/Shell/ShellTab.test.tsx`:

```typescript
it('renders mode toggle with Shell and Debug options', async () => {
  await renderShellTab();
  const toggle = container.querySelector('.segmented-button');
  expect(toggle).not.toBeNull();
  const options = container.querySelectorAll('.segmented-button__option');
  expect(options).toHaveLength(2);
  expect(options[0].textContent).toBe('Shell');
  expect(options[1].textContent).toBe('Debug');
});

it('shows debug controls when Debug mode is selected', async () => {
  await renderShellTab();
  // Click Debug mode
  const options = container.querySelectorAll('.segmented-button__option');
  act(() => {
    (options[1] as HTMLButtonElement).click();
  });
  await flushAsync();
  // Should show debug button instead of connect button
  const debugButton = container.querySelector('.shell-tab__debug-button');
  expect(debugButton).not.toBeNull();
  expect(debugButton?.textContent).toBe('Debug');
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npm test -- --run --reporter verbose 2>&1 | grep -A 5 "mode toggle"`
Expected: FAIL — no `.segmented-button` element found.

**Step 3: Implement the mode toggle**

In `ShellTab.tsx`, add the import for SegmentedButton:

```typescript
import SegmentedButton from '@shared/components/SegmentedButton';
```

Add state for the mode (near existing state declarations around line 60):

```typescript
const [mode, setMode] = useState<'shell' | 'debug'>('shell');
```

Replace the toolbar JSX (lines 491-519) to include the mode toggle and conditionally render controls:

```tsx
<div className="shell-tab__toolbar">
  <div className="shell-tab__controls">
    <SegmentedButton
      options={[
        { value: 'shell' as const, label: 'Shell' },
        { value: 'debug' as const, label: 'Debug' },
      ]}
      value={mode}
      onChange={setMode}
      size="small"
    />
    {mode === 'shell' ? (
      <>
        <Dropdown
          options={containerOptions}
          value={activeContainer || containerOptions[0]?.value || ''}
          onChange={handleContainerChange}
          disabled={overridesDisabled}
          size="compact"
          placeholder="Containers unavailable"
          ariaLabel="Shell container selector"
        />
        <Dropdown
          options={shellOptions}
          value={commandOverride}
          onChange={handleShellChange}
          disabled={overridesDisabled}
          size="compact"
          placeholder="Select shell"
          ariaLabel="Shell command selector"
        />
        <button
          type="button"
          className="button generic shell-tab__button"
          onClick={status === 'open' ? handleDisconnect : handleReconnect}
        >
          {status === 'open' ? 'Disconnect' : 'Connect'}
        </button>
      </>
    ) : (
      <>
        <Dropdown
          options={debugImageOptions}
          value={debugImage}
          onChange={handleDebugImageChange}
          size="compact"
          placeholder="Select image"
          ariaLabel="Debug container image"
        />
        {debugImage === '__custom__' && (
          <input
            className="shell-tab__custom-image-input"
            type="text"
            value={customImage}
            onChange={(e) => setCustomImage(e.target.value)}
            placeholder="image:tag"
            aria-label="Custom debug image"
          />
        )}
        <Dropdown
          options={containerOptions}
          value={debugTarget || containerOptions[0]?.value || ''}
          onChange={handleDebugTargetChange}
          size="compact"
          placeholder="Target container"
          ariaLabel="Target container for process sharing"
        />
        <Dropdown
          options={shellOptions}
          value={commandOverride}
          onChange={handleShellChange}
          size="compact"
          placeholder="Select shell"
          ariaLabel="Shell command selector"
        />
        <button
          type="button"
          className="button generic shell-tab__debug-button"
          onClick={handleDebug}
          disabled={debugCreating || !resolvedDebugImage || !!debugDisabledReason}
        >
          {debugCreating ? 'Creating...' : 'Debug'}
        </button>
      </>
    )}
  </div>
</div>
```

Add the supporting state and handlers (before the return statement):

```typescript
// Debug mode state
const [debugImage, setDebugImage] = useState('busybox:latest');
const [customImage, setCustomImage] = useState('');
const [debugTarget, setDebugTarget] = useState<string | null>(null);
const [debugCreating, setDebugCreating] = useState(false);

const debugImageOptions = useMemo<DropdownOption[]>(
  () => [
    { value: 'busybox:latest', label: 'busybox:latest' },
    { value: 'alpine:latest', label: 'alpine:latest' },
    { value: 'nicolaka/netshoot:latest', label: 'netshoot:latest' },
    { value: '__custom__', label: 'Custom...' },
  ],
  []
);

const resolvedDebugImage = debugImage === '__custom__' ? customImage.trim() : debugImage;

const handleDebugImageChange = useCallback((value: string | string[]) => {
  const next = Array.isArray(value) ? value[0] : value;
  setDebugImage(next || 'busybox:latest');
}, []);

const handleDebugTargetChange = useCallback((value: string | string[]) => {
  const next = Array.isArray(value) ? value[0] : value;
  setDebugTarget(next || null);
}, []);
```

Add the import for `CreateDebugContainer` at the top of the file (with the other Wails imports):

```typescript
import {
  CloseShellSession,
  CreateDebugContainer,
  ResizeShellSession,
  SendShellInput,
  StartShellSession,
} from '@wailsjs/go/backend/App';
```

Add the debug handler:

```typescript
const handleDebug = useCallback(async () => {
  if (!resolvedDebugImage || !namespace || !resourceName || !resolvedClusterId) return;
  setDebugCreating(true);
  try {
    const resp = await CreateDebugContainer(resolvedClusterId, {
      namespace,
      podName: resourceName,
      image: resolvedDebugImage,
      targetContainer: debugTarget || containerOptions[0]?.value || '',
    });
    // Switch to shell mode, target the new debug container, and auto-connect.
    setMode('shell');
    setContainerOverride(resp.containerName);
    // Small delay to let state settle, then connect.
    setTimeout(() => {
      initiateConnection();
    }, 100);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    ensureTerminal();
    terminalRef.current?.reset();
    writeLine(`\r\n\x1b[31mFailed to create debug container: ${reason}\x1b[0m`);
    setStatus('error');
    setStatusReason(reason);
  } finally {
    setDebugCreating(false);
  }
}, [
  resolvedDebugImage,
  namespace,
  resourceName,
  resolvedClusterId,
  debugTarget,
  containerOptions,
  setMode,
  setContainerOverride,
  initiateConnection,
  ensureTerminal,
  writeLine,
]);
```

**Step 4: Add CSS for debug mode elements**

Add to `ShellTab.css`:

```css
.shell-tab__debug-button {
  /* Inherits from .shell-tab__button via .button.generic */
}

.shell-tab__custom-image-input {
  height: 26px;
  padding: 0 8px;
  font-size: 12px;
  border: 1px solid var(--border-primary);
  border-radius: 4px;
  background: var(--bg-secondary);
  color: var(--text-primary);
  min-width: 140px;
}

.shell-tab__debug-warning {
  font-size: 11px;
  color: var(--text-muted);
  padding: 4px 12px;
}
```

**Step 5: Add a warning note below the toolbar when in debug mode**

After the toolbar div and before the `disabledReason` notice, add:

```tsx
{mode === 'debug' && (
  <div className="shell-tab__debug-warning">
    {debugDisabledReason
      ? <>Debug unavailable: <span>{debugDisabledReason}</span></>
      : 'Debug containers persist until the pod is deleted.'}
  </div>
)}
```

**Step 6: Run tests**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npm test -- --run --reporter verbose`
Expected: All tests PASS (including the two new ones).

**Step 7: Commit**

---

### Task 6: Frontend — Generate Wails bindings ✅

After adding the Go `CreateDebugContainer` method, the frontend TypeScript bindings need regeneration.

**Step 1: Regenerate Wails bindings**

Run: `cd /Volumes/git/luxury-yacht/app && wails generate module`

This updates:
- `frontend/wailsjs/go/backend/App.js` — adds `CreateDebugContainer` function
- `frontend/wailsjs/go/backend/App.d.ts` — adds TypeScript declaration
- `frontend/wailsjs/go/models.ts` — adds `DebugContainerRequest` and `DebugContainerResponse` types

**Step 2: Verify the binding exists**

Check that `frontend/wailsjs/go/backend/App.d.ts` contains:
```typescript
export function CreateDebugContainer(arg1:string,arg2:types.DebugContainerRequest):Promise<types.DebugContainerResponse>;
```

**Step 3: Verify frontend builds**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npm run build`
Expected: Clean build.

**Step 4: Commit**

---

### Task 7: Frontend — Add debug mode tests ✅

**Files:**
- Modify: `frontend/src/modules/object-panel/components/ObjectPanel/Shell/ShellTab.test.tsx`
- Modify: `frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelCapabilities.test.tsx`

**Step 1: Add mock for CreateDebugContainer**

In the existing mock setup area (where `StartShellSession`, `CloseShellSession`, etc. are mocked), add:

```typescript
CreateDebugContainer: vi.fn(),
```

**Step 2: Write the tests**

Add these test cases to the existing `describe` block:

```typescript
it('calls CreateDebugContainer and auto-connects on success', async () => {
  wailsMocks.CreateDebugContainer.mockResolvedValue({
    containerName: 'debug-abc12345',
    podName: 'pod-1',
    namespace: 'team-a',
  });
  await renderShellTab({ availableContainers: ['app'] });

  // Switch to debug mode
  const modeOptions = container.querySelectorAll('.segmented-button__option');
  act(() => {
    (modeOptions[1] as HTMLButtonElement).click();
  });
  await flushAsync();

  // Click Debug button
  const debugBtn = container.querySelector('.shell-tab__debug-button') as HTMLButtonElement;
  expect(debugBtn).not.toBeNull();
  await act(async () => {
    debugBtn.click();
    await flushAsync();
  });

  expect(wailsMocks.CreateDebugContainer).toHaveBeenCalledWith('alpha:ctx', {
    namespace: 'team-a',
    podName: 'pod-1',
    image: 'busybox:latest',
    targetContainer: 'app',
  });
});

it('shows error when CreateDebugContainer fails', async () => {
  wailsMocks.CreateDebugContainer.mockRejectedValue(new Error('ephemeral containers not supported'));
  await renderShellTab({ availableContainers: ['app'] });

  // Switch to debug mode
  const modeOptions = container.querySelectorAll('.segmented-button__option');
  act(() => {
    (modeOptions[1] as HTMLButtonElement).click();
  });
  await flushAsync();

  // Click Debug button
  const debugBtn = container.querySelector('.shell-tab__debug-button') as HTMLButtonElement;
  await act(async () => {
    debugBtn.click();
    await flushAsync();
  });

  // Terminal should have been created to show the error
  expect(wailsMocks.CreateDebugContainer).toHaveBeenCalled();
});

it('shows custom image input when Custom... is selected', async () => {
  await renderShellTab({ availableContainers: ['app'] });

  // Switch to debug mode
  const modeOptions = container.querySelectorAll('.segmented-button__option');
  act(() => {
    (modeOptions[1] as HTMLButtonElement).click();
  });
  await flushAsync();

  // The custom image input should not be visible by default
  let customInput = container.querySelector('.shell-tab__custom-image-input');
  expect(customInput).toBeNull();
});

it('disables Debug button and shows reason when debug capability is denied', async () => {
  await renderShellTab({
    availableContainers: ['app'],
    debugDisabledReason: 'Missing permission: update pods/ephemeralcontainers',
  });

  // Switch to debug mode
  const modeOptions = container.querySelectorAll('.segmented-button__option');
  act(() => {
    (modeOptions[1] as HTMLButtonElement).click();
  });
  await flushAsync();

  // Debug button should be disabled
  const debugBtn = container.querySelector('.shell-tab__debug-button') as HTMLButtonElement;
  expect(debugBtn).not.toBeNull();
  expect(debugBtn.disabled).toBe(true);

  // Warning should show the permission reason
  const warning = container.querySelector('.shell-tab__debug-warning');
  expect(warning).not.toBeNull();
  expect(warning?.textContent).toContain('Missing permission');
});
```

**Step 3: Add integration test in `useObjectPanelCapabilities.test.tsx`**

This verifies the full pipeline: denied RBAC → `capabilityStates.debug` → `capabilityReasons.debug`. Add alongside the existing `'enables shell capability when descriptors allow access'` test:

```typescript
it('surfaces debug-denied reason when ephemeralcontainers permission is denied', async () => {
  const capabilityStateMap: Record<string, { allowed: boolean; pending: boolean; reason?: string }> = {
    'debug-ephemeral': { allowed: false, pending: false, reason: 'Forbidden: pods/ephemeralcontainers' },
  };

  mockUseCapabilities.mockImplementation(() => ({
    getState: (id: string) => capabilityStateMap[id] ?? { allowed: false, pending: false },
  }));
  mockUseUserPermission.mockReturnValue(null);

  const result = await renderHook({
    objectData: { kind: 'Pod', name: 'demo', namespace: 'team-a', clusterId: 'c1' },
    objectKind: 'pod',
    detailScope: 'pod:demo',
    featureSupport: { ...baseFeatureSupport, shell: true, debug: true },
    workloadKindApiNames,
  });

  expect(result.capabilityStates.debug.allowed).toBe(false);
  expect(result.capabilityReasons.debug).toBe('Forbidden: pods/ephemeralcontainers');
});

it('allows debug when ephemeralcontainers permission is granted', async () => {
  const capabilityStateMap: Record<string, { allowed: boolean; pending: boolean }> = {
    'debug-ephemeral': { allowed: true, pending: false },
  };

  mockUseCapabilities.mockImplementation(() => ({
    getState: (id: string) => capabilityStateMap[id] ?? { allowed: false, pending: false },
  }));
  mockUseUserPermission.mockReturnValue(null);

  const result = await renderHook({
    objectData: { kind: 'Pod', name: 'demo', namespace: 'team-a', clusterId: 'c1' },
    objectKind: 'pod',
    detailScope: 'pod:demo',
    featureSupport: { ...baseFeatureSupport, shell: true, debug: true },
    workloadKindApiNames,
  });

  expect(result.capabilityStates.debug.allowed).toBe(true);
  expect(result.capabilityReasons.debug).toBeUndefined();
});
```

Note: `baseFeatureSupport` in the existing test file doesn't have `debug` yet. Add `debug: false` to it as part of this step (alongside existing `shell: false`).

**Step 4: Run tests**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npm test -- --run --reporter verbose`
Expected: All tests PASS.

**Step 5: Commit**

---

### Task 8: Manual smoke test ⬜

**Step 1: Build and run the app**

Run: `cd /Volumes/git/luxury-yacht/app && wails dev`

**Step 2: Test the happy path**

1. Connect to a cluster with a running pod.
2. Select a pod to open the object panel.
3. Go to the Shell tab.
4. Verify the Shell/Debug toggle is visible.
5. Click "Debug" to switch modes.
6. Verify the image dropdown shows presets (busybox, alpine, netshoot, Custom...).
7. Verify the target container dropdown shows the pod's containers.
8. Select an image and target container.
9. Click "Debug".
10. Verify the ephemeral container is created and a shell session auto-connects.

**Step 3: Test error handling**

1. Try creating a debug container on a cluster running Kubernetes < 1.25 (if available) — should show error message.
2. Try with a non-existent image — should show an error in the terminal area after the poll timeout (backend returns error, no auto-connect attempt).

**Step 4: Verify container listing**

1. After creating a debug container, check the container dropdown in Shell mode — should show the debug container.
2. Switch to the Logs tab — should list the debug container with "(debug)" suffix.

**Step 5: Commit final state**

---

### Task 9: Update plan documentation ✅

**Files:**
- Modify: `docs/plans/todos.md` — mark "Ephemeral debug containers" as ✅
- Modify: `docs/plans/2026-02-15-debug-containers-design.md` — note completion at top
