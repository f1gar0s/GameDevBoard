#!/usr/bin/env bash
# Установка GameDev Board на свой сервер (Ubuntu 22.04 / 24.04).
# Ставит: nginx (сайт + HTTPS), Mosquitto (синхронизация досок), сертификат Let's Encrypt.
#
# Запуск (под root):
#   bash setup.sh <адрес-репозитория> [домен] [email]
# Пример:
#   bash setup.sh https://github.com/f1gar0s/GameDevBoard.git board.example.ru me@mail.ru
# Если домена нет — не указывайте его: будет использован бесплатный адрес вида 1-2-3-4.sslip.io
set -euo pipefail

REPO="${1:-https://github.com/f1gar0s/GameDevBoard.git}"
DOMAIN="${2:-}"
EMAIL="${3:-}"
WEB=/var/www/gdboard
DATA=/var/lib/gdboard

say() { printf '\n\033[1;35m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[1;31m[!] %s\033[0m\n' "$*"; exit 1; }

[ "$(id -u)" = 0 ] || die "Запустите от root (или через sudo)."
[ -n "$REPO" ] || die "Укажите адрес репозитория: bash setup.sh https://github.com/f1gar0s/GameDevBoard.git [домен] [email]"

IP="$(curl -4 -fsS --max-time 10 https://ifconfig.me 2>/dev/null || curl -4 -fsS --max-time 10 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
if [ -z "$DOMAIN" ]; then DOMAIN="$(echo "$IP" | tr . -).sslip.io"; fi

say "Сервер: $IP, адрес доски: https://$DOMAIN"

say "1/6 Устанавливаю пакеты"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q nginx mosquitto certbot python3-certbot-nginx git curl ca-certificates

say "2/6 Скачиваю приложение"
if [ -d "$WEB/.git" ]; then
  git -C "$WEB" pull --ff-only
else
  rm -rf "$WEB"
  git clone --depth 1 "$REPO" "$WEB" || die "Не удалось скачать $REPO. Репозиторий публичный? Адрес верный?"
fi
mkdir -p "$DATA/fonts"

say "3/6 Скачиваю шрифты на сервер (чтобы не зависеть от Google)"
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
CSS_URL="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;600&family=Press+Start+2P&display=swap"
if curl -fsSL --max-time 30 -A "$UA" "$CSS_URL" -o "$DATA/fonts/google.css"; then
  cp "$DATA/fonts/google.css" "$DATA/fonts/fonts.css"
  for u in $(grep -o 'https://fonts.gstatic.com/[^)]*' "$DATA/fonts/google.css" | sort -u); do
    f="$(echo "$u" | md5sum | cut -c1-16).woff2"
    curl -fsSL --max-time 30 "$u" -o "$DATA/fonts/$f" && sed -i "s#$u#/fonts/$f#g" "$DATA/fonts/fonts.css"
  done
  rm -f "$DATA/fonts/google.css"
  echo "Шрифты сохранены."
else
  echo "/* шрифты не скачались — будут системные */" > "$DATA/fonts/fonts.css"
  echo "Шрифты скачать не удалось — будут системные. Это не страшно."
fi

say "4/6 Настраиваю Mosquitto (сервер синхронизации)"
[ -f /etc/mosquitto/mosquitto.conf.orig ] || cp /etc/mosquitto/mosquitto.conf /etc/mosquitto/mosquitto.conf.orig
cat > /etc/mosquitto/mosquitto.conf <<'CONF'
# GameDev Board: синхронизация досок. Доступен только изнутри сервера, наружу его отдаёт nginx по /mqtt.
pid_file /run/mosquitto/mosquitto.pid
persistence true
persistence_location /var/lib/mosquitto/
autosave_interval 30
log_dest file /var/log/mosquitto/mosquitto.log
log_type error
log_type warning
listener 9001 127.0.0.1
protocol websockets
allow_anonymous true
max_keepalive 120
CONF
systemctl enable mosquitto >/dev/null 2>&1 || true
systemctl restart mosquitto
sleep 1
systemctl is-active --quiet mosquitto || { journalctl -u mosquitto -n 30 --no-pager; die "Mosquitto не запустился (лог выше)."; }

say "5/6 Настраиваю nginx"
cat > /etc/nginx/sites-available/gdboard <<CONF
server {
  listen 80;
  listen [::]:80;
  server_name $DOMAIN;
  root $WEB;
  index index.html;
  charset utf-8;

  # служебные файлы репозитория не отдаём
  location ~ /\.(git|github) { deny all; }
  location /server/ { deny all; }

  # адрес синхронизации для приложения
  location = /server.json {
    default_type application/json;
    add_header Cache-Control "no-store";
    return 200 '{"mqtt":"/mqtt","name":"$DOMAIN"}';
  }
  # WebSocket → Mosquitto
  location /mqtt {
    proxy_pass http://127.0.0.1:9001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade \$http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host \$host;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_buffering off;
  }
  # локальные шрифты
  location /fonts/ {
    alias $DATA/fonts/;
    add_header Cache-Control "public, max-age=2592000";
  }
  # приложение: браузер каждый раз проверяет, не обновились ли файлы
  location / {
    try_files \$uri \$uri/ /index.html;
    add_header Cache-Control "no-cache";
  }

  gzip on;
  gzip_types text/css application/javascript application/json image/svg+xml;
}
CONF
ln -sf /etc/nginx/sites-available/gdboard /etc/nginx/sites-enabled/gdboard
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable nginx >/dev/null 2>&1 || true
systemctl reload nginx || systemctl restart nginx

say "6/6 Получаю сертификат HTTPS"
if [ -n "$EMAIL" ]; then EM=(-m "$EMAIL"); else EM=(--register-unsafely-without-email); fi
if certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos "${EM[@]}" --redirect; then
  HTTPS_OK=1
else
  HTTPS_OK=0
fi

# команда обновления: gdboard-update
cat > /usr/local/bin/gdboard-update <<CONF
#!/usr/bin/env bash
set -e
git -C $WEB pull --ff-only
echo "Готово: приложение обновлено. Участникам достаточно обновить страницу."
CONF
chmod +x /usr/local/bin/gdboard-update

# ежедневная резервная копия досок (хранится 14 дней)
cat > /etc/cron.daily/gdboard-backup <<'CONF'
#!/bin/sh
mkdir -p /var/backups/gdboard
cp /var/lib/mosquitto/mosquitto.db "/var/backups/gdboard/mosquitto-$(date +%F).db" 2>/dev/null || true
find /var/backups/gdboard -name 'mosquitto-*.db' -mtime +14 -delete
CONF
chmod +x /etc/cron.daily/gdboard-backup

# брандмауэр: если включён — открываем веб-порты
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then ufw allow 80/tcp; ufw allow 443/tcp; fi

echo
if [ "$HTTPS_OK" = 1 ]; then
  printf '\033[1;32m✔ Готово! Откройте: https://%s\033[0m\n' "$DOMAIN"
else
  printf '\033[1;33m! Сайт работает, но HTTPS получить не удалось.\033[0m\n'
  echo "  Проверьте, что домен $DOMAIN указывает на IP $IP (A-запись), и запустите:"
  echo "  certbot --nginx -d $DOMAIN --redirect"
  echo "  Без HTTPS совместный доступ работать не будет."
fi
echo "Обновить приложение после git push:  gdboard-update"
