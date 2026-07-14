/**
 * 状态持久化模块
 *
 * 云函数是无状态的，每次调用都是新进程。需要把上次检查的状态存到外部。
 * 支持两种后端：
 *   - local：本地文件（用于本地测试）
 *   - cos：腾讯云对象存储（用于 SCF 部署）
 */

const fs = require('fs').promises;
const path = require('path');
const config = require('./config');

// ===== 本地文件后端 =====
async function loadLocal() {
  try {
    const data = await fs.readFile(config.localStatePath, 'utf8');
    return JSON.parse(data);
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    if (e instanceof SyntaxError) return null;
    throw e;
  }
}

async function saveLocal(state) {
  const dir = path.dirname(path.resolve(config.localStatePath));
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(config.localStatePath, JSON.stringify(state, null, 2), 'utf8');
}

// ===== 腾讯云 COS 后端 =====
let cosClient = null;
function getCosClient() {
  if (cosClient) return cosClient;
  const COS = require('cos-nodejs-sdk-v5');
  cosClient = new COS({
    SecretId: config.cos.secretId,
    SecretKey: config.cos.secretKey,
  });
  return cosClient;
}

async function loadCos() {
  return new Promise(resolve => {
    getCosClient().getObject(
      {
        Bucket: config.cos.bucket,
        Region: config.cos.region,
        Key: config.cos.key,
      },
      (err, data) => {
        if (err) {
          // 404 / NoSuchKey 表示首次运行，状态为空
          if (err.statusCode === 404 || err.code === 'NoSuchKey' || err.error?.code === 'NoSuchKey') {
            resolve(null);
          } else {
            console.error('[state] COS 读取失败:', err.message || err);
            resolve(null); // 容错：读取失败按首次运行处理
          }
        } else {
          try {
            resolve(JSON.parse(data.Body.toString('utf8')));
          } catch (e) {
            resolve(null);
          }
        }
      }
    );
  });
}

async function saveCos(state) {
  return new Promise((resolve, reject) => {
    getCosClient().putObject(
      {
        Bucket: config.cos.bucket,
        Region: config.cos.region,
        Key: config.cos.key,
        Body: JSON.stringify(state, null, 2),
      },
      err => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

// ===== 统一接口 =====
async function loadState() {
  if (config.stateBackend === 'cos') return loadCos();
  return loadLocal();
}

async function saveState(state) {
  if (config.stateBackend === 'cos') return saveCos(state);
  return saveLocal(state);
}

module.exports = { loadState, saveState };
