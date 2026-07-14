/**
 * 配置模块 —— 所有配置从环境变量读取，方便云函数部署
 *
 * ECS/本地部署时支持从 .env 文件读取配置，并通过 reload() 在运行时热重载。
 */

// 加载 .env 文件
function loadDotenv() {
  try {
    require('dotenv').config({ override: true });
  } catch (e) {
    // 未安装 dotenv 时跳过，保持原有行为
  }
}

loadDotenv();

function buildConfig() {
  return {
    // ===== 监控目标 =====
    // 监控的机型 refurbClearModel 值（逗号分隔）
    watchModels: (process.env.WATCH_MODELS || 'macmini,macstudio,macpro')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean),

    // 机型中文名映射（用于通知消息）
    modelNames: {
      macmini: 'Mac mini',
      macstudio: 'Mac Studio',
      macpro: 'Mac Pro',
      macbookair: 'MacBook Air',
      macbookpro: 'MacBook Pro',
      macbookneo: 'MacBook Neo',
      imac: 'iMac',
      display: '显示屏',
    },

    // Apple 官翻页 URL
    url: process.env.APPLE_REFURB_URL || 'https://www.apple.com.cn/shop/refurbished/mac',

    // ===== 通知通道 =====
    // 当前仅支持飞书（Lark）自定义机器人
    notifyChannel: process.env.NOTIFY_CHANNEL || 'feishu',

    // 飞书自定义机器人 webhook 完整地址
    feishuWebhookUrl: process.env.FEISHU_WEBHOOK_URL || '',

    // 飞书自定义机器人密钥（启用签名验证时填写）
    feishuSecret: process.env.FEISHU_SECRET || '',

    // ===== 状态持久化 =====
    // cos | local（云函数用 cos，本地测试/ECS 用 local）
    stateBackend: process.env.STATE_BACKEND || 'local',

    // 腾讯云 COS 配置（STATE_BACKEND=cos 时必需）
    cos: {
      secretId: process.env.TENCENTCLOUD_SECRETID || process.env.COS_SECRET_ID || '',
      secretKey: process.env.TENCENTCLOUD_SECRETKEY || process.env.COS_SECRET_KEY || '',
      bucket: process.env.COS_BUCKET || '',
      region: process.env.COS_REGION || '',
      key: process.env.COS_STATE_KEY || 'apple-refurb-monitor/state.json',
    },

    // 本地状态文件路径（STATE_BACKEND=local 时使用）
    localStatePath: process.env.LOCAL_STATE_PATH || './state.json',

    // ===== 提醒策略 =====
    // 同一激活周期内连续提醒次数（默认 1，即仅第一次提醒）
    reminderRepeatCount: parseInt(process.env.REMINDER_REPEAT_COUNT || '1', 10),

    // ===== 网络 =====
    fetchTimeout: parseInt(process.env.FETCH_TIMEOUT || '15000', 10),

    // ===== Web 管理面板 =====
    // 管理员密钥，网页端保存配置时必须提供
    adminSecret: process.env.ADMIN_SECRET || '',

    // 前端独立部署时的来源域名，例如 https://username.github.io
    // 不配置时只允许同域访问
    frontendOrigin: process.env.FRONTEND_ORIGIN || '',

    // HTTP 服务端口
    port: parseInt(process.env.PORT || '3000', 10),

    // 监控检查间隔（毫秒，默认 5 分钟）
    checkIntervalMs: parseInt(process.env.CHECK_INTERVAL_MS || '300000', 10),
  };
}

const config = buildConfig();

/**
 * 重新加载 .env 并更新配置对象
 */
config.reload = function reload() {
  loadDotenv();
  const fresh = buildConfig();
  Object.keys(fresh).forEach(key => {
    config[key] = fresh[key];
  });
};

module.exports = config;
