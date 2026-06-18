# Прод-деплой DirectPort (кластер psy-health, ArgoCD)

Прод DirectPort выкатывается в **кластер psy-health** через **ArgoCD** (GitOps), а не в собственный
stage. GitHub Actions только собирает образы; деплой делает ArgoCD из GitOps-репо
`psy-health/platform-gitops`. Этот документ — чеклист того, **что нужно сделать руками** для bring-up
(всё остальное — код чарта, Application, ESO-манифесты и CI — уже в репозиториях).

## Архитектура (чем прод отличается от stage)

| Аспект | stage (выводится) | прод psy-health |
|---|---|---|
| Деплой | GitHub Actions `helm upgrade` | **ArgoCD** Application (`apps/directport.yaml`) |
| Ingress | nginx | **Traefik** (`className: traefik`) |
| TLS | cert-manager / letsencrypt | **Cloudflare Origin Cert** (ESO, без ACME) |
| Секреты | helm values → Secret | **Vault + External Secrets Operator** (`kv/platform/directport*`) |
| Pull образов | `ghcr-pull` из GitHub Secrets | ESO-секрет `ghcr-directport` из Vault |
| Версия образа | `--set image.tag=<sha>` | тег в `values/directport-prod.yaml` (`prod` → позже `<sha>`) |
| PostgreSQL/Redis | Bitnami in-cluster | Bitnami in-cluster (без изменений) |

Где что лежит в `platform-gitops`:
- `apps/directport.yaml` — ArgoCD Application (multi-source: чарт `deploy/helm/directport` из
  `ioncreature/direct-port` + `values/directport-prod.yaml`), namespace `directport`, sync-wave 2.
- `values/directport-prod.yaml` — прод-оверрайды (Traefik, домены, образы, ESO-секреты).
- `secrets/namespace-directport.yaml` + `secrets/external-secret-directport-*.yaml` — namespace и 4 ExternalSecret.
- `vault/directport-seed.md` — команды засева Vault.

## Предусловия (в кластере уже есть)

ArgoCD (app-of-apps), External Secrets Operator (`ClusterSecretStore vault-kv`), Vault, Traefik,
дефолтный StorageClass для PVC. Всё это уже используется приложением `numbergym` — отдельно ставить не нужно.

---

## Шаги bring-up

### 1. Засеять Vault

Точные команды `vault kv put` и полный список ключей — в `platform-gitops/vault/directport-seed.md`.
Всего три записи под `kv/platform/directport*` (ESO-роль `external-secrets` уже читает
`kv/data/platform/*`, новых политик не нужно):

- `kv/platform/directport` — переменные окружения приложения (DATABASE_URL, REDIS_URL, JWT/ключи,
  токены ботов; пароль PostgreSQL = тот же, что внутри DATABASE_URL).
- `kv/platform/directport-ghcr` — `dockerconfigjson` (classic PAT с `read:packages` на `ioncreature/*`).
- `kv/platform/directport-origin-cert` — `tls.crt` / `tls.key` (Cloudflare Origin Cert).

Значения (TKS/Anthropic/JWT/боты) переносятся 1:1 из текущих GitHub Actions secrets stage.

### 2. DNS и TLS (Cloudflare)

- Завести `directport.ru`, `admin.directport.ru`, `api.directport.ru` в ту же точку входа кластера,
  что и `psy-health.systems` (Cloudflare → cloudflared-tunnel/Traefik).
- Выпустить **Cloudflare Origin Certificate** на `directport.ru` + `*.directport.ru` и положить его
  cert/key в Vault (шаг 1, `directport-origin-cert`).

### 3. Доступ ArgoCD к приватному репозиторию

В ArgoCD: Settings → Repositories → добавить `https://github.com/ioncreature/direct-port`
(deploy key или PAT). Иначе source чарта не зарезолвится (как было для `brain-game`).

### 4. Собрать образы

Влить ветку с изменениями `direct-port` в `main` → workflow **`build-images.yml`** соберёт и запушит
`ghcr.io/ioncreature/direct-port-{api,admin-web,client-bot,manager-bot,landing}` с тегами `<sha>` и `prod`.
Убедиться, что прогон зелёный и образы появились в GHCR.

### 5. Включить приложение в ArgoCD

Влить артефакты `platform-gitops` (apps/values/secrets/vault) в его `main`. ArgoCD засинкает по волнам:
- **wave -1** (`secrets` app) — namespace `directport` + ExternalSecret'ы → k8s-секреты из Vault;
- **wave 2** (`directport` app) — Bitnami PostgreSQL/Redis + сервисы;
- **PostSync** — Job миграций (`migration:run`); API при старте сидит `admin@directport.ru`.

### 6. Проверка

```bash
kubectl -n directport get externalsecret   # все SecretSynced / READY=True
kubectl -n directport get pods,svc,ingress # поды Ready, ingressClassName=traefik
kubectl -n directport logs job/directport-migration  # миграции прошли
```

- `https://directport.ru` — лендинг открывается, CTA ведёт в client-bot.
- `https://admin.directport.ru` — вход `admin@directport.ru` (пароль из сида / смена при первом входе).
- Загрузка тестового `.xlsx` через client-bot → пайплайн доходит до `PROCESSED`, manager-bot получает уведомление.

### 7. Погасить stage

После подтверждения работы прода:
```bash
helm uninstall directport-stage -n directport-stage
kubectl delete namespace directport-stage
```
+ снять внешний nginx-прокси `coreimport.ru` (`deploy/coreimport-stage-proxy.conf`) и убедиться, что
секреты stage в GitHub (`KUBE_CONFIG_STAGE` и т.д.) больше не нужны. Workflow `deploy-stage.yml` уже
удалён из репозитория (заменён на `build-images.yml`).

---

## Заметки и риски

- **Bitnami PG/Redis тянутся как `:latest` с docker.io** (поведение чарта, как на stage). На прод-кластере
  возможен docker.io rate-limit — стоит запиннить версии образов PG/Redis (или зеркалировать). Не блокер.
- **`api.directport.ru` не обязателен**: админка ходит на свой origin (`/api`) и проксирует на API внутри
  кластера; внешние клиенты на API напрямую не ходят. Можно убрать host из ingress без потери функциональности.
- **Лендинг** вшивает `NEXT_PUBLIC_TELEGRAM_BOT_URL` (`t.me/direct_port_bot`) и `NEXT_PUBLIC_SITE_URL`
  (`directport.ru`) на этапе сборки. Если прод client-bot имеет другой username — пересобрать landing с build-arg.
- **Боты на polling**: т.к. stage гасится, прод может переиспользовать те же токены без конфликта `getUpdates`.
- **StorageClass**: если в кластере нет дефолтного — задать `postgresql.primary.persistence.storageClass`
  в `values/directport-prod.yaml` (есть закомментированный блок), иначе PVC зависнет в Pending.
