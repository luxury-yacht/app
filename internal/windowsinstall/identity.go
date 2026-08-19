// Package windowsinstall owns the Windows installation identity shared by
// runtime reconciliation and release tooling.
package windowsinstall

import (
	"fmt"
	"strings"
)

const (
	CompanyName = "Luxury Yacht"
	ProductName = "Luxury Yacht"

	uninstallRegistryRoot = `Software\Microsoft\Windows\CurrentVersion\Uninstall`
	UninstallRegistryPath = uninstallRegistryRoot + `\` + CompanyName + ProductName
)

func RegistryPath(companyName, productName string) (string, error) {
	companyName = strings.TrimSpace(companyName)
	productName = strings.TrimSpace(productName)
	if companyName == "" {
		return "", fmt.Errorf("wails config has no info.companyName")
	}
	if productName == "" {
		return "", fmt.Errorf("wails config has no info.productName")
	}
	return uninstallRegistryRoot + `\` + companyName + productName, nil
}
