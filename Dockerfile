# Apple 官翻 Mac 监控工具 —— Docker 镜像
# 运行时通过挂载 .env 传入配置，不将密钥打包进镜像

FROM node:18-alpine

WORKDIR /app

# 先复制依赖文件并安装，利用 Docker 缓存层
COPY package*.json ./
RUN npm install --production

# 复制应用代码
COPY . .

# 暴露 Web 管理面板端口（实际端口由 .env 中的 PORT 决定）
EXPOSE 3000

CMD ["node", "server.js"]
