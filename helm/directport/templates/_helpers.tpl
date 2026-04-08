{{- define "directport.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "directport.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "directport.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version | replace "+" "_" }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: directport
{{- end }}

{{- define "directport.selectorLabels" -}}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "directport.apiUrl" -}}
http://{{ include "directport.fullname" . }}-api:{{ .Values.api.port }}/api
{{- end }}

{{- define "directport.databaseUrl" -}}
{{- if .Values.secrets.databaseUrl }}
{{- .Values.secrets.databaseUrl }}
{{- else }}
{{- $host := ternary (printf "%s-postgresql" .Release.Name) .Values.postgresql.host .Values.postgresql.enabled }}
{{- printf "postgresql://%s:%s@%s:5432/%s" .Values.postgresql.auth.username .Values.postgresql.auth.password $host .Values.postgresql.auth.database }}
{{- end }}
{{- end }}

{{- define "directport.redisUrl" -}}
{{- if .Values.secrets.redisUrl }}
{{- .Values.secrets.redisUrl }}
{{- else }}
{{- $host := ternary (printf "%s-redis" .Release.Name) .Values.redis.host .Values.redis.enabled }}
{{- printf "redis://%s:%d" $host (int .Values.redis.port) }}
{{- end }}
{{- end }}
