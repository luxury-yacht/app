package main

import (
	"fmt"
	"io"
)

func WriteWindowsVersion(output io.Writer, version string) error {
	windowsVersion, err := windowsNumericVersion(version)
	if err != nil {
		return err
	}
	_, err = fmt.Fprintln(output, windowsVersion)
	return err
}
