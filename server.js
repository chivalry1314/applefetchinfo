/**
 * Apple 官翻 Mac 监控 —— Web 管理面板 + 定时调度服务
 *
 * 部署时只需配置 ADMIN_SECRET，其余所有配置都通过网页端完成。
 */

const http = require('http');
const fs = require('fs').promises;
const path = require('path');
const { run } = require('./index');
const config = require('./src/config');

const PUBLIC_DIR = path.join(__dirname, 'public');
const ENV_PATH = path.join(__dirname, '.env');
const FRONTEND_ORIGIN = config.frontendOrigin || '';

// 最近一次检查的状态（内存缓存，供 /api/state 使用）
let lastState = null;
let isRunning = false;

/**
 * 设置 CORS 响应头（仅当前端独立部署时生效）
 */
function setCorsHeaders(res, reqOrigin) {
  if (!FRONTEND_ORIGIN || reqOrigin !== FRONTEND_ORIGIN) return;
  res.setHeader('Access-Control-Allow-Origin', FRONTEND_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Secret');
}

/**
 * 把当前配置展平为前端需要的键值对（不暴露 ADMIN_SECRET）
 */
function getPublicConfig() {
  return {
    WATCH_MODELS: config.watchModels.join(','),
    APPLE_REFURB_URL: config.url,
    FETCH_TIMEOUT: String(config.fetchTimeout),
    CHECK_INTERVAL_MS: String(config.checkIntervalMs),
    REMINDER_REPEAT_COUNT: String(config.reminderRepeatCount),
    STATE_BACKEND: config.stateBackend,
    LOCAL_STATE_PATH: config.localStatePath,
    availableModels: config.modelNames,
    COS_SECRET_ID: config.cos.secretId,
    COS_SECRET_KEY: config.cos.secretKey,
    COS_BUCKET: config.cos.bucket,
    COS_REGION: config.cos.region,
    COS_STATE_KEY: config.cos.key,
  };
}

/**
 * 将前端提交的配置写入 .env 文件
 */
async function writeEnv(data) {
  const lines = [
    '# Apple 官翻 Mac 监控工具 —— 由网页端生成',
    '',
    `# 部署密钥（仅能通过环境变量 / .env 修改，网页端不可见）`,
    `ADMIN_SECRET=${config.adminSecret}`,
    `PORT=${config.port}`,
    '',
    '# 通知通道',
    'NOTIFY_CHANNEL=feishu',
    '',
    '# 监控设置',
    `WATCH_MODELS=${data.WATCH_MODELS || 'macmini,macstudio,macpro'}`,
    `APPLE_REFURB_URL=${data.APPLE_REFURB_URL || 'https://www.apple.com.cn/shop/refurbished/mac'}`,
    `FETCH_TIMEOUT=${data.FETCH_TIMEOUT || '15000'}`,
    `CHECK_INTERVAL_MS=${data.CHECK_INTERVAL_MS || '300000'}`,
    '',
    '# 提醒策略',
    `REMINDER_REPEAT_COUNT=${data.REMINDER_REPEAT_COUNT || '1'}`,
    '',
    '# 飞书通知（仅能通过 .env 设置，网页端不可见）',
    `FEISHU_WEBHOOK_URL=${config.feishuWebhookUrl || ''}`,
    `FEISHU_SECRET=${config.feishuSecret || ''}`,
    '',
    '# 状态持久化',
    `STATE_BACKEND=${data.STATE_BACKEND || 'local'}`,
    `LOCAL_STATE_PATH=${data.LOCAL_STATE_PATH || './state.json'}`,
    '',
    '# 腾讯云 COS 配置（仅 STATE_BACKEND=cos 时生效）',
    `COS_SECRET_ID=${data.COS_SECRET_ID || ''}`,
    `COS_SECRET_KEY=${data.COS_SECRET_KEY || ''}`,
    `COS_BUCKET=${data.COS_BUCKET || ''}`,
    `COS_REGION=${data.COS_REGION || ''}`,
    `COS_STATE_KEY=${data.COS_STATE_KEY || 'apple-refurb-monitor/state.json'}`,
  ];
  await fs.writeFile(ENV_PATH, lines.join('\n') + '\n', 'utf8');
}

/**
 * 校验管理员密钥
 */
function checkAdminSecret(req) {
  const provided = req.headers['x-admin-secret'] || '';
  if (!config.adminSecret) {
    return { ok: false, message: '服务端未配置 ADMIN_SECRET，请先停止服务并在 .env 中设置' };
  }
  if (provided !== config.adminSecret) {
    return { ok: false, message: '部署密钥错误' };
  }
  return { ok: true };
}

/**
 * 解析 POST JSON body
 */
function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

/**
 * 发送 JSON 响应
 */
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

/**
 * 执行一次监控任务
 */
async function doRun() {
  if (isRunning) {
    console.log('[server] 上一次检查尚未结束，跳过本次调度');
    return;
  }
  isRunning = true;
  try {
    const result = await run(false);
    lastState = {
      status: result.status,
      totalProducts: result.totalProducts,
      newlyActivated: result.newlyActivated,
      fetchedAt: result.fetchedAt,
      updatedAt: new Date().toISOString(),
    };
  } catch (e) {
    console.error('[server] 监控任务异常:', e.message);
    lastState = { error: e.message, updatedAt: new Date().toISOString() };
  } finally {
    isRunning = false;
  }
}

/**
 * 静态文件服务
 */
async function serveStatic(reqPath, res) {
  let filePath = path.join(PUBLIC_DIR, reqPath === '/' ? 'index.html' : reqPath);
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.svg': 'image/svg+xml',
  };

  // 防止越界访问
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(content);
  } catch (e) {
    if (e.code === 'ENOENT') {
      res.writeHead(404);
      res.end('Not Found');
    } else {
      res.writeHead(500);
      res.end(e.message);
    }
  }
}

/**
 * HTTP 路由
 */
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;

  try {
    // 处理跨域预检请求
    if (req.method === 'OPTIONS' && FRONTEND_ORIGIN) {
      setCorsHeaders(res, req.headers.origin);
      res.writeHead(204);
      res.end();
      return;
    }

    // API 路由
    if (pathname === '/api/config' && req.method === 'GET') {
      setCorsHeaders(res, req.headers.origin);
      json(res, 200, getPublicConfig());
      return;
    }

    if (pathname === '/api/config' && req.method === 'POST') {
      setCorsHeaders(res, req.headers.origin);
      const auth = checkAdminSecret(req);
      if (!auth.ok) {
        json(res, 401, { message: auth.message });
        return;
      }
      const data = await parseBody(req);
      await writeEnv(data);
      config.reload();
      json(res, 200, { success: true, message: '配置已保存并生效' });
      return;
    }

    if (pathname === '/api/state' && req.method === 'GET') {
      setCorsHeaders(res, req.headers.origin);
      json(res, 200, lastState || { message: '尚未执行检查' });
      return;
    }

    if (pathname === '/api/run' && req.method === 'POST') {
      setCorsHeaders(res, req.headers.origin);
      const auth = checkAdminSecret(req);
      if (!auth.ok) {
        json(res, 401, { message: auth.message });
        return;
      }
      // 异步触发，不等待完成
      doRun().catch(e => console.error('[server] 手动触发异常:', e));
      json(res, 202, { success: true, message: '检查任务已触发' });
      return;
    }

    // 静态文件
    await serveStatic(pathname, res);
  } catch (e) {
    console.error('[server] 请求处理异常:', e);
    json(res, 500, { message: e.message });
  }
});

/**
 * 定时调度：每次运行后读取最新 checkIntervalMs，支持网页端动态调整间隔
 */
function scheduleNext() {
  const interval = config.checkIntervalMs || 300000;
  console.log(`[server] 下次检查将在 ${interval / 1000} 秒后执行`);
  setTimeout(async () => {
    await doRun();
    scheduleNext();
  }, interval);
}

server.listen(config.port, () => {
  console.log(`[server] 管理面板已启动: http://0.0.0.0:${config.port}`);
  console.log(`[server] ADMIN_SECRET ${config.adminSecret ? '已配置' : '未配置，请尽快设置'}`);

  // 启动后立即执行一次，然后进入定时循环
  doRun().finally(scheduleNext);
});
