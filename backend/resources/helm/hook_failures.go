package helm

import (
	"errors"
	"time"

	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/kube"

	"github.com/luxury-yacht/app/backend/internal/errorstatus"
)

// uninstallKubeClient is the kube client an uninstall uses, including the
// optional interfaces Helm finds by type assertion, so a wrapper keeps them.
type uninstallKubeClient interface {
	kube.Interface
	kube.InterfaceExt
	kube.InterfaceLogs
	kube.InterfaceDeletionPropagation
}

// hookFailureRecorder passes an uninstall's kube calls through and keeps the
// errors of creating objects and waiting for them. In an uninstall only chart
// hooks do either, so each error is a hook that failed in this run, with its
// typed status intact: Helm flattens post-delete failures into text, and a
// hook keeps the failed phase of an earlier run until it runs again.
type hookFailureRecorder struct {
	uninstallKubeClient
	failures []error
}

// recordHookFailures makes cfg's kube client record hook failures. A client
// without the full uninstall interface is left as it is, and records nothing.
func recordHookFailures(cfg *action.Configuration) *hookFailureRecorder {
	client, ok := cfg.KubeClient.(uninstallKubeClient)
	if !ok {
		return nil
	}
	recorder := &hookFailureRecorder{uninstallKubeClient: client}
	cfg.KubeClient = recorder
	return recorder
}

func (r *hookFailureRecorder) Create(resources kube.ResourceList) (*kube.Result, error) {
	result, err := r.uninstallKubeClient.Create(resources)
	r.record(err)
	return result, err
}

func (r *hookFailureRecorder) WatchUntilReady(resources kube.ResourceList, timeout time.Duration) error {
	err := r.uninstallKubeClient.WatchUntilReady(resources, timeout)
	r.record(err)
	return err
}

func (r *hookFailureRecorder) record(err error) {
	if err != nil {
		r.failures = append(r.failures, err)
	}
}

// chartHookOutcome marks err, a failed uninstall, as the chart's outcome when
// one of its hooks failed in this run, and keeps the hooks' typed failures in
// its chain under Helm's message, so a rejection of how the app built a
// request stays reportable.
func chartHookOutcome(err error, recorder *hookFailureRecorder) error {
	if recorder == nil || len(recorder.failures) == 0 {
		return err
	}
	failures := errors.Join(append([]error{err}, recorder.failures...)...)
	return errorstatus.ClusterOutcome(errorstatus.WithMessage(err.Error(), failures))
}
