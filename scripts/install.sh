#!/bin/bash
set -e

# Apple 官翻 Mac 监控 —— 阿里云 ECS 一键安装脚本
# 用法：
#   sudo bash scripts/install.sh [ADMIN_SECRET]
#
# 示例：
#   sudo bash scripts/install.sh MyStrongSecret123

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

echo "[install] 项目目录: $PROJECT_DIR"

# 1. 初始化 .env
if [ ! -f .env ]; then
  cp .env.example .env
  if [ -n "$1" ]; then
    sed -i "s|^ADMIN_SECRET=.*|ADMIN_SECRET=$1|" .env
    echo "[install] 已使用传入的密钥初始化 .env"
  else
    echo "[install] 已创建 .env，请先编辑配置后再运行本脚本。"
    echo "[install] 编辑命令: vi $PROJECT_DIR/.env"
    exit 0
  fi
fi

# 2. 安装依赖
echo "[install] 安装 npm 依赖..."
npm install

# 3. 创建日志目录
mkdir -p logs

# 4. 检查 node 路径
NODE_BIN="$(command -v node)"
if [ -z "$NODE_BIN" ]; then
  echo "[install] 错误：未找到 node 命令，请先安装 Node.js 18+"
  exit 1
fi

# 5. 安装 systemd 服务（如果可用）
if command -v systemctl >/dev/null 2>&1; then
  SERVICE_FILE="/etc/systemd/system/apple-refurb-monitor.service"

  cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Apple Refurb Mac Monitor
After=network.target

[Service]
Type=simple
WorkingDirectory=$PROJECT_DIR
ExecStart=$NODE_BIN $PROJECT_DIR/server.js
Restart=always
RestartSec=10
StandardOutput=append:$PROJECT_DIR/logs/server.log
StandardError=append:$PROJECT_DIR/logs/server.log

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable apple-refurb-monitor.service
  systemctl restart apple-refurb-monitor.service

  echo "[install] systemd 服务已安装并启动"
  echo "[install] 查看状态: systemctl status apple-refurb-monitor"
  echo "[install] 查看日志: tail -f $PROJECT_DIR/logs/server.log"
else
  echo "[install] 未检测到 systemd，请手动运行："
  echo "    cd $PROJECT_DIR && $NODE_BIN server.js"
fi

echo "[install] 安装完成"
echo "[install] 访问管理面板: http://<ECS-IP>:3000"
