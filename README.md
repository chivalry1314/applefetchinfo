# Apple 官翻 Mac 监控工具

监控 [Apple 中国官翻 Mac 页面](https://www.apple.com.cn/shop/refurbished/mac)，当指定的官翻机型（Mac mini / Mac Studio / Mac Pro 等）从「无货」变为「有货」时，自动通过飞书机器人发送提醒。

## 工作原理

```
Apple 官翻页 ──HTTP GET──▶ 内嵌 JSON 产品列表
                               │
                               ▼
                    解析 window.REFURB_GRID_BOOTSTRAP
                    按 refurbClearModel 分组
                               │
                               ▼
                    对比上次状态（本地 state.json）
                               │
                    ┌──────────┴──────────┐
                    ▼                     ▼
              无变化 → 跳过         新激活 → 发飞书通知
```

Apple 官翻页虽是 React SPA，但产品数据以 JSON 形式内嵌在初始 HTML 中，直接 HTTP 请求即可解析，无需浏览器或 Puppeteer。

## 功能特性

- 多机型监控，网页端复选框选择
- 机型上架后支持连续提醒 N 次（`REMINDER_REPEAT_COUNT`）
- 飞书自定义机器人通知，已修复签名验证
- Web 管理面板，通过 `ADMIN_SECRET` 保护
- 状态持久化到本地 `data/state.json`
- Docker + Docker Compose 部署
- 自动 HTTPS：Nginx + Let's Encrypt + Cloudflare
- GitHub Actions 自动构建镜像并部署到 ECS

## 本地测试

```bash
npm install
node index.js --dry-run
```

`--dry-run` 只抓取和解析，不会实际发送通知。

## 生产部署（推荐）

**前后端统一部署在阿里云 ECS**，通过 **Docker + Nginx + Let's Encrypt + Cloudflare** 实现 HTTPS。

完整步骤请见 **[DEPLOY.md](./DEPLOY.md)**。

快速预览：

```bash
ssh root@your-ecs-ip
cd /opt/apple-refurb-monitor
cp .env.example .env
# 编辑 .env：ADMIN_SECRET、FEISHU_WEBHOOK_URL、DOMAIN、LETSENCRYPT_EMAIL

docker compose -f docker-compose.nginx.yml up -d
```

然后访问 `https://your-domain.com` 打开管理面板。

## 自动部署

项目已包含 `.github/workflows/deploy.yml`，push 到 `main` 分支后自动：

1. 构建 Docker 镜像并推送到 `ghcr.io`
2. SSH 到 ECS，拉取最新镜像并重启 Nginx 部署

需要配置的 GitHub Secrets：

| Secret | 说明 |
|---|---|
| `ECS_HOST` | ECS 公网 IP |
| `ECS_USER` | SSH 用户名 |
| `ECS_PRIVATE_KEY` | SSH 私钥 |

## 环境变量说明

| 变量名 | 必填 | 默认值 | 说明 |
|---|---|---|---|
| `ADMIN_SECRET` | ✅ | - | 网页端保存配置时校验的密钥 |
| `FEISHU_WEBHOOK_URL` | ✅ | - | 飞书自定义机器人 Webhook 地址 |
| `FEISHU_SECRET` | - | - | 飞书机器人签名验证密钥（未启用可留空） |
| `DOMAIN` | ✅ | - | 解析到 ECS 的域名，用于 Nginx + Let's Encrypt |
| `LETSENCRYPT_EMAIL` | ✅ | - | Let's Encrypt 证书通知邮箱 |
| `PORT` | - | `3000` | 容器内部端口，Nginx 会反代到该端口 |
| `WATCH_MODELS` | - | `macmini,macstudio,macpro` | 监控机型，逗号分隔 |
| `APPLE_REFURB_URL` | - | `https://www.apple.com.cn/shop/refurbished/mac` | 官翻页面 URL |
| `CHECK_INTERVAL_MS` | - | `300000` | 检查间隔（毫秒），默认 5 分钟 |
| `FETCH_TIMEOUT` | - | `15000` | HTTP 请求超时（毫秒） |
| `REMINDER_REPEAT_COUNT` | - | `1` | 同一机型上架后连续提醒次数 |
| `STATE_BACKEND` | - | `local` | 状态后端，目前固定 `local` |
| `LOCAL_STATE_PATH` | - | `./state.json` | 本地状态文件路径 |
| `FRONTEND_ORIGIN` | - | - | 跨域来源，前后端同域时无需配置 |

> 飞书相关配置只能在服务端 `.env` 中设置，不会暴露在网页端。

## 项目结构

```
apple-refurb-monitor/
├── index.js                    # 监控核心逻辑
├── server.js                   # Web 管理面板 + 定时调度
├── package.json
├── .env.example                # 环境变量示例
├── Dockerfile                  # Docker 镜像
├── docker-compose.yml          # 基础 Docker Compose（无 HTTPS）
├── docker-compose.nginx.yml    # Nginx + Let's Encrypt HTTPS 部署
├── docker-compose.nginx-manual.yml  # 使用已有证书的 Nginx HTTPS 部署
├── docker-compose.existing-nginx.yml # 接入已有 Nginx（Docker）
├── nginx.existing.example.conf  # 已有 Nginx 反代配置示例
├── cloudflare-origin-ca-rsa-root.pem  # Cloudflare Origin CA RSA 根证书
├── DEPLOY.md                   # 完整中文部署文档
├── public/
│   └── index.html              # 网页管理面板
├── src/
│   ├── config.js               # 配置读取（支持热重载）
│   ├── fetcher.js              # 页面抓取 + 产品解析
│   ├── state.js                # 状态持久化
│   └── notify.js               # 飞书通知
├── scripts/                    # 原生 Node 部署脚本（备用）
└── .github/workflows/
    ├── deploy.yml              # GitHub Actions 自动部署到 ghcr.io
    └── build-push-acr.yml      # GitHub Actions 推送到阿里云 ACR
```

## 通知消息示例

```
🍎 Apple 官翻上架: Mac mini

## Apple 官翻 Mac 上架提醒

检测时间: 2026-07-14T12:00:00.000Z

### Mac mini（3 个 SKU，第 1 次提醒 / 共 1 次）

- 翻新 Mac mini Apple M4 芯片
  价格: RMB 3,599
  [查看详情](https://www.apple.com.cn/shop/product/xxxx)

---
[前往 Apple 官翻 Mac 页面](https://www.apple.com.cn/shop/refurbished/mac)
```

## FAQ

**Q: 为什么首次运行不发通知？**  
A: 首次运行没有上次状态可对比，只记录当前状态。从第二次开始，机型从「未激活」变为「已激活」时才会通知。

**Q: 机型下架后再上架会再次通知吗？**  
A: 会。机型变为「未激活」后提醒计数会重置。

**Q: 可以监控 iMac / MacBook Pro 吗？**  
A: 可以。在管理面板勾选对应机型，或在 `.env` 中修改 `WATCH_MODELS`。

**Q: 产品数量为什么有时不一样？**  
A: Apple 官翻库存实时变化，售罄 SKU 会从列表中移除，属正常现象。
