#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/nuanlin}"
REPO_URL="${REPO_URL:-https://github.com/mabaolong111/bisai.git}"
APP_PORT="${NUANLIN_PORT:-8765}"

sudo apt-get update
sudo apt-get install -y git nginx nodejs
sudo mkdir -p "$APP_DIR"
sudo chown -R "$USER":"$USER" "$APP_DIR"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin main
  git -C "$APP_DIR" reset --hard origin/main
else
  git clone --depth 1 --branch main "$REPO_URL" "$APP_DIR"
fi

sudo tee /etc/systemd/system/nuanlin.service >/dev/null <<EOF
[Unit]
Description=Nuanlin elderly service platform
After=network.target

[Service]
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node $APP_DIR/server.js
Environment=NUANLIN_PORT=$APP_PORT
Environment=NUANLIN_BIND_HOST=127.0.0.1
Environment=NUANLIN_PUBLIC_HOST=1.92.114.70
Environment=NUANLIN_SECURE_COOKIES=0
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
EOF

sudo tee /etc/nginx/sites-available/nuanlin >/dev/null <<EOF
server {
    listen 80 default_server;
    server_name 1.92.114.70 _;
    client_max_body_size 10m;
    location / {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header X-Real-IP \$remote_addr;
    }
}
EOF

sudo rm -f /etc/nginx/sites-enabled/default
sudo ln -sf /etc/nginx/sites-available/nuanlin /etc/nginx/sites-enabled/nuanlin
sudo nginx -t
sudo systemctl daemon-reload
sudo systemctl enable --now nuanlin
sudo systemctl restart nginx
curl -fsS "http://127.0.0.1:$APP_PORT/api/health"
echo "Deployed: http://1.92.114.70/yanglao.html"
