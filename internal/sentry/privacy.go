package sentryreporting

import (
	"errors"
	"path"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/getsentry/sentry-go"
	apierrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
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
		`(?i)\b(cluster|namespace|pod|deployment|statefulset|daemonset|service|secret|configmap|job|cronjob|node)s?(?:\.[a-z0-9.-]+)?\s+(?:[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._-]*|[0-9]|[a-z0-9][a-z0-9._-]*[0-9._-][a-z0-9._-]*)\b`,
	)
	telemetryCapabilityShapePattern = regexp.MustCompile(
		`(?i)\b(?:[a-z0-9*](?:[a-z0-9*.-]*[a-z0-9*])?(?:/[a-z0-9*](?:[a-z0-9*.-]*[a-z0-9*])?)?\s+)?[a-z0-9*](?:[a-z0-9*.-]*[a-z0-9*])?(?:/[a-z0-9*](?:[a-z0-9*.-]*[a-z0-9*])?)?\s+[a-z0-9*](?:[a-z0-9*.-]*[a-z0-9*])?\s+(?:namespace|cluster)-scoped\b`,
	)
	kubernetesFieldPathPattern = regexp.MustCompile(
		`^[A-Za-z_][A-Za-z0-9_-]*(?:(?:\.[A-Za-z_][A-Za-z0-9_-]*)|(?:\[[0-9]+\]))*$`,
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

func telemetryReplacements(event *sentry.Event, hint *sentry.EventHint) []telemetryReplacement {
	if event == nil {
		return nil
	}

	replacements := takePrivateTelemetryTagReplacements(event.Tags)
	if replacement, ok := kubernetesStatusTelemetryReplacement(hint); ok {
		replacements = append(replacements, replacement)
	}
	sort.Slice(replacements, func(left, right int) bool {
		return len(replacements[left].private) > len(replacements[right].private)
	})
	return replacements
}

func takePrivateTelemetryTagReplacements(tags map[string]string) []telemetryReplacement {
	clusterAlias := tags["cluster.alias"]
	if clusterAlias == "" {
		clusterAlias = "[cluster]"
	}

	replacements := make([]telemetryReplacement, 0, 3)
	for _, key := range []string{"_privacy.cluster_id", "_privacy.cluster_name"} {
		if private := strings.TrimSpace(tags[key]); private != "" {
			replacements = append(replacements, telemetryReplacement{private: private, alias: clusterAlias})
		}
		delete(tags, key)
	}
	for key, value := range tags {
		if key != "_privacy.resource_name" && !strings.HasPrefix(key, "_privacy.resource_name.") {
			continue
		}
		if private := strings.TrimSpace(value); private != "" {
			replacements = append(replacements, telemetryReplacement{private: private, alias: "[resource]"})
		}
		delete(tags, key)
	}
	return replacements
}

func kubernetesStatusTelemetryReplacement(hint *sentry.EventHint) (telemetryReplacement, bool) {
	if hint == nil || hint.OriginalException == nil {
		return telemetryReplacement{}, false
	}

	var statusErr apierrors.APIStatus
	if !errors.As(hint.OriginalException, &statusErr) {
		return telemetryReplacement{}, false
	}
	status := statusErr.Status()
	message := strings.TrimSpace(status.Message)
	if message == "" {
		return telemetryReplacement{}, false
	}

	alias := "[kubernetes API details redacted]"
	if status.Details != nil && status.Details.Name != "" {
		alias = `Kubernetes resource "[resource]" request failed`
	}
	return telemetryReplacement{private: message, alias: alias}, true
}

func sanitizeKubernetesFieldPath(value string) string {
	if value == "" {
		return ""
	}
	if len(value) > 512 || !kubernetesFieldPathPattern.MatchString(value) {
		return "[field]"
	}
	return value
}

func sanitizeKubernetesCauseReason(value metav1.CauseType) string {
	switch value {
	case metav1.CauseTypeFieldValueNotFound,
		metav1.CauseTypeFieldValueRequired,
		metav1.CauseTypeFieldValueDuplicate,
		metav1.CauseTypeFieldValueInvalid,
		metav1.CauseTypeFieldValueNotSupported,
		metav1.CauseTypeForbidden,
		metav1.CauseTypeTooLong,
		metav1.CauseTypeTooMany,
		metav1.CauseTypeInternal,
		metav1.CauseTypeTypeInvalid,
		metav1.CauseTypeUnexpectedServerResponse,
		metav1.CauseTypeFieldManagerConflict,
		metav1.CauseTypeResourceVersionTooLarge:
		return string(value)
	default:
		return "Unknown"
	}
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

func sanitizeCapabilityTelemetryText(value string) string {
	shapes := telemetryCapabilityShapePattern.FindAllString(value, -1)
	if len(shapes) == 0 {
		return sanitizeTelemetryText(value)
	}

	protected := value
	placeholders := make([]string, len(shapes))
	for index, shape := range shapes {
		placeholder := "\x1ecapability-shape-" + strconv.Itoa(index) + "\x1f"
		placeholders[index] = placeholder
		protected = strings.Replace(protected, shape, placeholder, 1)
	}

	protected = sanitizeTelemetryText(protected)
	for index, placeholder := range placeholders {
		protected = strings.ReplaceAll(protected, placeholder, shapes[index])
	}
	return protected
}

func sanitizeErrorContext(values map[string]any, preserveLegacyCapabilityShapes bool) map[string]any {
	if values == nil {
		return nil
	}
	result := make(map[string]any, len(values))
	for key, value := range values {
		if key == "operation" {
			if operation := sanitizeOperationTelemetryContext(value); operation != nil {
				result[key] = operation
				continue
			}
			if operation, ok := value.(string); ok && preserveLegacyCapabilityShapes {
				result[key] = sanitizeCapabilityTelemetryText(operation)
				continue
			}
			// Free-form operation strings are not part of the telemetry schema.
			continue
		}
		result[key] = sanitizeTelemetryValue(key, value)
	}
	return result
}

func sanitizeTelemetryValue(key string, value any) any {
	if isPrivateTelemetryKey(key) {
		return redactedValue
	}
	switch typed := value.(type) {
	case string:
		// Preserve only structurally valid Kubernetes schema paths. Map-key paths
		// can contain user-provided values, so they are deliberately collapsed.
		if key == "field" {
			return sanitizeKubernetesFieldPath(typed)
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

func sanitizeReplacedTelemetryText(value string, replacements []telemetryReplacement) string {
	return sanitizeTelemetryText(replaceTelemetryText(value, replacements))
}

func clearPrivateEventFields(event *sentry.Event) {
	event.User = sentry.User{}
	event.Request = nil
	event.ServerName = ""
}

func prepareEventTextFields(event *sentry.Event, replacements []telemetryReplacement) {
	event.Message = sanitizeReplacedTelemetryText(event.Message, replacements)
	event.Logger = sanitizeReplacedTelemetryText(event.Logger, replacements)
	event.Transaction = sanitizeReplacedTelemetryText(event.Transaction, replacements)
}

func prepareEventExceptions(event *sentry.Event, replacements []telemetryReplacement) {
	for index := range event.Exception {
		exception := &event.Exception[index]
		exception.Value = sanitizeReplacedTelemetryText(exception.Value, replacements)
		prepareStacktrace(exception.Stacktrace, replacements)
	}
}

func prepareEventThreads(event *sentry.Event, replacements []telemetryReplacement) {
	for index := range event.Threads {
		thread := &event.Threads[index]
		thread.Name = sanitizeReplacedTelemetryText(thread.Name, replacements)
		prepareStacktrace(thread.Stacktrace, replacements)
	}
}

func prepareEventBreadcrumbs(event *sentry.Event, replacements []telemetryReplacement) {
	for _, breadcrumb := range event.Breadcrumbs {
		if breadcrumb == nil {
			continue
		}
		message := replaceTelemetryText(breadcrumb.Message, replacements)
		if breadcrumb.Category == "Capabilities" {
			breadcrumb.Message = sanitizeCapabilityTelemetryText(message)
		} else {
			breadcrumb.Message = sanitizeTelemetryText(message)
		}
		breadcrumb.Data = sanitizeTelemetryMap(replaceTelemetryMap(breadcrumb.Data, replacements))
	}
}

func prepareEventTags(event *sentry.Event, replacements []telemetryReplacement) {
	for key, value := range event.Tags {
		if isPrivateTelemetryKey(key) {
			delete(event.Tags, key)
			continue
		}
		event.Tags[key] = sanitizeReplacedTelemetryText(value, replacements)
	}
}

func prepareEventContexts(
	event *sentry.Event,
	replacements []telemetryReplacement,
	isCapabilitiesEvent bool,
) {
	for key, value := range event.Contexts {
		replaced := replaceTelemetryMap(value, replacements)
		if key == "error" {
			event.Contexts[key] = sanitizeErrorContext(replaced, isCapabilitiesEvent)
		} else {
			event.Contexts[key] = sanitizeTelemetryMap(replaced)
		}
	}
}

// prepareEventForSend is the final privacy boundary for backend events. SDK
// collection is disabled independently, and this pass protects explicitly set
// or future SDK-populated fields before the transport receives the event.
func prepareEventForSend(event *sentry.Event, hint *sentry.EventHint) *sentry.Event {
	event = trimReportingFrames(event, hint)
	if event == nil {
		return nil
	}

	replacements := telemetryReplacements(event, hint)
	isCapabilitiesEvent := event.Tags["source"] == "Capabilities"
	clearPrivateEventFields(event)
	prepareEventTextFields(event, replacements)
	prepareEventExceptions(event, replacements)
	prepareEventThreads(event, replacements)
	prepareEventBreadcrumbs(event, replacements)
	prepareEventTags(event, replacements)
	prepareEventContexts(event, replacements, isCapabilitiesEvent)
	return event
}
