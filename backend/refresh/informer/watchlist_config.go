package informer

import (
	"fmt"
	"sync"

	clientfeatures "k8s.io/client-go/features"
	"k8s.io/klog/v2"
)

type clientFeatureGateSetter interface {
	Set(clientfeatures.Feature, bool) error
}

var logWatchListDisabled sync.Once

// DisableWatchList restores the classic informer startup sequence: one complete
// LIST followed by the long-lived WATCH. It must run before reflectors are
// constructed. Set is used instead of the environment variable because
// client-go may cache all feature-gate environment values while constructing
// the Kubernetes client, before the refresh subsystem exists.
func DisableWatchList() error {
	return disableWatchList(clientfeatures.FeatureGates())
}

func disableWatchList(gates clientfeatures.Gates) error {
	setter, ok := gates.(clientFeatureGateSetter)
	if !ok {
		return fmt.Errorf("client-go feature gates %T cannot disable %s", gates, clientfeatures.WatchListClient)
	}
	if err := setter.Set(clientfeatures.WatchListClient, false); err != nil {
		return fmt.Errorf("disable client-go %s: %w", clientfeatures.WatchListClient, err)
	}
	if gates.Enabled(clientfeatures.WatchListClient) {
		return fmt.Errorf("client-go %s remained enabled after override", clientfeatures.WatchListClient)
	}
	logWatchListDisabled.Do(func() {
		klog.Infof("WatchListClient override applied: disabled — using LIST followed by WATCH for informer startup")
	})
	return nil
}
