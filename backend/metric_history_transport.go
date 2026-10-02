package backend

import (
	"context"
	"encoding/json"
	"strconv"

	"github.com/luxury-yacht/app/backend/metrichistory"
	"github.com/luxury-yacht/app/backend/resources/common"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	utilnet "k8s.io/apimachinery/pkg/util/net"
	"k8s.io/client-go/rest"
)

// inClusterQuerier reads a Prometheus Service through the API server's Service proxy, with the
// cluster's kubeconfig login. The route is the one client-go's ProxyGet builds.
type inClusterQuerier struct {
	client rest.Interface
	target MetricInClusterTarget
}

func newInClusterQuerier(deps common.Dependencies, target MetricInClusterTarget) metricQuerier {
	return inClusterQuerier{client: deps.KubernetesClient.CoreV1().RESTClient(), target: target}
}

func (q inClusterQuerier) QueryRange(ctx context.Context, promql string, grid metrichistory.Grid) ([]byte, error) {
	return q.get(ctx, "/api/v1/query_range", map[string]string{
		"query": promql,
		"start": strconv.FormatInt(grid.Start().Unix(), 10),
		"end":   strconv.FormatInt(grid.End().Unix(), 10),
		"step":  strconv.FormatFloat(grid.Step().Seconds(), 'f', -1, 64),
	})
}

func (q inClusterQuerier) BuildInfo(ctx context.Context) ([]byte, error) {
	return q.get(ctx, "/api/v1/status/buildinfo", nil)
}

func (q inClusterQuerier) get(ctx context.Context, endpoint string, params map[string]string) ([]byte, error) {
	request := q.client.Get().
		Namespace(q.target.Namespace).
		Resource("services").
		Name(utilnet.JoinSchemeNamePort(q.target.Scheme, q.target.Service, q.target.Port)).
		SubResource("proxy").
		Suffix(q.target.PathPrefix, endpoint).
		// The clientset negotiates protobuf first; Prometheus speaks JSON.
		SetHeader("Accept", "application/json")
	for key, value := range params {
		request = request.Param(key, value)
	}
	body, err := request.DoRaw(ctx)
	if err != nil {
		return proxyFailure(body, err)
	}
	return body, nil
}

// proxyFailure turns a failed proxy GET into what the caller can report. Prometheus' own error
// reply (a bad query, a query timeout) is returned as the body so its reason is decoded. An API
// server Status (no endpoints, forbidden) becomes an error with its message, which DoRaw's error
// leaves out for JSON replies.
func proxyFailure(body []byte, err error) ([]byte, error) {
	var prometheusReply struct {
		Status    string `json:"status"`
		ErrorType string `json:"errorType"`
	}
	if json.Unmarshal(body, &prometheusReply) == nil && prometheusReply.Status == "error" && prometheusReply.ErrorType != "" {
		return body, nil
	}
	var status metav1.Status
	if json.Unmarshal(body, &status) == nil && status.Kind == "Status" && status.Message != "" {
		return nil, apierrors.FromObject(&status)
	}
	return nil, err
}
