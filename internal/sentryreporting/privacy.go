package sentryreporting

import (
	"path"
	"regexp"
	"sort"
	"strings"

	"github.com/getsentry/sentry-go"
)

const redactedValue = "[redacted]"

var (
	telemetryURLPattern   = regexp.MustCompile(`(?i)\b(?:https?|wss?)://[^\s"'<>]+`)
	telemetryEmailPattern = regexp.MustCompile(
		`(?i)\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b`,
	)
	telemetryIPv4Pattern = regexp.MustCompile(
		`\b(?:25[0-5]|2[0-4][0-9]|1?[0-9]{1,2})(?:\.(?:25[0-5]|2[0-4][0-9]|1?[0-9]{1,2})){3}\b`,
	)
	telemetryIPv6Pattern = regexp.MustCompile(
		`(?i)(?:\b[0-9a-f]{1,4}(?::[0-9a-f]{0,4}){2,7}\b|\b::1\b)`,
	)
	telemetryHostnamePattern = regexp.MustCompile(
		`(?i)\b(?:[a-z0-9](?:[a-z0-9-]{0,62})\.)+(?:com|net|org|io|dev|cloud|local|internal|test|cluster|lan)\b`,
	)
	telemetryUnixHomePattern    = regexp.MustCompile(`(?:/Users|/home)/[^\s"'<>]+`)
	telemetryWindowsHomePattern = regexp.MustCompile(`(?i)[A-Z]:\\Users\\[^\s"'<>]+`)
	telemetrySecretPattern      = regexp.MustCompile(
		`(?i)\b(authorization|access[_-]?key|api[_-]?key|cookie|credential|password|passwd|secret|session|token)\b\s*(?::=|=|:)\s*(?:bearer\s+)?["']?[^\s"',;]+["']?`,
	)
	telemetryBearerPattern           = regexp.MustCompile(`(?i)\bbearer\s+[^\s"',;]+`)
	telemetryKubernetesObjectPattern = regexp.MustCompile(
		`(?i)\b(cluster|namespace|pod|deployment|statefulset|daemonset|service|secret|configmap|job|cronjob|node)s?(?:\.[a-z0-9.-]+)?\s+["'][^"']+["']`,
	)
	telemetryKubernetesPathPattern = regexp.MustCompile(
		`(?i)\b(cluster|namespace|pod|deployment|statefulset|daemonset|service|secret|configmap|job|cronjob|node)s?(?:\.[a-z0-9.-]+)?\s+(?:[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*\b`,
	)
)

var privateTelemetryKeys = map[string]struct{}{
	"authorization": {},
	"body":          {},
	"clusterid":     {},
	"clustername":   {},
	"cookie":        {},
	"cookies":       {},
	"credential":    {},
	"headers":       {},
	"hostname":      {},
	"namespace":     {},
	"password":      {},
	"query":         {},
	"querystring":   {},
	"requestbody":   {},
	"resourcename":  {},
	"secret":        {},
	"servername":    {},
	"token":         {},
	"username":      {},
}

func isPrivateTelemetryKey(key string) bool {
	if strings.HasPrefix(strings.ToLower(key), "_privacy.") {
		return true
	}
	normalized := strings.ToLower(strings.NewReplacer("_", "", "-", "", ".", "").Replace(key))
	_, private := privateTelemetryKeys[normalized]
	return private
}

type telemetryReplacement struct {
	private string
	alias   string
}

func telemetryReplacements(event *sentry.Event) []telemetryReplacement {
	if event == nil {
		return nil
	}
	clusterAlias := event.Tags["cluster.alias"]
	if clusterAlias == "" {
		clusterAlias = "[cluster]"
	}
	replacements := make([]telemetryReplacement, 0, 2)
	for _, key := range []string{"_privacy.cluster_id", "_privacy.cluster_name"} {
		if private := strings.TrimSpace(event.Tags[key]); private != "" {
			replacements = append(replacements, telemetryReplacement{private: private, alias: clusterAlias})
		}
		delete(event.Tags, key)
	}
	sort.Slice(replacements, func(left, right int) bool {
		return len(replacements[left].private) > len(replacements[right].private)
	})
	return replacements
}

func replaceTelemetryText(value string, replacements []telemetryReplacement) string {
	for _, replacement := range replacements {
		value = strings.ReplaceAll(value, replacement.private, replacement.alias)
	}
	return value
}

func replaceTelemetryValue(value any, replacements []telemetryReplacement) any {
	switch typed := value.(type) {
	case string:
		return replaceTelemetryText(typed, replacements)
	case map[string]any:
		return replaceTelemetryMap(typed, replacements)
	case map[string]string:
		result := make(map[string]string, len(typed))
		for key, childValue := range typed {
			result[key] = replaceTelemetryText(childValue, replacements)
		}
		return result
	case []any:
		result := make([]any, len(typed))
		for index, childValue := range typed {
			result[index] = replaceTelemetryValue(childValue, replacements)
		}
		return result
	case []map[string]any:
		result := make([]map[string]any, len(typed))
		for index, childValue := range typed {
			result[index] = replaceTelemetryMap(childValue, replacements)
		}
		return result
	default:
		return value
	}
}

func replaceTelemetryMap(values map[string]any, replacements []telemetryReplacement) map[string]any {
	if values == nil {
		return nil
	}
	result := make(map[string]any, len(values))
	for key, value := range values {
		result[key] = replaceTelemetryValue(value, replacements)
	}
	return result
}

func sanitizeTelemetryText(value string) string {
	if value == "" {
		return ""
	}
	value = telemetryURLPattern.ReplaceAllString(value, "[url]")
	value = telemetryEmailPattern.ReplaceAllString(value, "[email]")
	value = telemetryIPv4Pattern.ReplaceAllString(value, "[ip]")
	value = telemetryIPv6Pattern.ReplaceAllString(value, "[ip]")
	value = telemetryKubernetesObjectPattern.ReplaceAllString(value, `$1 "[resource]"`)
	value = telemetryKubernetesPathPattern.ReplaceAllString(value, `$1 [resource]`)
	value = telemetryHostnamePattern.ReplaceAllString(value, "[host]")
	value = telemetryUnixHomePattern.ReplaceAllString(value, "[local-path]")
	value = telemetryWindowsHomePattern.ReplaceAllString(value, "[local-path]")
	value = telemetrySecretPattern.ReplaceAllString(value, "$1="+redactedValue)
	value = telemetryBearerPattern.ReplaceAllString(value, redactedValue)
	return value
}

func sanitizeTelemetryValue(key string, value any) any {
	if isPrivateTelemetryKey(key) {
		return redactedValue
	}
	switch typed := value.(type) {
	case string:
		// Kubernetes field paths (for example spec.replicas) are structural
		// schema data, not DNS hostnames. Preserve them so validation failures
		// remain actionable while other free-form strings receive host scrubbing.
		if key == "field" {
			return typed
		}
		return sanitizeTelemetryText(typed)
	case map[string]any:
		return sanitizeTelemetryMap(typed)
	case map[string]string:
		result := make(map[string]string, len(typed))
		for childKey, childValue := range typed {
			if isPrivateTelemetryKey(childKey) {
				result[childKey] = redactedValue
			} else {
				result[childKey] = sanitizeTelemetryText(childValue)
			}
		}
		return result
	case []any:
		result := make([]any, len(typed))
		for index, childValue := range typed {
			result[index] = sanitizeTelemetryValue("", childValue)
		}
		return result
	case []map[string]any:
		result := make([]map[string]any, len(typed))
		for index, childValue := range typed {
			result[index] = sanitizeTelemetryMap(childValue)
		}
		return result
	default:
		return value
	}
}

func sanitizeTelemetryMap(values map[string]any) map[string]any {
	if values == nil {
		return nil
	}
	result := make(map[string]any, len(values))
	for key, value := range values {
		result[key] = sanitizeTelemetryValue(key, value)
	}
	return result
}

func sanitizeStacktrace(stacktrace *sentry.Stacktrace) {
	if stacktrace == nil {
		return
	}
	for index := range stacktrace.Frames {
		frame := &stacktrace.Frames[index]
		if relativePath := safeRepositoryFramePath(*frame); relativePath != "" {
			frame.Filename = relativePath
			frame.AbsPath = relativePath
		} else {
			frame.Filename = sanitizeTelemetryText(frame.Filename)
			frame.AbsPath = sanitizeTelemetryText(frame.AbsPath)
		}
		frame.ContextLine = sanitizeTelemetryText(frame.ContextLine)
		for contextIndex := range frame.PreContext {
			frame.PreContext[contextIndex] = sanitizeTelemetryText(frame.PreContext[contextIndex])
		}
		for contextIndex := range frame.PostContext {
			frame.PostContext[contextIndex] = sanitizeTelemetryText(frame.PostContext[contextIndex])
		}
		// Runtime variable capture is unnecessary for diagnosing this app and is
		// too likely to contain credentials or user-entered data.
		frame.Vars = nil
	}
}

func safeRepositoryFramePath(frame sentry.Frame) string {
	if !isApplicationFrame(frame) {
		return ""
	}

	sourcePath := strings.ReplaceAll(frame.Filename, `\`, "/")
	if sourcePath == "" {
		sourcePath = strings.ReplaceAll(frame.AbsPath, `\`, "/")
	}
	filename := path.Base(sourcePath)
	if filename == "." || filename == "/" || filename == "" {
		return ""
	}

	if frame.Module == mainModule {
		if marker := strings.LastIndex(sourcePath, "/app/"); marker >= 0 {
			return strings.TrimPrefix(sourcePath[marker+len("/app/"):], "/")
		}
		return filename
	}

	packagePath := strings.Trim(strings.TrimPrefix(frame.Module, appModulePrefix), "/")
	if packagePath == "" {
		return filename
	}
	return path.Join(packagePath, filename)
}

func prepareStacktrace(stacktrace *sentry.Stacktrace, replacements []telemetryReplacement) {
	if stacktrace == nil {
		return
	}
	for frameIndex := range stacktrace.Frames {
		frame := &stacktrace.Frames[frameIndex]
		frame.AbsPath = replaceTelemetryText(frame.AbsPath, replacements)
		frame.ContextLine = replaceTelemetryText(frame.ContextLine, replacements)
		for contextIndex := range frame.PreContext {
			frame.PreContext[contextIndex] = replaceTelemetryText(frame.PreContext[contextIndex], replacements)
		}
		for contextIndex := range frame.PostContext {
			frame.PostContext[contextIndex] = replaceTelemetryText(frame.PostContext[contextIndex], replacements)
		}
	}
	sanitizeStacktrace(stacktrace)
}

// prepareEventForSend is the final privacy boundary for backend events. SDK
// collection is disabled independently, and this pass protects explicitly set
// or future SDK-populated fields before the transport receives the event.
func prepareEventForSend(event *sentry.Event, hint *sentry.EventHint) *sentry.Event {
	event = trimReportingFrames(event, hint)
	if event == nil {
		return nil
	}

	replacements := telemetryReplacements(event)
	event.User = sentry.User{}
	event.Request = nil
	event.ServerName = ""
	event.Message = sanitizeTelemetryText(replaceTelemetryText(event.Message, replacements))
	event.Logger = sanitizeTelemetryText(replaceTelemetryText(event.Logger, replacements))
	event.Transaction = sanitizeTelemetryText(replaceTelemetryText(event.Transaction, replacements))
	for index := range event.Exception {
		exception := &event.Exception[index]
		exception.Value = sanitizeTelemetryText(replaceTelemetryText(exception.Value, replacements))
		prepareStacktrace(exception.Stacktrace, replacements)
	}
	for index := range event.Threads {
		thread := &event.Threads[index]
		thread.Name = sanitizeTelemetryText(replaceTelemetryText(thread.Name, replacements))
		prepareStacktrace(thread.Stacktrace, replacements)
	}
	for _, breadcrumb := range event.Breadcrumbs {
		if breadcrumb == nil {
			continue
		}
		breadcrumb.Message = sanitizeTelemetryText(replaceTelemetryText(breadcrumb.Message, replacements))
		breadcrumb.Data = sanitizeTelemetryMap(replaceTelemetryMap(breadcrumb.Data, replacements))
	}
	for key, value := range event.Tags {
		if isPrivateTelemetryKey(key) {
			delete(event.Tags, key)
			continue
		}
		event.Tags[key] = sanitizeTelemetryText(replaceTelemetryText(value, replacements))
	}
	for key, value := range event.Contexts {
		event.Contexts[key] = sanitizeTelemetryMap(replaceTelemetryMap(value, replacements))
	}
	return event
}
