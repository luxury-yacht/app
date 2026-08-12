{{- if .IsBeta -}}

## Beta Release

{{- else -}}

## Release

{{- end }}

**Version:** {{.Version}}
{{- if .Commit }}
**Commit:** [{{.Commit}}]({{.RepoURL}}/commit/{{.Commit}})
{{- end }}
{{- if .IsBeta }}
**Expires:** {{.BetaExpiry}}

### ⚠️ Important

This is a time-limited beta release that will stop working after the expiry date.
{{- end }}
{{- if .PendingNotesBody }}

{{ .PendingNotesBody }}
{{- end }}
