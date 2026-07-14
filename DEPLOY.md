# Apple 官翻 Mac 监控工具 —— 部署文档

本文档介绍如何将本项目完整部署到 **阿里云 ECS**，并通过 **Nginx + Let's Encrypt + Cloudflare** 实现 HTTPS。

> 如果你还没购买域名或 ECS，可以先看完文档再准备资源。

---

## 架构说明

```text
用户浏览器
    ↓ HTTPS（Cloudflare 证书）
Cloudflare 代理
    ↓ HTTPS（Let's Encrypt 证书）
阿里云 ECS
    ├─ Nginx（监听 80/443，反向代理到 monitor）
    ├─ acme-companion（自动申请/续期证书）
    └─ apple-refurb-monitor（Node.js 服务，监听 3000）
```

---

## 准备工作

### 1. 域名

- 准备一个域名，例如 `your-domain.com`
- 建议将域名 DNS 改到 **Cloudflare** 管理（免费）

### 2. 阿里云 ECS

- 系统：Ubuntu / Debian / CentOS 均可
- 已安装 **Docker** 和 **Docker Compose**（安装方法见下文）
- 安全组放行 **80** 和 **443** 端口
- 可选：放行 **22** 端口用于 SSH

### 安装 Docker 和 Docker Compose

#### Ubuntu / Debian

```bash
# 更新软件源
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg lsb-release

# 添加 Docker 官方 GPG 密钥
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

# 添加 Docker 软件源（以 Ubuntu 为例）
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# 安装 Docker
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 启动并设置开机自启
sudo systemctl start docker
sudo systemctl enable docker

# 把当前用户加入 docker 组，免去每次 sudo（重新登录后生效）
sudo usermod -aG docker $USER
```

#### CentOS / Alibaba Cloud Linux

```bash
# 安装依赖
sudo yum install -y yum-utils device-mapper-persistent-data lvm2

# 添加 Docker 源
sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo

# 安装 Docker
sudo yum install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 启动并设置开机自启
sudo systemctl start docker
sudo systemctl enable docker

# 把当前用户加入 docker 组
sudo usermod -aG docker $USER
```

#### 配置镜像加速器（推荐国内 ECS）

```bash
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json <<-'EOF'
{
  "registry-mirrors": [
    "https://<你的加速器地址>.mirror.aliyuncs.com",
    "https://docker.m.daocloud.io"
  ]
}
EOF
sudo systemctl daemon-reload
sudo systemctl restart docker
```

> 阿里云镜像加速器地址获取：阿里云控制台 → 容器镜像服务 ACR → 镜像工具 → 镜像加速器。

#### 验证安装

```bash
docker --version
docker compose version
```

### 3. 飞书机器人

- 在飞书群里添加一个「自定义机器人」
- 复制机器人的 **Webhook 地址**
- 如果开启了「签名验证」，复制 **密钥**；未开启则留空

---

## 部署步骤

### 第一步：域名解析到 ECS

登录 Cloudflare，添加一条 A 记录：

| 类型 | 名称 | 内容 | 代理状态 |
|---|---|---|---|
| A | `@` 或 `monitor` | ECS 公网 IP | 已代理（橙色小云） |

> 如果直接用根域名，名称填 `@`；如果用子域名如 `monitor.your-domain.com`，名称填 `monitor`。

---

### 第二步：登录 ECS 并下载代码

```bash
ssh root@your-ecs-ip

cd /opt
git clone https://github.com/your-name/apple-refurb-monitor.git
cd apple-refurb-monitor
```

---

### 第三步：配置环境变量

```bash
cp .env.example .env
vi .env
```

至少填写以下配置：

```env
# 管理员密钥，网页端保存配置时必须输入
ADMIN_SECRET=your-strong-secret

# 飞书机器人配置（仅能通过 .env 设置）
FEISHU_WEBHOOK_URL=https://open.feishu.cn/open-apis/bot/v2/hook/xxxxxx
FEISHU_SECRET=你的飞书密钥（未启用签名验证可留空）

# HTTPS 域名和证书邮箱
DOMAIN=your-domain.com
LETSENCRYPT_EMAIL=your-email@example.com

# 服务端口，保持 3000 即可
PORT=3000
```

> `ADMIN_SECRET` 和飞书配置属于敏感信息，不会出现在网页端。

---

### 第四步：启动服务

```bash
docker compose -f docker-compose.nginx.yml up -d
```

首次启动会拉取三个镜像：

- `apple-refurb-monitor:latest`（监控服务）
- `nginxproxy/nginx-proxy`（Nginx 反向代理）
- `nginxproxy/acme-companion`（Let's Encrypt 证书自动管理）

---

### 第五步：查看启动状态

```bash
# 查看所有容器状态
docker compose -f docker-compose.nginx.yml ps

# 查看证书申请日志
docker compose -f docker-compose.nginx.yml logs -f acme-companion

# 查看监控服务日志
docker compose -f docker-compose.nginx.yml logs -f monitor
```

首次申请证书通常需要 **1-2 分钟**。当看到类似 `Certificate received` 的日志时，说明 HTTPS 已经可用。

---

### 第六步：访问管理面板

打开浏览器访问：

```text
https://your-domain.com
```

输入 `ADMIN_SECRET` 后即可在网页端配置监控机型、检查间隔等。

---

## Cloudflare SSL/TLS 设置

在 Cloudflare 控制台 → SSL/TLS：

- **Overview** 页面：选择 **Full (strict)**（推荐）
- 如果证书还没申请下来，可以临时选 **Full**，等 Let's Encrypt 证书生效后再改回 **Full (strict)**

> 不建议长期使用 **Flexible**，因为 Cloudflare 到 ECS 这一段是 HTTP，不够安全。

---

## 不使用 Cloudflare / 使用已有证书

### 可以不走 Cloudflare 吗？

可以。Cloudflare 不是必须的，你完全可以把域名 DNS 放在阿里云解析，直接 A 记录指向 ECS IP。

但国内服务器有一个现实问题：**网站域名需要 ICP 备案**。如果域名没有备案，阿里云可能会封禁 ECS 的 80 和 443 端口访问。Cloudflare 代理可以在一定程度上缓解这个问题，但不是 100% 保险。

> 如果你只是个人小工具、不想备案，可以考虑用非标准端口（如 `8443`）暴露 HTTPS，或在境外 ECS 部署。

### 为什么需要 acme-companion？

`acme-companion` 的作用是**自动向 Let's Encrypt 申请和续期证书**。如果你：

- 不想用 Let's Encrypt
- 已经有证书（如从阿里云 SSL、腾讯云 SSL、Certbot 等处申请）
- 使用 Cloudflare Origin CA 证书

那就可以不用 `acme-companion`。

### 使用 Cloudflare Origin CA 证书（推荐搭配 Cloudflare 代理）

如果你使用 Cloudflare 代理，最省事的方式是给 ECS 源站配置 **Cloudflare Origin CA 证书**。这个证书：

- 在 Cloudflare 控制台免费生成
- 有效期 **15 年**
- 只被 Cloudflare 信任，适合「Cloudflare ↔ 源站」这一段加密

生成步骤：

1. Cloudflare 控制台 → SSL/TLS → Origin Server → Create Certificate
2. 选择 **RSA**，包含你的域名（如 `your-domain.com` 和 `*.your-domain.com`）
3. 下载生成的 **Origin Certificate**（保存为 `origin-cert.pem`）和 **Private Key**（保存为 `origin-key.pem`）
4. 项目根目录已提供 Cloudflare Origin CA RSA 根证书 `cloudflare-origin-ca-rsa-root.pem`

然后合并证书链：

```bash
mkdir -p certs

# 把 Origin Certificate 放在前面，Root CA 放在后面，组成 fullchain
cat origin-cert.pem cloudflare-origin-ca-rsa-root.pem > certs/fullchain.pem
cp origin-key.pem certs/privkey.pem
```

> 注意：Origin Certificate 和 Private Key 必须是从 Cloudflare 同一次生成中下载的，不能混用不同证书的 key。

启动：

```bash
docker compose -f docker-compose.nginx-manual.yml up -d
```

对应的 Nginx 配置文件是 `nginx.manual.conf`，会自动把 HTTP 跳转到 HTTPS，并反向代理到 monitor 服务。

### 使用其他已有证书

如果你用的是阿里云 SSL、腾讯云 SSL、Certbot 等申请的公开证书，也可以直接用：

```bash
mkdir -p certs
cp /path/to/fullchain.pem certs/fullchain.pem
cp /path/to/privkey.pem certs/privkey.pem

docker compose -f docker-compose.nginx-manual.yml up -d
```

### 证书续期

- **Cloudflare Origin CA**：15 年有效期，基本不用续期
- **阿里云/腾讯云免费证书**：一年有效期，到期前重新下载替换
- **Certbot/Let's Encrypt**：通常 90 天，需要配置自动续期脚本

---

## 部署到已有 Nginx（Docker）的服务器

如果你的服务器上已经跑了一个 Nginx 容器，不想再用一套 Nginx，可以把 monitor 容器接入现有 Nginx 的网络，让现有 Nginx 反代。

### 1. 找到现有 Nginx 所在的 Docker 网络

```bash
docker network ls
```

记下网络名，例如 `share_default`。

### 2. 用 `docker-compose.existing-nginx.yml` 启动 monitor

```bash
cd /opt/applefetchinfo
cp .env.example .env
# 编辑 .env，建议 PORT=3001，避免和现有程序冲突

export EXTERNAL_NETWORK=share_default
docker compose -f docker-compose.existing-nginx.yml up -d
```

### 3. 在现有 Nginx 配置中新增子域名

参考项目里的 `nginx.existing.example.conf`，在现有 Nginx 配置里加一个 `server` 块：

```nginx
server {
    listen 80;
    server_name apple.example.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name apple.example.com;

    ssl_certificate /etc/nginx/ssl/apple.example.com/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/apple.example.com/privkey.pem;

    location / {
        proxy_pass http://apple-refurb-monitor:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Forwarded-Host $host;
        proxy_connect_timeout 60s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
    }
}
```

> `apple-refurb-monitor` 是容器名，`3001` 是 monitor 内部端口。

### 4. 重载 Nginx

```bash
docker exec <你的nginx容器名> nginx -t
docker exec <你的nginx容器名> nginx -s reload
```

### 5. DNS 解析

把 `apple.example.com` 指向这台服务器 IP，然后访问 `https://apple.example.com`。

---

## 国内 ECS 注意事项

如果你使用的是**国内（中国大陆）阿里云 ECS**，以下几点需要额外注意：

### Docker 镜像拉取

`nginxproxy/nginx-proxy` 和 `nginxproxy/acme-companion` 来自 Docker Hub，国内访问可能较慢或失败。建议配置 Docker 镜像加速器：

```bash
sudo mkdir -p /etc/docker
sudo tee /etc/docker/daemon.json <<-'EOF'
{
  "registry-mirrors": [
    "https://<你的加速器地址>.mirror.aliyuncs.com",
    "https://docker.m.daocloud.io"
  ]
}
EOF
sudo systemctl daemon-reload
sudo systemctl restart docker
```

> 阿里云镜像加速器地址可在「容器镜像服务 ACR → 镜像工具 → 镜像加速器」中获取。

### GitHub Container Registry 访问

国内 ECS 拉取 `ghcr.io` 镜像可能不稳定。解决方案：

1. **ECS 本地构建**：放弃 GitHub Actions 拉镜像，直接在 ECS 上构建：
   ```bash
   cd /opt/apple-refurb-monitor
   git pull
   docker build -t apple-refurb-monitor:latest .
   docker compose -f docker-compose.nginx.yml up -d
   ```

2. **使用阿里云 ACR 个人版**：ACR 个人版目前**限额免费**（上传/拉取镜像均免费），只对个人实名认证账号开放，且一个账号只能创建一个。可以把工作流里的 `ghcr.io` 改成 ACR 地址：
   ```yaml
   env:
     IMAGE_NAME: registry.cn-hangzhou.aliyuncs.com/your-namespace/apple-refurb-monitor:latest
   ```
   然后在 ECS 上配置 ACR 登录凭据。

### Apple 官翻页面

默认监控 `https://www.apple.com.cn/shop/refurbished/mac`，国内 ECS 访问该中国页面通常没有问题，速度往往比海外 ECS 更快。

### Cloudflare + Let's Encrypt

国内 ECS 配合 Cloudflare 代理完全可行。如果证书申请失败，可以临时在 Cloudflare 中关闭代理云，等 Let's Encrypt 证书签发完成后再重新开启。

---

## GitHub Actions 自动部署

项目已包含 `.github/workflows/deploy.yml`，每次 push 到 `main` 分支会自动：

1. 构建 Docker 镜像
2. 推送到 GitHub Container Registry（`ghcr.io`）
3. SSH 到 ECS，拉取最新镜像并重启 Nginx 部署

### 需要配置的 GitHub Secrets

| Secret | 说明 |
|---|---|
| `ECS_HOST` | ECS 公网 IP |
| `ECS_USER` | SSH 用户名，如 `root` |
| `ECS_PRIVATE_KEY` | SSH 私钥 |

> 镜像推送到 `ghcr.io`，不需要阿里云 ACR 账号。如果你的仓库是公开的，ECS 拉镜像不需要登录；如果是私有的，工作流会自动用 `GITHUB_TOKEN` 登录。
>
> 如果你是国内 ECS，从 `ghcr.io` 拉取可能不稳定，可以使用下面「推送到阿里云 ACR」的方案。

### 推送到阿里云 ACR（推荐国内 ECS）

项目额外提供了 `.github/workflows/build-push-acr.yml`，只负责**构建镜像并推送到阿里云 ACR**。镜像推送到 ACR 后，你自己在 ECS 上手动拉取并重启容器即可，不需要把 ECS 的 SSH 密钥交给 GitHub。

需要配置的 Secrets：

| Secret | 说明 | 示例 |
|---|---|---|
| `ACR_REGISTRY` | ACR 镜像仓库域名 | `registry.cn-hangzhou.aliyuncs.com` |
| `ACR_NAMESPACE` | ACR 命名空间 | `your-namespace` |
| `ACR_USERNAME` | ACR 登录用户名 | 阿里云账号或 ACR 控制台显示的用户名 |
| `ACR_PASSWORD` | ACR 登录密码 | ACR 控制台设置的固定密码 |

> ACR 个人版目前限额免费，但一个阿里云账号只能创建一个个人版实例。推送前确保已在 ACR 控制台创建对应命名空间。

#### 在 ECS 上手动拉取并部署

每次 GitHub Actions 推送新镜像后，在 ECS 上执行：

```bash
cd /opt/apple-refurb-monitor

# 更新 docker-compose 等文件
git pull

# 登录阿里云 ACR（只需登录一次，token 会缓存）
docker login registry.cn-hangzhou.aliyuncs.com -u your-username

# 拉取最新镜像并重启
export IMAGE_NAME=registry.cn-hangzhou.aliyuncs.com/your-namespace/applefetchinfo:latest
docker compose -f docker-compose.nginx.yml pull
docker compose -f docker-compose.nginx.yml up -d

# 清理旧镜像
docker image prune -f
```

### 常见错误

#### `Error: missing server host`

这个错误表示 `ECS_HOST` 没有设置或为空。请检查：

1. 仓库 Settings → Secrets and variables → Actions → Secrets
2. 确认已添加名为 `ECS_HOST` 的 secret
3. 确认 `ECS_HOST` 的值是你的 ECS 公网 IP 或域名
4. 注意 secret 名称区分大小写，必须是 `ECS_HOST`，不能是 `ECS_HOSTS` 或 `HOST`

同样地，如果 `ECS_USER` 或 `ECS_PRIVATE_KEY` 为空，后续也会报类似认证错误。

### 自动部署后 ECS 上保留的文件

`/opt/apple-refurb-monitor` 目录下需要保留：

- `.env`（密钥和域名配置）
- `docker-compose.nginx.yml`
- `certs/`、`vhost.d/`、`html/`、`acme/`（证书相关，自动创建）
- `data/`、`logs/`（运行后自动创建）

每次部署时，GitHub Actions 会：

```bash
git fetch origin main
git reset --hard origin/main
docker compose -f docker-compose.nginx.yml pull
docker compose -f docker-compose.nginx.yml up -d
```

---

## 常用维护命令

```bash
# 查看所有容器
docker compose -f docker-compose.nginx.yml ps

# 查看实时日志
docker compose -f docker-compose.nginx.yml logs -f

# 只查看监控服务日志
docker compose -f docker-compose.nginx.yml logs -f monitor

# 重启服务
docker compose -f docker-compose.nginx.yml restart

# 停止服务
docker compose -f docker-compose.nginx.yml down

# 清理旧镜像
docker image prune -f
```

---

## 故障排查

### 1. 访问域名显示 502 Bad Gateway

- 检查 `monitor` 容器是否正常运行：`docker compose -f docker-compose.nginx.yml logs monitor`
- 检查 `.env` 中的 `DOMAIN` 是否和 Cloudflare 里的一致

### 2. 证书申请失败

- 确认域名已正确解析到 ECS IP
- 确认 Cloudflare 代理状态为「已代理」或临时关闭代理让 Let's Encrypt 验证（验证完成后再打开）
- 查看 acme-companion 日志：`docker compose -f docker-compose.nginx.yml logs -f acme-companion`

### 3. 网页端提示「部署密钥错误」

- 检查输入的 `ADMIN_SECRET` 是否和 `.env` 中一致
- 修改 `.env` 后需要重启容器：`docker compose -f docker-compose.nginx.yml restart`

### 4. 飞书收不到通知

- 检查 `.env` 中 `FEISHU_WEBHOOK_URL` 是否正确
- 检查飞书机器人是否启用了签名验证，如果启用必须填写 `FEISHU_SECRET`
- 查看监控日志是否有发送失败的错误

### 5. 防火墙/安全组问题

- ECS 安全组必须放行 **80** 和 **443**
- 如果不用 Cloudflare，还需要放行你使用的端口；使用 Cloudflare 代理后只需要 80/443

---

## 升级/更新

### 手动更新

```bash
cd /opt/apple-refurb-monitor
git pull
docker compose -f docker-compose.nginx.yml pull
docker compose -f docker-compose.nginx.yml up -d
```

### 自动更新

配置好 GitHub Actions 后，只需把代码 push 到 `main` 分支，会自动部署。

---

## 安全建议

1. **ADMIN_SECRET** 设置强密码，不要泄露
2. 飞书 **Webhook 地址** 和 **密钥** 只保存在服务器 `.env` 中
3. 使用 **Cloudflare Full (strict)** 确保端到端 HTTPS
4. 定期更新系统补丁和 Docker 镜像

---

## 参考

- [Cloudflare DNS 设置](https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-dns-records/)
- [nginx-proxy 文档](https://github.com/nginx-proxy/nginx-proxy)
- [acme-companion 文档](https://github.com/nginx-proxy/acme-companion)
