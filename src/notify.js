/**
 * 飞书（Lark）自定义机器人通知模块
 *
 * 支持：
 *   - 通过 webhook 推送交互式卡片消息
 *   - 可选的签名验证（FEISHU_SECRET）
 *
 * 配置环境变量：
 *   FEISHU_WEBHOOK_URL=机器人 webhook 完整地址
 *   FEISHU_SECRET=机器人密钥（未启用签名验证可留空）
 */

const crypto = require('crypto');
const config = require('./config');

/**
 * 生成飞书自定义机器人签名
 * 文档：https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot
 */
function genSign(secret) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  // 飞书自定义机器人签名：把 timestamp + "\n" + secret 作为 HMAC 密钥，message 为空
  const stringToSign = `${timestamp}\n${secret}`;
  const sign = crypto.createHmac('sha256', stringToSign).digest('base64');
  return { timestamp, sign };
}

async function notifyFeishu(title, content) {
  const url = config.feishuWebhookUrl;
  if (!url) {
    throw new Error('FEISHU_WEBHOOK_URL 未配置');
  }

  const payload = {
    msg_type: 'interactive',
    card: {
      header: {
        title: {
          tag: 'plain_text',
          content: title,
        },
        template: 'blue',
      },
      elements: [
        {
          tag: 'div',
          text: {
            tag: 'lark_md',
            content,
          },
        },
      ],
    },
  };

  // 如果配置了密钥，添加签名
  if (config.feishuSecret) {
    const { timestamp, sign } = genSign(config.feishuSecret);
    payload.timestamp = timestamp;
    payload.sign = sign;
  }

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const data = await resp.json();
  if (data.code !== 0) {
    throw new Error(`飞书返回错误: ${data.msg || JSON.stringify(data)}`);
  }

  return data;
}

async function notify(title, content) {
  console.log(`[notify] 通过飞书发送通知: ${title}`);
  const result = await notifyFeishu(title, content);
  console.log('[notify] 发送成功');
  return result;
}

module.exports = { notify };
