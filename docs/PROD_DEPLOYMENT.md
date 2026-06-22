# Прод-деплой DirectPort (кластер psy-health, ArgoCD)

Прод DirectPort выкатывается в **кластер psy-health** через **ArgoCD** (GitOps), а не в собственный
stage. GitHub Actions собирает образы и открывает **deploy-PR** в GitOps-репо
`psy-health/platform-gitops` (бамп `image.tag` → git sha в `values/directport-prod.yaml`); **merge
этого PR = деплой** — ArgoCD синкает чарт. Этот документ — чеклист того, **что нужно сделать руками**
для bring-up (всё остальное — код чарта, Application, ESO-манифесты и CI — уже в репозиториях).

## Архитектура (чем прод отличается от stage)

| Аспект           | stage (выводится)             | прод psy-health                                                                                              |
| ---------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Деплой           | GitHub Actions `helm upgrade` | **ArgoCD** Application (`apps/directport.yaml`)                                                              |
| Ingress          | nginx                         | **Traefik** (`className: traefik`)                                                                           |
| TLS              | cert-manager / letsencrypt    | терминируется на внешнем **stage-proxy** (nginx); в Traefik re-encrypt с default cert (Origin Cert не нужен) |
| Секреты          | helm values → Secret          | **Vault + External Secrets Operator** (`kv/platform/directport*`)                                            |
| Pull образов     | `ghcr-pull` из GitHub Secrets | ESO-секрет `ghcr-directport` из Vault                                                                        |
| Версия образа    | `--set image.tag=<sha>`       | git sha в `values/directport-prod.yaml`, бампится авто-PR из CI (`build-images`); merge PR = деплой          |
| PostgreSQL/Redis | Bitnami in-cluster            | Bitnami in-cluster (без изменений)                                                                           |

Где что лежит в `platform-gitops`:

- `apps/directport.yaml` — ArgoCD Application (multi-source: чарт `deploy/helm/directport` из
  `ioncreature/direct-port` + `values/directport-prod.yaml`), namespace `directport`, sync-wave 2.
- `values/directport-prod.yaml` — прод-оверрайды (Traefik ingress без TLS, домены, образы, ESO-секреты).
- `secrets/namespace-directport.yaml` + `secrets/external-secret-directport-*.yaml` — namespace и 3 ExternalSecret (app, postgresql-auth, ghcr).
- `vault/directport-seed.md` — команды засева Vault.

## Предусловия (в кластере уже есть)

ArgoCD (app-of-apps), External Secrets Operator (`ClusterSecretStore vault-kv`), Vault, Traefik,
дефолтный StorageClass для PVC. Всё это уже используется приложением `numbergym` — отдельно ставить не нужно.

---

## Шаги bring-up

### 1. Засеять Vault

Точные команды `vault kv put` и полный список ключей — в `platform-gitops/vault/directport-seed.md`.
Две записи под `kv/platform/directport*` (ESO-роль `external-secrets` уже читает
`kv/data/platform/*`, новых политик не нужно):

- `kv/platform/directport` — переменные окружения приложения (DATABASE_URL, REDIS_URL, JWT/ключи,
  токены ботов; пароль PostgreSQL = тот же, что внутри DATABASE_URL).
- `kv/platform/directport-ghcr` — `dockerconfigjson` (classic PAT с `read:packages` на `ioncreature/*`).

Значения (TKS/Anthropic/JWT/боты) переносятся 1:1 из текущих GitHub Actions secrets stage.
TLS — на внешнем stage-proxy, отдельной Vault-записи для сертификата нет.

### 2. DNS и маршрутизация (внешний Caddy-прокси)

Трафик идёт через внешний **Caddy** (`ssh cicd@stage-proxy`, конфиг `/etc/caddy/Caddyfile`): он
терминирует публичный TLS (letsencrypt, авто-выпуск по доменам из Caddyfile) и проксирует в Traefik
кластера (`reverse_proxy https://<traefik>` с `tls_insecure_skip_verify`, re-encrypt). Origin Cert не нужен.

**Публичные домены** (DNS заведён на Caddy-хост + есть блок в Caddyfile):

- `directport.ru` — лендинг (Caddy шлёт `Host directport.ru`).
- `admin-access.directport.ru` — админка (Caddy шлёт `Host admin.directport.ru`).

⚠️ **Публичный домен админки — `admin-access.directport.ru`, а НЕ `admin.directport.ru`.** Внутри
кластера Traefik роутит по `Host: admin.directport.ru` (= `ingress.hosts.admin.host`), на который Caddy
переписывает заголовок; снаружи `admin.directport.ru` и `api.directport.ru` НЕ резолвятся (блоков в
Caddy нет). Отдельным публичным доменом API наружу не выставлен — внешний доступ к нему идёт через
админку-прокси: `https://admin-access.directport.ru/api/*` (admin-web проксирует `/api` на API-сервис,
`X-Internal-Key` проходит насквозь). Это и есть базовый URL для внешних service-to-service клиентов
(напр. routine лидген-агента).

- В кластере `ingress.hosts` в `values/directport-prod.yaml` = ВНУТРЕННИЕ хосты (`admin.directport.ru`,
  `api.directport.ru`), по которым роутит Traefik; публичными их делает только блок в Caddy. Проксировать
  на **websecure**-entrypoint (https): Traefik редиректит http→https, иначе вернёт 301.
- ‼️ **`managerBot.adminWebBaseUrl` в `values/directport-prod.yaml` ДОЛЖЕН быть `https://admin-access.directport.ru`.**
  Если не задан — `ADMIN_WEB_BASE_URL` выведется из внутреннего `ingress.hosts.admin.host` и deep-link
  кнопки менеджерского бота («Открыть в админке») будут вести в мёртвый `admin.directport.ru`.

### 3. Доступ ArgoCD к приватному репозиторию

В ArgoCD: Settings → Repositories → добавить `https://github.com/ioncreature/direct-port`
(deploy key или PAT). Иначе source чарта не зарезолвится (как было для `brain-game`).

### 4. Собрать образы и открыть deploy-PR

Завести в репозитории `ioncreature/direct-port` secret **`GITOPS_PAT`** — fine-grained PAT к
`psy-health/platform-gitops` (права `contents` + `pull-requests: write`). Без него job `bump-gitops`
не сможет открыть PR в GitOps-репо.

Влить ветку с изменениями `direct-port` в `main` → workflow **`build-images.yml`**: соберёт и запушит
`ghcr.io/ioncreature/direct-port-{api,admin-web,client-bot,manager-bot,landing}` с тегами `<sha>` и `prod`,
затем откроет **deploy-PR** в `platform-gitops` (бамп всех пяти `image.tag` → `<sha>` в
`values/directport-prod.yaml`). Убедиться, что прогон зелёный и образы появились в GHCR.
**Merge deploy-PR = выкат** (Argo синкает); пока PR не влит — прод остаётся на прежнем sha.

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
- `https://admin-access.directport.ru` — вход `admin@directport.ru` (пароль из сида / смена при первом входе).
- Загрузка тестового `.xlsx` через client-bot → пайплайн доходит до `PROCESSED`, manager-bot получает уведомление.

### 7. Погасить stage

После подтверждения работы прода:

```bash
helm uninstall directport-stage -n directport-stage
kubectl delete namespace directport-stage
```

- снять внешний nginx-прокси `coreimport.ru` (`deploy/coreimport-stage-proxy.conf`) и убедиться, что
  секреты stage в GitHub (`KUBE_CONFIG_STAGE` и т.д.) больше не нужны. Workflow `deploy-stage.yml` уже
  удалён из репозитория (заменён на `build-images.yml`).

---

## Заметки и риски

- **TLS — на внешнем stage-proxy**: ingress directport идёт **без TLS-секции**; Traefik принимает
  re-encrypt от nginx со своим default cert. Origin Cert / cert-manager для directport не используются.
  В кластере Traefik по умолчанию редиректит http→https — nginx должен ходить на websecure-entrypoint
  (https), а не на web (http), иначе получит 301.
- **Bitnami PG/Redis тянутся как `:latest` с docker.io** (поведение чарта, как на stage). На прод-кластере
  возможен docker.io rate-limit — стоит запиннить версии образов PG/Redis (или зеркалировать). Не блокер.
- **`api.directport.ru` не обязателен**: админка ходит на свой origin (`/api`) и проксирует на API внутри
  кластера; внешние клиенты на API напрямую не ходят. Можно убрать host из ingress без потери функциональности.
- **Лендинг** вшивает `NEXT_PUBLIC_TELEGRAM_BOT_URL` (`t.me/direct_port_bot`) и `NEXT_PUBLIC_SITE_URL`
  (`directport.ru`) на этапе сборки. Если прод client-bot имеет другой username — пересобрать landing с build-arg.
- **Боты на polling**: т.к. stage гасится, прод может переиспользовать те же токены без конфликта `getUpdates`.
- **StorageClass**: если в кластере нет дефолтного — задать `postgresql.primary.persistence.storageClass`
  в `values/directport-prod.yaml` (есть закомментированный блок), иначе PVC зависнет в Pending.
