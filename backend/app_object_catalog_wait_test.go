package backend

import (
	"context"
	"testing"

	apiextensionsfake "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset/fake"
	apiextinformers "k8s.io/apiextensions-apiserver/pkg/client/informers/externalversions"
	"k8s.io/client-go/informers"
	kubefake "k8s.io/client-go/kubernetes/fake"
)

func TestWaitForFactorySyncHandlesNilFactory(t *testing.T) {
	if !waitForFactorySync(context.Background(), nil) {
		t.Fatal("nil factory should return true")
	}
	if !waitForAPIExtensionsFactorySync(context.Background(), nil) {
		t.Fatal("nil apiextensions factory should return true")
	}
}

func TestWaitForFactoriesRespectContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	factory := informers.NewSharedInformerFactory(kubefake.NewClientset(), 0)
	// ensure at least one informer is registered
	factory.Core().V1().Pods()

	if waitForFactorySync(ctx, factory) {
		t.Fatal("expected factory sync to stop when context is canceled")
	}

	apiExtFactory := apiextinformers.NewSharedInformerFactory(apiextensionsfake.NewClientset(), 0)
	apiExtFactory.Apiextensions().V1().CustomResourceDefinitions()

	if waitForAPIExtensionsFactorySync(ctx, apiExtFactory) {
		t.Fatal("expected apiextensions factory sync to stop when context is canceled")
	}
}
