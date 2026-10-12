package backend

import (
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/backend/internal/errorstatus"
)

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
