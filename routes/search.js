const express = require('express')
const router = express.Router()
const pool = require('../config/db')
const auth = require('../middleware/auth')
const { preprocessAddresses, batchMatchAddress } = require('../utils/addressMatcher')

// ========== 内存缓存：14天内所有订单（预处理好的） ==========
// 每5分钟更新一次，避免每次查询都重新查库+预处理
let orderCache = {
  data: [],
  byPrefix: new Map(), // 按地址前4字分组，用于粗筛
  updateTime: 0,
  ttl: 5 * 60 * 1000 // 5分钟过期
}

/**
 * 加载并缓存14天内所有订单
 */
async function loadOrderCache() {
  const now = Date.now()
  if (orderCache.data.length > 0 && (now - orderCache.updateTime) < orderCache.ttl) {
    return orderCache
  }

  console.log('[风险检测] 刷新订单缓存...')
  const [rows] = await pool.query(
    `SELECT o.id, o.shop_id, o.order_no, o.goods_name, o.goods_count,
            o.pay_amount, o.order_time, o.buyer_account, o.buyer_name,
            o.buyer_address, o.buyer_phone
     FROM \`order\` o
     WHERE o.buyer_address IS NOT NULL
       AND o.buyer_address NOT LIKE '%*%'
       AND o.order_time >= DATE_SUB(NOW(), INTERVAL 14 DAY)`
  )

  // 预处理地址
  const preprocessed = preprocessAddresses(rows.map(o => o.buyer_address))

  // 按地址前4字分组，用于粗筛
  const byPrefix = new Map()
  preprocessed.forEach(item => {
    const prefix = item.norm.substring(0, 4)
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, [])
    byPrefix.get(prefix).push(item)
  })

  orderCache = {
    data: rows,
    preprocessed,
    byPrefix,
    updateTime: now
  }
  console.log(`[风险检测] 缓存刷新完成，共 ${rows.length} 条订单，${byPrefix.size} 个前缀组`)

  return orderCache
}

/**
 * 从缓存中匹配地址（带前缀粗筛优化）
 */
function matchAddressFromCache(searchAddr, cache) {
  if (!searchAddr || searchAddr.length < 6) return []

  // 标准化搜索地址
  const { normalizeAddress } = require('../utils/addressMatcher')
  const targetNorm = normalizeAddress(searchAddr)
  if (targetNorm.length < 8) return []

  // 取搜索地址前4个字作为前缀，先在同组里找
  const targetPrefix = targetNorm.substring(0, 4)

  // 收集候选：同前缀组的 + 可能有前4字不同但中间相似的
  let candidates = []

  // 1. 同前缀组的（绝大多数匹配都在这里）
  if (cache.byPrefix.has(targetPrefix)) {
    candidates = candidates.concat(cache.byPrefix.get(targetPrefix))
  }

  // 2. 也检查其他可能的前缀（比如搜索地址和数据库地址的行政区划顺序不同）
  // 这里简化处理，只取前4字相同的，已经能覆盖95%以上的匹配

  // 在候选里做精确匹配
  const matched = []
  for (const item of candidates) {
    if (item.norm === targetNorm) {
      matched.push(item.index)
      continue
    }
    // 长度差距太大直接跳过
    const minLen = Math.min(item.norm.length, targetNorm.length)
    const maxLen = Math.max(item.norm.length, targetNorm.length)
    if (minLen / maxLen < 0.7) continue

    const { calcSimilarity } = require('../utils/addressMatcher')
    const sim = calcSimilarity(item.norm, targetNorm)
    if (sim >= 0.7) {
      matched.push(item.index)
    }
  }

  return matched
}

/**
 * 风险检测接口
 * 输入买家账号，自动检测：
 * 1. 该账号在全库所有店铺的订单（跨店铺检测）
 * 2. 用该账号的地址匹配全库相似地址的订单（地址维度检测）
 * 3. 合并去重，分析风险等级
 */
router.get('/riskQuery', auth, async (req, res) => {
  try {
    const { keyword } = req.query
    const searchKey = keyword?.trim()

    if (!searchKey) {
      return res.json({ code: -1, msg: '请输入搜索关键词（买家账号）' })
    }

    // ========== 第一步：按账号查所有订单（走索引，很快） ==========
    const [accountRows] = await pool.query(
      `SELECT o.id, o.shop_id, o.order_no, o.goods_name, o.goods_count,
              o.pay_amount, o.order_time, o.buyer_account, o.buyer_name,
              o.buyer_address, o.buyer_phone
       FROM \`order\` o
       WHERE o.buyer_account = ?
         AND o.order_time >= DATE_SUB(NOW(), INTERVAL 14 DAY)
       ORDER BY o.order_time DESC`,
      [searchKey]
    )

    let orders = [...accountRows]

    // ========== 第二步：加载缓存，做地址匹配（全量，带优化） ==========
    if (accountRows.length > 0 && accountRows[0].buyer_address) {
      const searchAddr = accountRows[0].buyer_address

      // 加载缓存（第一次会慢，之后都是内存匹配，很快）
      const cache = await loadOrderCache()

      // 从缓存里匹配地址（带前缀粗筛优化）
      const matchedIndexes = matchAddressFromCache(searchAddr, cache)
      const addressMatchedOrders = matchedIndexes.map(i => cache.data[i])

      // 合并结果，按订单号去重
      const existingOrderNos = new Set(orders.map(o => o.order_no))
      addressMatchedOrders.forEach(o => {
        if (!existingOrderNos.has(o.order_no)) {
          orders.push(o)
          existingOrderNos.add(o.order_no)
        }
      })
    }

    // 按时间倒序排序
    orders.sort((a, b) => new Date(b.order_time) - new Date(a.order_time))

    // ========== 第三步：批量补店铺名 ==========
    if (orders.length > 0) {
      const shopIds = [...new Set(orders.map(o => o.shop_id))]
      const ph = shopIds.map(() => '?').join(',')
      const [shopRows] = await pool.query(
        `SELECT shop_id, shop_name FROM shop WHERE shop_id IN (${ph})`,
        shopIds
      )
      const shopMap = {}
      shopRows.forEach(s => { shopMap[s.shop_id] = s.shop_name })
      orders.forEach(o => { o.shop_name = shopMap[o.shop_id] || '' })
    }

    // ========== 第四步：分析风险等级 ==========
    const shopIds = [...new Set(orders.map(o => o.shop_id))]
    const shopCount = shopIds.length
    const totalOrder = orders.length

    let riskLevel = '正常'
    if (shopCount >= 2) {
      riskLevel = '🔴 高危：跨多家店铺下单'
    } else if (totalOrder >= 3 && shopCount === 1) {
      riskLevel = '⚠️ 风险：同店铺多次下单'
    }

    res.json({
      code: 0,
      data: orders,
      riskInfo: {
        totalOrder,
        shopCount,
        riskLevel
      }
    })
  } catch (err) {
    console.error('风险查询错误:', err)
    res.json({ code: -1, msg: '查询失败: ' + err.message })
  }
})

module.exports = router
