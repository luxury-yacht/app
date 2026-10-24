package errorstatus

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/url"
	"strings"

	apierrors "k8s.io/apimachinery/pkg/api/errors"
)

const (
	connectionRefusedReason = "connection refused"
	connectionResetReason   = "connection reset"
	noSuchHostReason        = "no such host"
	tlsHandshakeReason      = "tls handshake"
)

type retryTextReason struct {
	token  string
	reason string
}

var (
	urlRetryTextReasons = []retryTextReason{
		{token: connectionRefusedReason, reason: connectionRefusedReason},
		{token: connectionResetReason, reason: connectionResetReason},
		{token: noSuchHostReason, reason: "dns lookup failure"},
		{token: "tls", reason: tlsHandshakeReason},
	}
	genericRetryTextReasons = []retryTextReason{
		{token: connectionRefusedReason, reason: connectionRefusedReason},
		{token: connectionResetReason, reason: connectionResetReason},
		{token: noSuchHostReason, reason: noSuchHostReason},
		{token: "server misbehaving", reason: "server misbehaving"},
		{token: "i/o timeout", reason: "i/o timeout"},
		{token: tlsHandshakeReason, reason: tlsHandshakeReason},
	}
)

// Transient reports whether the same request may succeed if it is simply
// retried, and a short reason for the retry log.
func Transient(err error) (bool, string) {
	if err == nil {
		return false, ""
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return true, "request timeout"
	}
	if isNetworkTimeout(err) {
		return true, "network timeout"
	}
	if reason := retryableURLReason(err); reason != "" {
		return true, reason
	}
	if errors.Is(err, io.EOF) {
		return true, "unexpected eof"
	}
	if reason := matchingRetryTextReason(err.Error(), genericRetryTextReasons); reason != "" {
		return true, reason
	}
	if reason := kubernetesRetryReason(err); reason != "" {
		return true, reason
	}
	return false, ""
}

func isNetworkTimeout(err error) bool {
	var netErr net.Error
	return errors.As(err, &netErr) && netErr.Timeout()
}

func retryableURLReason(err error) string {
	var urlErr *url.Error
	if !errors.As(err, &urlErr) || urlErr == nil {
		return ""
	}
	if urlErr.Timeout() {
		return "network timeout"
	}
	if urlErr.Err == nil {
		return ""
	}
	return matchingRetryTextReason(urlErr.Err.Error(), urlRetryTextReasons)
}

func matchingRetryTextReason(message string, reasons []retryTextReason) string {
	lowered := strings.ToLower(message)
	for _, candidate := range reasons {
		if strings.Contains(lowered, candidate.token) {
			return candidate.reason
		}
	}
	return ""
}

func kubernetesRetryReason(err error) string {
	if apierrors.IsTimeout(err) || apierrors.IsServerTimeout(err) {
		return "kubernetes timeout"
	}
	if apierrors.IsTooManyRequests(err) {
		return "rate limited"
	}
	if statusErr, ok := err.(*apierrors.StatusError); ok && statusErr != nil {
		if code := statusErr.ErrStatus.Code; code >= 500 && code < 600 {
			return fmt.Sprintf("apiserver %d", code)
		}
	}
	return ""
}
