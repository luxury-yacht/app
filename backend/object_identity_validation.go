package backend

import (
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/backend/internal/errorstatus"
	"github.com/luxury-yacht/app/backend/resourcekind"
	"github.com/luxury-yacht/app/backend/resourcemodel"
)

// requireTargetIdentity rejects a reference that is not the given built-in kind,
// so a kind-specific read never acts on a same-named object of another kind.
func requireTargetIdentity(target resourcemodel.ResourceRef, identity resourcekind.Identity) error {
	got, want := objectActionTargetGVK(target), identity.GVK()
	if got != want {
		return errorstatus.BadRequest(fmt.Errorf("%s %s target required, got %s %s", want.GroupVersion(), want.Kind, got.GroupVersion(), got.Kind))
	}
	return nil
}

func requireObjectName(name string) error {
	if strings.TrimSpace(name) == "" {
		return errorstatus.BadRequest(fmt.Errorf("name is required"))
	}
	return nil
}

func requireNamespacedObject(namespace, name string) error {
	if strings.TrimSpace(namespace) == "" {
		return errorstatus.BadRequest(fmt.Errorf("namespace is required"))
	}
	return requireObjectName(name)
}

func requirePodObject(namespace, podName string) error {
	if strings.TrimSpace(namespace) == "" {
		return errorstatus.BadRequest(fmt.Errorf("namespace is required"))
	}
	if strings.TrimSpace(podName) == "" {
		return errorstatus.BadRequest(fmt.Errorf("pod name is required"))
	}
	return nil
}
