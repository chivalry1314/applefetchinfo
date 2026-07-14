/**
 * Apple 官翻 Mac 监控 —— 主入口
 *
 * 兼容两种运行方式：
 *   1. 腾讯云 SCF 定时触发器：exports.main_handler
 *   2. 本地命令行：node index.js [--dry-run]
 *
 * 核心逻辑：
 *   1. 抓取 Apple 官翻 Mac 页面
 *   2. 从内嵌 JSON 中提取所有产品的 refurbClearModel
 *   3. 判断 Mac mini / Mac Studio / Mac Pro 是否有产品（"已激活"）
 *   4. 对比上次状态，找出需要提醒的机型（支持连续多次提醒）
 *   5. 通过飞书推送通道发送通知
 *   6. 保存当前状态
 */

const config = require('./src/config');
const { getAvailability } = require('./src/fetcher');
const { loadState, saveState } = require('./src/state');
const { notify } = require('./src/notify');

async function run(dryRun = false) {
  // 运行前重新加载配置，确保网页端修改后立即生效
  config.reload();

  console.log(`[monitor] ===== 开始检查 ${new Date().toISOString()} =====`);
  console.log(`[monitor] 监控目标: ${config.watchModels.map(m => config.modelNames[m] || m).join(', ')}`);
  console.log(`[monitor] 通知通道: ${config.notifyChannel}`);
  console.log(`[monitor] 状态后端: ${config.stateBackend}`);

  // 1. 获取当前状态
  const { status, totalProducts, allModels, fetchedAt } = await getAvailability();
  console.log(`[monitor] 页面共 ${totalProducts} 个产品，当前有货机型: ${allModels.join(', ') || '无'}`);

  for (const model of config.watchModels) {
    const s = status[model];
    const name = config.modelNames[model] || model;
    console.log(`[monitor]   ${name}: ${s.active ? `✅ 已激活 (${s.count} 个 SKU)` : '❌ 未激活'}`);
  }

  // 2. 加载上次状态
  const prevState = await loadState();

  // 3. 判断需要通知的机型，并更新每台机型的连续提醒计数
  const repeatCount = config.reminderRepeatCount || 1;
  const newlyActivated = [];
  for (const model of config.watchModels) {
    const current = status[model];
    const prev = prevState?.status?.[model];
    if (current.active) {
      // 本次处于激活状态：首次激活或连续提醒次数未达上限时继续通知
      const prevReminderCount = prev?.active ? (prev.reminderCount || 0) : 0;
      if (prevReminderCount < repeatCount) {
        newlyActivated.push(model);
        current.reminderCount = prevReminderCount + 1;
      } else {
        current.reminderCount = prevReminderCount;
      }
    } else {
      // 未激活时重置提醒计数
      current.reminderCount = 0;
    }
  }

  // 4. 发送通知
  if (newlyActivated.length > 0) {
    const modelLabels = newlyActivated.map(m => config.modelNames[m] || m);
    console.log(`[monitor] 🎉 需要提醒的机型: ${modelLabels.join(', ')}`);

    if (!dryRun) {
      const title = `🍎 Apple 官翻上架提醒: ${modelLabels.join(' / ')}`;

      let content = `## Apple 官翻 Mac 上架提醒\n\n`;
      content += `检测时间: ${fetchedAt}\n\n`;

      for (const model of newlyActivated) {
        const name = config.modelNames[model] || model;
        const s = status[model];
        const showCount = Math.min(s.products.length, 3);
        content += `### ${name}（${showCount} 个 SKU 展示 / 共 ${s.count} 个，第 ${s.reminderCount} 次提醒 / 共 ${repeatCount} 次）\n\n`;
        for (const p of s.products.slice(0, 3)) {
          content += `- **${p.title}**\n  价格: ${p.price}\n  [查看详情](${p.url})\n\n`;
        }
        if (s.products.length > 3) {
          content += `> 还有 ${s.products.length - 3} 个 SKU 未显示\n\n`;
        }
      }

      content += `---\n[前往 Apple 官翻 Mac 页面](${config.url})`;

      try {
        await notify(title, content);
      } catch (e) {
        console.error(`[monitor] 通知发送失败: ${e.message}`);
        // 通知失败不影响状态保存
      }
    } else {
      console.log('[monitor] (dry-run 模式，跳过实际通知发送)');
    }
  } else {
    console.log('[monitor] 无需要提醒的机型，不发送通知');
  }

  // 5. 保存当前状态
  await saveState({ status, totalProducts, allModels, fetchedAt, updatedAt: new Date().toISOString() });
  console.log('[monitor] 状态已保存');
  console.log(`[monitor] ===== 检查完成 =====`);

  return { status, totalProducts, newlyActivated, fetchedAt };
}

// 导出给 server.js 调用
exports.run = run;

// ===== 腾讯云 SCF 入口 =====
exports.main_handler = async (event, context) => {
  try {
    const result = await run(false);
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (e) {
    console.error(`[monitor] 异常: ${e.message}`, e.stack);
    throw e;
  }
};

// ===== 本地命令行入口 =====
if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  run(dryRun)
    .then(() => {
      process.exit(0);
    })
    .catch(e => {
      console.error('[monitor] 失败:', e);
      process.exit(1);
    });
}
