#!/usr/bin/env bash
#
# Read-only lookup лида из ПРОД-CRM DirectPort (кластер psy-health, ns directport).
# Используется скиллом /email, чтобы подтянуть контекст лида (компания, контакты,
# услуги, направления импорта, заметки по обзвону, relevance_reason) для письма.
#
# Использование:
#   lead-lookup.sh <строка-поиска>     # название компании / домен / email
#
# Выводит JSON-массив совпавших лидов (до 5, по убыванию relevance_score).
#
# БЕЗОПАСНОСТЬ:
#   - ТОЛЬКО SELECT. Никаких INSERT/UPDATE/DELETE/DDL — это прод-БД.
#   - Строка поиска экранируется как SQL-литерал (удвоение одинарных кавычек),
#     никаких psql-переменных/инъекций.
#   - Пароль не хранится в репо: читается в рантайме из файла-секрета внутри пода.
#   - Идёт в текущий kube-context (ожидается psy-health-prod).
set -euo pipefail

NS=directport
POD=directport-postgresql-0

search="${1:-}"
if [[ -z "$search" ]]; then
  echo "usage: lead-lookup.sh <company-name | domain | email>" >&2
  exit 1
fi

# Экранирование для SQL-литерала: удваиваем одинарные кавычки
# (standard_conforming_strings=on по умолчанию в PostgreSQL).
esc=${search//\'/\'\'}

SQL="SELECT COALESCE(json_agg(row_to_json(l)),'[]') FROM (
  SELECT id, company_name, city, website, domain, inn, emails, phones, services,
         import_directions, does_import, relevance_score, relevance_reason,
         status, last_contacted_at, notes
  FROM leads
  WHERE company_name ILIKE '%$esc%' OR domain ILIKE '%$esc%' OR website ILIKE '%$esc%'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(emails,'[]'::jsonb)) e
                WHERE e ILIKE '%$esc%')
  ORDER BY relevance_score DESC NULLS LAST
  LIMIT 5) l;"

# Делаем зависимость от текущего kube-context явной: пишем его в stderr (stdout —
# только JSON). Если контекст не прод, видно сразу, а не молча читаем чужую БД.
echo "lead-lookup: context=$(kubectl config current-context 2>/dev/null) ns=$NS pod=$POD" >&2

kubectl -n "$NS" exec -i "$POD" -- env SQL_TEXT="$SQL" bash -s <<'REMOTE'
PGPASSWORD="$(cat /opt/bitnami/postgresql/secrets/postgres-password)" \
  psql -U postgres -d directport -At -q -v ON_ERROR_STOP=1 -c "$SQL_TEXT"
REMOTE
