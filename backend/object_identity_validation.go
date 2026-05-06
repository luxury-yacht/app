package backend

import (
	"fmt"
	"strings"
)

func requireObjectName(name string) error {
	if strings.TrimSpace(name) == "" {
		return fmt.Errorf("name is required")
	}
	return nil
}

func requireNamespacedObject(namespace, name string) error {
	if strings.TrimSpace(namespace) == "" {
		return fmt.Errorf("namespace is required")
	}
	return requireObjectName(name)
}

func requirePodObject(namespace, podName string) error {
	if strings.TrimSpace(namespace) == "" {
		return fmt.Errorf("namespace is required")
	}
	if strings.TrimSpace(podName) == "" {
		return fmt.Errorf("pod name is required")
	}
	return nil
}
