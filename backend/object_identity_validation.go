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
