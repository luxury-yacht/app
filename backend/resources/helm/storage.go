package helm

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"encoding/gob"
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"strings"

	"helm.sh/helm/v3/pkg/chart"
	"helm.sh/helm/v3/pkg/release"
	corev1 "k8s.io/api/core/v1"

	"github.com/luxury-yacht/app/backend/resourcemodel"
)

// releaseSecretType marks the Secrets Helm's storage driver writes, one per
// release revision.
const releaseSecretType corev1.SecretType = "helm.sh/release.v1"

// StorageRecord marks a Secret or ConfigMap that Helm's storage driver wrote
// for a release revision. It is the Aggregate half of that object's ingest
// bundle. The response cache evicts Release's cached details when the record
// changes. Revision is set only for a release Secret, the storage the release
// table reads.
type StorageRecord struct {
	Namespace string
	Release   string
	Revision  *Revision
}

// Revision is one release revision as the release table reads it.
type Revision struct {
	// Name is the release the revision belongs to: the "name" label.
	Name string
	// Version is the "version" label, or -1 when it is missing or malformed.
	Version int
	// Status is the "status" label.
	Status string
	// Release holds only the decoded fields the release table reads. It is nil
	// for a superseded or uninstalled revision, which the table never shows,
	// and for a payload that does not decode.
	Release *release.Release
}

// Ingest spill encodes each Bundle half through an interface, so its concrete
// type must be registered with gob. The spill discovers types by projecting an
// empty object, and an empty Secret or ConfigMap carries no record, so the
// record registers itself.
func init() {
	gob.Register(StorageRecord{})
}

// SecretStorageRecord returns the record for a Secret Helm's storage driver
// wrote, decoding the revision's payload only when the release table can show
// it.
func SecretStorageRecord(secret *corev1.Secret) (StorageRecord, bool) {
	if secret == nil || !isStorageObject(secret.Name, secret.Labels, secret.Type) {
		return StorageRecord{}, false
	}
	record := StorageRecord{Namespace: secret.Namespace, Release: resourcemodel.HelmReleaseName(secret.Name)}
	if secret.Type == releaseSecretType && secret.Labels["name"] != "" {
		record.Revision = secretRevision(secret)
	}
	return record, true
}

// ConfigMapStorageRecord returns the record for a ConfigMap Helm's storage
// driver wrote. The release table reads Secret storage only, so the record
// carries just the release to evict.
func ConfigMapStorageRecord(configMap *corev1.ConfigMap) (StorageRecord, bool) {
	if configMap == nil || !isStorageObject(configMap.Name, configMap.Labels, "") {
		return StorageRecord{}, false
	}
	return StorageRecord{Namespace: configMap.Namespace, Release: resourcemodel.HelmReleaseName(configMap.Name)}, true
}

// isStorageObject recognizes Helm storage by Secret type, the owner=helm
// label, or the storage driver's object name.
func isStorageObject(name string, labels map[string]string, secretType corev1.SecretType) bool {
	if secretType == releaseSecretType {
		return true
	}
	if strings.EqualFold(labels["owner"], "helm") || strings.EqualFold(labels["OWNER"], "helm") {
		return true
	}
	return strings.HasPrefix(name, resourcemodel.HelmReleaseNamePrefix)
}

func secretRevision(secret *corev1.Secret) *Revision {
	version, err := strconv.Atoi(secret.Labels["version"])
	if err != nil {
		version = -1
	}
	revision := &Revision{Name: secret.Labels["name"], Version: version, Status: secret.Labels["status"]}
	switch revision.Status {
	case "superseded", "uninstalled":
		return revision
	}
	if decoded, err := decodeStoredRelease(secret.Data["release"]); err == nil {
		revision.Release = tableFields(decoded)
	}
	return revision
}

// tableFields keeps the release fields BuildResourceModel and BuildFacts read
// for a summary row, dropping the chart's templates, values, and files, the
// manifest, and the hooks.
func tableFields(rel *release.Release) *release.Release {
	kept := &release.Release{Name: rel.Name, Namespace: rel.Namespace, Version: rel.Version}
	if rel.Info != nil {
		kept.Info = &release.Info{
			FirstDeployed: rel.Info.FirstDeployed,
			LastDeployed:  rel.Info.LastDeployed,
			Description:   rel.Info.Description,
			Status:        rel.Info.Status,
		}
	}
	if rel.Chart != nil && rel.Chart.Metadata != nil {
		kept.Chart = &chart.Chart{Metadata: &chart.Metadata{
			Name:       rel.Chart.Metadata.Name,
			Version:    rel.Chart.Metadata.Version,
			AppVersion: rel.Chart.Metadata.AppVersion,
		}}
	}
	return kept
}

// decodeStoredRelease reads Helm v3's storage record format
// (storage/driver/util.go): base64 text wrapping an optionally gzipped JSON
// release.
func decodeStoredRelease(data []byte) (*release.Release, error) {
	if len(data) == 0 {
		return nil, fmt.Errorf("helm release record is empty")
	}
	decoded, err := base64.StdEncoding.DecodeString(string(data))
	if err != nil {
		return nil, err
	}
	if len(decoded) > 3 && bytes.Equal(decoded[:3], []byte{0x1f, 0x8b, 0x08}) {
		reader, err := gzip.NewReader(bytes.NewReader(decoded))
		if err != nil {
			return nil, err
		}
		defer reader.Close()
		if decoded, err = io.ReadAll(reader); err != nil {
			return nil, err
		}
	}
	var rls release.Release
	if err := json.Unmarshal(decoded, &rls); err != nil {
		return nil, err
	}
	return &rls, nil
}
