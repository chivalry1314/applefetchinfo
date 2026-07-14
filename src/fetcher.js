/**
 * 页面抓取与产品解析模块
 *
 * Apple 官翻 Mac 页面是 React SPA，但产品数据以 JSON 形式内嵌在初始 HTML 中。
 * 每个产品对象包含 partNumber、title、price、filters.dimensions.refurbClearModel 等字段。
 * refurbClearModel 值（macmini / macstudio / macpro / macbookair / ...）标识产品所属机型。
 * 当某机型有库存时，页面 JSON 中会包含该 model 的产品；无库存时则完全没有。
 */

const config = require('./config');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function fetchPage() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.fetchTimeout);
  try {
    const resp = await fetch(config.url, {
      headers: {
        'User-Agent': UA,
        'Accept-Language': 'zh-CN,zh;q=0.9',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} ${resp.statusText}`);
    }
    return await resp.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 从 HTML 中提取产品列表
 *
 * Apple 官翻页将产品数据放在 window.REFURB_GRID_BOOTSTRAP 中，
 * 每个 tile 包含 productDetailsUrl、title、price、filters.dimensions.refurbClearModel 等字段。
 */
function parseProducts(html) {
  const bootstrapMatch = html.match(
    /window\.REFURB_GRID_BOOTSTRAP\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/i
  );
  if (!bootstrapMatch) {
    throw new Error('未在页面中找到 REFURB_GRID_BOOTSTRAP 数据');
  }

  let data;
  try {
    data = JSON.parse(bootstrapMatch[1]);
  } catch (e) {
    throw new Error('解析页面产品数据失败: ' + e.message);
  }

  const tiles = data.tiles || [];
  const baseOrigin = new URL(config.url).origin;

  return tiles
    .map(tile => {
      const detailPath = tile.productDetailsUrl || '';
      const url = detailPath.startsWith('http')
        ? detailPath
        : `${baseOrigin}${detailPath}`;
      return {
        partNumber: tile.partNumber || tile.price?.partNumber || '',
        title: tile.title || '',
        price: tile.price?.currentPrice?.amount || '未知价格',
        model: tile.filters?.dimensions?.refurbClearModel || '',
        url,
      };
    })
    .filter(p => p.partNumber && p.title && p.model);
}

function groupByModel(products) {
  const groups = {};
  for (const p of products) {
    if (!groups[p.model]) groups[p.model] = [];
    groups[p.model].push(p);
  }
  return groups;
}

/**
 * 获取当前各监控机型的激活状态
 * @returns {Promise<{status: Object, totalProducts: number, fetchedAt: string}>}
 */
async function getAvailability() {
  const html = await fetchPage();
  const products = parseProducts(html);
  const groups = groupByModel(products);

  const status = {};
  for (const model of config.watchModels) {
    const items = groups[model] || [];
    status[model] = {
      active: items.length > 0,
      count: items.length,
      products: items.map(p => ({
        partNumber: p.partNumber,
        title: p.title,
        price: p.price,
        url: p.url,
      })),
    };
  }

  return {
    status,
    totalProducts: products.length,
    allModels: Object.keys(groups).sort(),
    fetchedAt: new Date().toISOString(),
  };
}

module.exports = { fetchPage, parseProducts, groupByModel, getAvailability };
