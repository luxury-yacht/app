package snapshot

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"testing"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"

	"github.com/luxury-yacht/app/backend/refresh/metrics"
	"github.com/luxury-yacht/app/backend/resources/configmap"
	"github.com/luxury-yacht/app/backend/resources/customresource"
	podresource "github.com/luxury-yacht/app/backend/resources/pods"
)

type representativeRowFixture struct {
	name string
	row  func(int) any
}

func representativeResourceRowFixtures() []representativeRowFixture {
	created := metav1.NewTime(time.Unix(1_700_000_000, 0))
	metaFor := func(index int) ClusterMeta {
		cluster := index % 2
		return ClusterMeta{
			ClusterID:   fmt.Sprintf("cluster-%d", cluster),
			ClusterName: fmt.Sprintf("development-cluster-%d", cluster),
		}
	}
	objectMetaFor := func(index int, prefix string) metav1.ObjectMeta {
		return metav1.ObjectMeta{
			Name:              fmt.Sprintf("%s-%04d", prefix, index),
			Namespace:         fmt.Sprintf("namespace-%d", index%5),
			UID:               types.UID(fmt.Sprintf("uid-%s-%04d", prefix, index)),
			ResourceVersion:   fmt.Sprintf("%d", index+1),
			CreationTimestamp: created,
		}
	}

	return []representativeRowFixture{
		{
			name: "config",
			row: func(index int) any {
				return configmap.BuildStreamSummary(metaFor(index), &corev1.ConfigMap{
					ObjectMeta: objectMetaFor(index, "config"),
					Data:       map[string]string{"config.yaml": "enabled: true"},
				})
			},
		},
		{
			name: "events",
			row: func(index int) any {
				event := &corev1.Event{
					ObjectMeta: objectMetaFor(index, "event"),
					InvolvedObject: corev1.ObjectReference{
						APIVersion: "apps/v1",
						Kind:       "Deployment",
						Namespace:  fmt.Sprintf("namespace-%d", index%5),
						Name:       fmt.Sprintf("deployment-%04d", index),
						UID:        types.UID(fmt.Sprintf("uid-deployment-%04d", index)),
					},
					Type:    corev1.EventTypeWarning,
					Reason:  "Unhealthy",
					Message: "Readiness probe failed",
					Source:  corev1.EventSource{Component: "kubelet"},
					LastTimestamp: metav1.Time{
						Time: created.Time.Add(time.Duration(index) * time.Second),
					},
				}
				row, ok := projectNamespaceEventSummary(metaFor(index), event)
				if !ok {
					panic("representative namespace Event was not projected")
				}
				return row
			},
		},
		{
			name: "pods",
			row: func(index int) any {
				pod := &corev1.Pod{
					ObjectMeta: objectMetaFor(index, "pod"),
					Spec: corev1.PodSpec{
						NodeName: "worker-1",
						Containers: []corev1.Container{{
							Name:  "app",
							Ports: []corev1.ContainerPort{{ContainerPort: 8080}},
						}},
					},
					Status: corev1.PodStatus{Phase: corev1.PodRunning},
				}
				return podresource.BuildStreamSummaryFromRSMap(metaFor(index), pod, 125, 64*1024*1024, nil)
			},
		},
		{
			name: "workloads",
			row: func(index int) any {
				replicas := int32(3)
				deployment := &appsv1.Deployment{
					ObjectMeta: objectMetaFor(index, "deployment"),
					Spec: appsv1.DeploymentSpec{
						Replicas: &replicas,
						Template: corev1.PodTemplateSpec{Spec: corev1.PodSpec{Containers: []corev1.Container{{
							Name:  "app",
							Ports: []corev1.ContainerPort{{ContainerPort: 8080}},
						}}}},
					},
					Status: appsv1.DeploymentStatus{ReadyReplicas: 2},
				}
				meta := metaFor(index)
				row := (&NamespaceWorkloadsBuilder{}).buildDeploymentSummary(
					meta.ClusterID,
					deployment,
					nil,
					map[string]metrics.PodUsage{},
				)
				return row
			},
		},
		{
			name: "nodes",
			row: func(index int) any {
				nodeMeta := objectMetaFor(index, "node")
				nodeMeta.Namespace = ""
				node := &corev1.Node{
					ObjectMeta: nodeMeta,
					Status: corev1.NodeStatus{
						NodeInfo: corev1.NodeSystemInfo{KubeletVersion: "v1.34.1"},
						Addresses: []corev1.NodeAddress{{
							Type:    corev1.NodeInternalIP,
							Address: "10.0.0.10",
						}},
					},
				}
				return buildNodeOwnSummary(metaFor(index), node)
			},
		},
		{
			name: "custom-resources",
			row: func(index int) any {
				object := &unstructured.Unstructured{Object: map[string]any{
					"apiVersion": "database.example.io/v1alpha1",
					"kind":       "Database",
					"metadata": map[string]any{
						"name":              fmt.Sprintf("database-%04d", index),
						"namespace":         fmt.Sprintf("namespace-%d", index%5),
						"uid":               fmt.Sprintf("uid-database-%04d", index),
						"resourceVersion":   fmt.Sprintf("%d", index+1),
						"creationTimestamp": created.Format(time.RFC3339),
						"labels":            map[string]any{"app": "database"},
					},
					"status": map[string]any{
						"phase": "Ready",
						"conditions": []any{map[string]any{
							"type": "Ready", "status": "True", "reason": "Available",
						}},
					},
				}}
				return customresource.BuildNamespaceStreamSummary(
					metaFor(index),
					object,
					"database.example.io",
					"v1alpha1",
					"databases",
					"Database",
					"databases.database.example.io",
					fmt.Sprintf("namespace-%d", index%5),
				)
			},
		},
	}
}

func buildRepresentativeRows(fixture representativeRowFixture, count int) []any {
	rows := make([]any, count)
	for index := range rows {
		rows[index] = fixture.row(index)
	}
	return rows
}

func TestRepresentativeResourceRowWireSizes(t *testing.T) {
	for _, fixture := range representativeResourceRowFixtures() {
		for _, count := range []int{50, 250, 1_000} {
			rows := buildRepresentativeRows(fixture, count)
			encoded, err := json.Marshal(rows)
			if err != nil {
				t.Fatalf("marshal %s/%d: %v", fixture.name, count, err)
			}
			t.Logf("family=%s rows=%d bytes=%d bytes_per_row=%.1f", fixture.name, count, len(encoded), float64(len(encoded))/float64(count))
		}
	}
}

func BenchmarkRepresentativeResourceRowWireEncode(b *testing.B) {
	for _, fixture := range representativeResourceRowFixtures() {
		rows := buildRepresentativeRows(fixture, 1_000)
		b.Run(fixture.name, func(b *testing.B) {
			b.ReportAllocs()
			for b.Loop() {
				encoded, err := json.Marshal(rows)
				if err != nil {
					b.Fatal(err)
				}
				b.ReportMetric(float64(len(encoded)), "wire-bytes")
			}
		})
	}
}

func compressedRepresentativeRows(rows []any) ([]byte, int, error) {
	encoded, err := json.Marshal(rows)
	if err != nil {
		return nil, 0, err
	}
	var compressed bytes.Buffer
	writer, err := gzip.NewWriterLevel(&compressed, gzip.BestSpeed)
	if err != nil {
		return nil, 0, err
	}
	if _, err := writer.Write(encoded); err != nil {
		_ = writer.Close()
		return nil, 0, err
	}
	if err := writer.Close(); err != nil {
		return nil, 0, err
	}
	return compressed.Bytes(), len(encoded), nil
}

func TestRepresentativeResourceRowCompressedWireSizes(t *testing.T) {
	for _, fixture := range representativeResourceRowFixtures() {
		if fixture.name != "events" && fixture.name != "pods" && fixture.name != "custom-resources" {
			continue
		}
		for _, count := range []int{50, 250, 1_000} {
			compressed, uncompressedBytes, err := compressedRepresentativeRows(
				buildRepresentativeRows(fixture, count),
			)
			if err != nil {
				t.Fatalf("compress %s/%d: %v", fixture.name, count, err)
			}
			t.Logf(
				"family=%s rows=%d uncompressed_bytes=%d gzip_bytes=%d reduction=%.1f%%",
				fixture.name,
				count,
				uncompressedBytes,
				len(compressed),
				100*(1-float64(len(compressed))/float64(uncompressedBytes)),
			)
		}
	}
}

func BenchmarkRepresentativeResourceRowTransportEncode(b *testing.B) {
	for _, fixture := range representativeResourceRowFixtures() {
		if fixture.name != "events" && fixture.name != "pods" && fixture.name != "custom-resources" {
			continue
		}
		for _, count := range []int{50, 250, 1_000} {
			rows := buildRepresentativeRows(fixture, count)
			b.Run(fmt.Sprintf("%s/%d/uncompressed", fixture.name, count), func(b *testing.B) {
				b.ReportAllocs()
				for b.Loop() {
					encoded, err := json.Marshal(rows)
					if err != nil {
						b.Fatal(err)
					}
					b.ReportMetric(float64(len(encoded)), "wire-bytes")
				}
			})
			b.Run(fmt.Sprintf("%s/%d/gzip", fixture.name, count), func(b *testing.B) {
				b.ReportAllocs()
				for b.Loop() {
					compressed, _, err := compressedRepresentativeRows(rows)
					if err != nil {
						b.Fatal(err)
					}
					b.ReportMetric(float64(len(compressed)), "wire-bytes")
				}
			})
		}
	}
}
