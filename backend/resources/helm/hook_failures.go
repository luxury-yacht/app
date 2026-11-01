package helm

import (
	"errors"
	"io"
	"slices"
	"time"

	"helm.sh/helm/v3/pkg/action"
	"helm.sh/helm/v3/pkg/kube"
	"helm.sh/helm/v3/pkg/release"
	"helm.sh/helm/v3/pkg/storage/driver"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

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

// uninstallFailureRecorder passes an uninstall's kube and storage calls
// through and keeps their errors, typed, before Helm flattens them into text.
// In an uninstall only chart hooks create objects or wait for them, so those
// errors are hooks that failed in this run (a hook keeps the failed phase of
// an earlier run until it runs again); every other error is kept apart.
type uninstallFailureRecorder struct {
	uninstallKubeClient
	hookFailures  []error
	otherFailures []error
}

// recordUninstallFailures makes cfg's kube client and release storage record
// their failures. A kube client without the full uninstall interface is left
// as it is, and nothing is recorded.
func recordUninstallFailures(cfg *action.Configuration) *uninstallFailureRecorder {
	client, ok := cfg.KubeClient.(uninstallKubeClient)
	if !ok {
		return nil
	}
	recorder := &uninstallFailureRecorder{uninstallKubeClient: client}
	cfg.KubeClient = recorder
	if cfg.Releases != nil {
		releases := *cfg.Releases
		releases.Driver = recordingReleaseDriver{Driver: releases.Driver, recorder: recorder}
		cfg.Releases = &releases
	}
	return recorder
}

func (r *uninstallFailureRecorder) Create(resources kube.ResourceList) (*kube.Result, error) {
	result, err := r.uninstallKubeClient.Create(resources)
	r.hookFailures = appendFailure(r.hookFailures, err)
	return result, err
}

func (r *uninstallFailureRecorder) WatchUntilReady(resources kube.ResourceList, timeout time.Duration) error {
	err := r.uninstallKubeClient.WatchUntilReady(resources, timeout)
	r.hookFailures = appendFailure(r.hookFailures, err)
	return err
}

func (r *uninstallFailureRecorder) Build(reader io.Reader, validate bool) (kube.ResourceList, error) {
	resources, err := r.uninstallKubeClient.Build(reader, validate)
	r.otherFailures = appendFailure(r.otherFailures, err)
	return resources, err
}

func (r *uninstallFailureRecorder) Delete(resources kube.ResourceList) (*kube.Result, []error) {
	result, errs := r.uninstallKubeClient.Delete(resources)
	r.otherFailures = append(r.otherFailures, errs...)
	return result, errs
}

func (r *uninstallFailureRecorder) DeleteWithPropagationPolicy(
	resources kube.ResourceList, policy metav1.DeletionPropagation,
) (*kube.Result, []error) {
	result, errs := r.uninstallKubeClient.DeleteWithPropagationPolicy(resources, policy)
	r.otherFailures = append(r.otherFailures, errs...)
	return result, errs
}

func (r *uninstallFailureRecorder) WaitForDelete(resources kube.ResourceList, timeout time.Duration) error {
	err := r.uninstallKubeClient.WaitForDelete(resources, timeout)
	r.otherFailures = appendFailure(r.otherFailures, err)
	return err
}

// recordingReleaseDriver keeps the failures of deleting release records, as
// the purge after the post-delete hooks does.
type recordingReleaseDriver struct {
	driver.Driver
	recorder *uninstallFailureRecorder
}

func (d recordingReleaseDriver) Delete(key string) (*release.Release, error) {
	rel, err := d.Driver.Delete(key)
	d.recorder.otherFailures = appendFailure(d.recorder.otherFailures, err)
	return rel, err
}

func appendFailure(failures []error, err error) []error {
	if err == nil {
		return failures
	}
	return append(failures, err)
}

// chartHookOutcome classifies err, a failed uninstall, when one of its hooks
// failed in this run: the chart's outcome, unless another failure Helm
// reported with it is an application failure. It keeps the recorded failures
// typed in the chain under Helm's message, so a rejection of how the app built
// a request stays reportable.
func chartHookOutcome(err error, recorder *uninstallFailureRecorder) error {
	if recorder == nil || len(recorder.hookFailures) == 0 {
		return err
	}
	failures := append(append([]error{err}, recorder.hookFailures...), recorder.otherFailures...)
	joined := errorstatus.WithMessage(err.Error(), errors.Join(failures...))
	if slices.ContainsFunc(recorder.otherFailures, isApplicationFailure) {
		return errorstatus.ApplicationFailure(joined)
	}
	return errorstatus.ClusterOutcome(joined)
}

func isApplicationFailure(err error) bool {
	return !errorstatus.Classify(err).Expected
}
