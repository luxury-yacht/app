//go:build !darwin

package updateidentity

func platformVolumeReadOnly(string) (bool, error) {
	return false, nil
}
