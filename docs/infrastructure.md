# Инфраструктура проекта

## Общая схема

Stage-развёртывание строится вокруг Kubernetes-кластера (MicroK8s) и Helm chart `deploy/helm/directport`.

Основные компоненты:

- `api` — backend (NestJS)
- `admin-web` — админка (Next.js)
- `tg-bot` — Telegram-бот
- `migration` — Job для запуска TypeORM-миграций после релиза
- `postgresql` — in-cluster PostgreSQL (Bitnami chart)
- `redis` — in-cluster Redis (Bitnami chart)

Образы хранятся в `ghcr.io` и тянутся в кластер через `imagePullSecret` `ghcr-pull`.

---

## CI/CD (GitHub Actions)

Файл: `.github/workflows/deploy-stage.yml`.

### 1) Build & Push

Job `build-and-push`:

- собирает 3 образа: `api`, `admin-web`, `tg-bot`
- публикует их в `ghcr.io/${{ github.repository }}-*`
- использует теги:
  - `sha` (long SHA коммита)
  - `stage`

Это важно: в деплой передаётся `image.tag=${{ github.sha }}`, поэтому нужен именно `long SHA` (в workflow это зафиксировано `format=long`).

### 2) Deploy

Job `deploy`:

1. Ставит `kubectl`/`helm`
2. Добавляет Helm-репозиторий Bitnami и собирает зависимости chart
3. Подключается к кластеру через `KUBE_CONFIG_STAGE`
4. Создаёт/обновляет `ghcr-pull` в namespace `directport-stage`
5. Выполняет `helm upgrade --install ... --wait --timeout 5m`

Перед деплоем вычисляется пароль PostgreSQL:

- сначала из текущего секрета кластера `directport-stage-postgresql` (если релиз уже существует)
- иначе из `STAGE_POSTGRES_PASSWORD`
- иначе генерируется случайный пароль (для first install)

Пароль передаётся одновременно в:

- `postgresql.auth.password`
- `global.postgresql.auth.password`

Это требование Bitnami chart для корректных upgrade-сценариев.

---

## Helm chart (`deploy/helm/directport`)

### Зависимости

`Chart.yaml` содержит зависимости:

- `bitnami/postgresql` (`condition: postgresql.enabled`)
- `bitnami/redis` (`condition: redis.enabled`)

### Stage values

`values-stage.yaml`:

- включает `postgresql.enabled: true`
- включает `redis.enabled: true`
- задаёт `global.imagePullSecrets: [{ name: ghcr-pull }]`
- включает `global.security.allowInsecureImages: true` (для совместимости рендера subchart-ов в текущей конфигурации)

### Секреты приложения

Шаблон: `templates/secrets.yaml`.

Создаёт секрет `${release}-secrets` с ключами:

- `DATABASE_URL`
- `REDIS_URL`
- `JWT_SECRET`
- `API_INTERNAL_KEY`
- `TKS_*`
- `ANTHROPIC_API_KEY`
- `TELEGRAM_BOT_TOKEN`

Секрет создаётся как Helm hook:

- `pre-install,pre-upgrade`
- `hook-weight: -10`

Это гарантирует, что он доступен до запуска migration hook.

### Миграции

Шаблон: `templates/migration-job.yaml`.

- Job запускается как `post-install,post-upgrade`
- использует API-образ и команду:

```bash
node apps/api/node_modules/typeorm/cli.js migration:run -d apps/api/dist/src/database/data-source.js
```

- читает env из `${release}-secrets`
- использует `global.imagePullSecrets` (для pull приватных образов)

Почему `post-*`: при `pre-upgrade` возможна ситуация, когда in-cluster PostgreSQL ещё недоступен для hook-job.

---

## Сетевые и DNS-имена внутри кластера

Внутренние хосты, которые ожидает chart:

- PostgreSQL: `${release}-postgresql` (например, `directport-stage-postgresql`)
- Redis (Bitnami): `${release}-redis-master` (например, `directport-stage-redis-master`)

Формирование URL выполнено в `templates/_helpers.tpl`:

- `directport.databaseUrl`
- `directport.redisUrl`

Если заданы `secrets.databaseUrl`/`secrets.redisUrl`, они имеют приоритет над in-cluster адресами.

---

## Proxy-server: откуда и куда проксируется трафик

Файл конфигурации: `deploy/coreimport-stage-proxy.conf`.

Текущие правила проксирования:

- Вход: `http://coreimport.ru/*`
  - Proxy target: `https://coreimport-landing.lab42-stg.work/*`
  - `Host` принудительно выставляется в `coreimport-landing.lab42-stg.work`
- Вход: `http://admin-access.coreimport.ru/*`
  - Proxy target: `https://coreimport-admin.lab42-stg.work/*`
  - `Host` принудительно выставляется в `coreimport-admin.lab42-stg.work`

Дополнительно API-сервис использует внешний TKS endpoint:

- Исходящие запросы из `api` проксируются на `https://api1.tks.ru`
- Базовый URL задаётся через `TKS_API_BASE_URL` (по умолчанию — `https://api1.tks.ru`)

Пробрасываемые заголовки в обоих `server`-блоках:

- `X-Real-IP: $remote_addr`
- `X-Forwarded-For: $proxy_add_x_forwarded_for`
- `X-Forwarded-Proto: $scheme`

Примечания:

- В этом конфиге proxy-server слушает `listen 80` (HTTP).
- Апстримы указаны как `https://...`, то есть proxy-server ходит к origin по TLS.

---

## Обязательные GitHub Secrets (stage)

Минимальный набор:

- `KUBE_CONFIG_STAGE`
- `GHCR_USERNAME`
- `GHCR_PULL_TOKEN` (PAT с `read:packages`)
- `JWT_SECRET`
- `API_INTERNAL_KEY`
- `TKS_API_BASE_URL`
- `TKS_TNVED_API_KEY`
- `TKS_GOODS_API_KEY`
- `ANTHROPIC_API_KEY`
- `TELEGRAM_BOT_TOKEN`

Опционально/рекомендуется:

- `STAGE_POSTGRES_PASSWORD` (детерминированный пароль для first install)

---

## Частые проблемы и диагностика

### `ImagePullBackOff`

Проверить:

1. Есть ли `ghcr-pull` в namespace
2. Есть ли `imagePullSecrets` у pod/job
3. Существует ли тег образа в GHCR

Типовая команда:

```bash
kubectl -n directport-stage describe pod <pod-name>
```

### `not found` при pull образа

Обычно означает mismatch тега: в registry нет тега, который передаётся в Helm.

В текущей конфигурации это закрыто `type=sha,...,format=long` + `image.tag=${{ github.sha }}`.

### `PASSWORDS ERROR` от Bitnami PostgreSQL

Причина: при upgrade не передан текущий пароль.

В workflow уже заложен приоритет:

1. пароль из существующего k8s-секрета
2. `STAGE_POSTGRES_PASSWORD`
3. генерация пароля для первой установки

### `ENOTFOUND directport-stage-postgresql`

Если возникает на миграциях — проверить, что migration hook запускается как `post-install,post-upgrade`.

---

## Полезные команды эксплуатации

```bash
# Ресурсы namespace
kubectl -n directport-stage get pods,svc,jobs,secrets

# Логи migration job
kubectl -n directport-stage logs job/directport-stage-migration-<revision>

# События проблемного pod
kubectl -n directport-stage describe pod <pod-name>

# Проверка секрета приложения
kubectl -n directport-stage get secret directport-stage-secrets -o yaml
```
