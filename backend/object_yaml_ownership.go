/*
 * backend/object_yaml_ownership.go
 *
 * Advisory field-ownership check for YAML editor saves. Runs a server-side
 * apply dry run so the API server reports which edited fields are owned by
 * other field managers; the actual save remains a kubectl-edit-style patch.
 */

package backend

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
)

// ObjectYAMLOwnershipConflict describes one edited field whose current owner
// is another field manager.
type ObjectYAMLOwnershipConflict struct {
	Field   string `json:"field"`
	Manager string `json:"manager"`
	Message string `json:"message"`
}

// ObjectYAMLOwnershipCheckResponse lists the ownership conflicts a save would
// create. An empty list means the save takes no contested ownership.
type ObjectYAMLOwnershipCheckResponse struct {
	Conflicts []ObjectYAMLOwnershipConflict `json:"conflicts"`
}

// Upstream apiserver conflict causes carry the owning manager only inside the
// message text, e.g. `conflict with "flux" using apps/v1`.
var objectYAMLOwnershipManagerPattern = regexp.MustCompile(`conflict with "([^"]+)"`)

// CheckObjectYamlOwnership reports which fields the edited YAML would take
// ownership of from other field managers. It is advisory: the caller decides
// whether to proceed, and the save itself never goes through server-side
// apply (which would make this editor co-owner of the entire document).
func (a *App) CheckObjectYamlOwnership(
	clusterID string,
	req ObjectYAMLMutationRequest,
) (*ObjectYAMLOwnershipCheckResponse, error) {
	deps, selectionKey, err := a.resolveClusterDependencies(clusterID)
	if err != nil {
		return nil, err
	}

	ctx, cancel := a.mutationContext()
	defer cancel()

	mc, err := prepareMutationContextWithDependencies(ctx, deps, selectionKey, req)
	if err != nil {
		return nil, err
	}
	if err := a.requireResolvedResourcePermission(ctx, deps, mc.gvr, mc.isNamespaced, resourcePermissionCheck{
		Kind:      req.Kind,
		Namespace: req.Namespace,
		Name:      req.Name,
		Verb:      "patch",
	}); err != nil {
		return nil, err
	}

	noConflicts := &ObjectYAMLOwnershipCheckResponse{Conflicts: []ObjectYAMLOwnershipConflict{}}

	if isEmptyPatchDocument(mc.patch) {
		return noConflicts, nil
	}

	// sanitizeForMerge strips managedFields (which apply intents must not
	// carry), resourceVersion (so unrelated writes such as status updates can
	// never surface as conflicts), and status.
	intent, err := json.Marshal(sanitizeForMerge(mc.desired).Object)
	if err != nil {
		return nil, fmt.Errorf("failed to encode ownership check intent: %w", err)
	}

	force := false
	_, err = mc.resource.Patch(
		ctx,
		req.Name,
		types.ApplyPatchType,
		intent,
		metav1.PatchOptions{
			DryRun:       []string{metav1.DryRunAll},
			FieldManager: objectYAMLFieldManager,
			Force:        &force,
		},
	)
	if err == nil {
		return noConflicts, nil
	}

	conflicts, isOwnershipConflict := parseOwnershipConflicts(err)
	if !isOwnershipConflict {
		return nil, wrapKubernetesError(err, "ownership check failed")
	}
	return &ObjectYAMLOwnershipCheckResponse{Conflicts: conflicts}, nil
}

func parseOwnershipConflicts(err error) ([]ObjectYAMLOwnershipConflict, bool) {
	var statusErr *apierrors.StatusError
	if !errors.As(err, &statusErr) {
		return nil, false
	}
	if statusErr.ErrStatus.Reason != metav1.StatusReasonConflict ||
		!statusHasCauseType(statusErr.ErrStatus.Details, metav1.CauseTypeFieldManagerConflict) {
		return nil, false
	}

	conflicts := make([]ObjectYAMLOwnershipConflict, 0, len(statusErr.ErrStatus.Details.Causes))
	for _, cause := range statusErr.ErrStatus.Details.Causes {
		if cause.Type != metav1.CauseTypeFieldManagerConflict {
			continue
		}
		manager := ""
		if match := objectYAMLOwnershipManagerPattern.FindStringSubmatch(cause.Message); match != nil {
			manager = match[1]
		}
		if isBenignOwnershipManager(manager) {
			continue
		}
		conflicts = append(conflicts, ObjectYAMLOwnershipConflict{
			Field:   cause.Field,
			Manager: manager,
			Message: cause.Message,
		})
	}
	return conflicts, true
}

// isBenignOwnershipManager filters managers whose ownership is routine to
// take over: this editor's own previous edits and kubectl's field managers
// (kubectl, kubectl-client-side-apply, kubectl-edit, ...), which represent
// one-shot human edits just like ours. An unparseable manager is kept so the
// warning errs toward caution.
func isBenignOwnershipManager(manager string) bool {
	if manager == "" {
		return false
	}
	return manager == objectYAMLFieldManager || strings.HasPrefix(manager, "kubectl")
}

func isEmptyPatchDocument(patch []byte) bool {
	var doc map[string]interface{}
	if err := json.Unmarshal(patch, &doc); err != nil {
		return false
	}
	return len(doc) == 0
}
