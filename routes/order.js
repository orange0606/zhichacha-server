const express = require('express')
const router = express.Router()
const pool = require('../config/db')
const auth = require('../middleware/auth')
const { isAddressMatch, preprocessAddresses, batchMatchAddress, normalizeAddress, calcSimilarity } = require('../utils/addressMatcher')

// ========== 内存缓存：全库订单地址（预处理好的） ==========
let orderAddressCache = {
  data: [],
  preprocessed: [],
  byPrefix: new Map(),
  updateTime: 0,
  ttl: 5 * 60 * 1000
}

let reportAddressCache = {
  addresses: [],
  preprocessed: [],
  byPrefix: new Map(),
  updateTime: 0,
  ttl: 5 * 60 * 1000
}

async function loadOrderAddressCache() {
  const now = Date.now()
  if (orderAddressCache.data.length > 0 && (now - orderAddressCache.updateTime) < orderAddressCache.ttl) {
    return orderAddressCache
  }

  console.log("[风险检测] 刷新全库订单地址缓存...")
  const sql = "SELECT id, shop_id, order_no, goods_name, goods_count, pay_amount, order_time, " +
              "buyer_account, buyer_name, buyer_address, buyer_phone " +
              "FROM `order` " +
              "WHERE buyer_address IS NOT NULL AND CHAR_LENGTH(buyer_address) >= 6 " +
              "AND buyer_address NOT LIKE '%*%'"
  const [rows] = await pool.query(sql)

  const preprocessed = preprocessAddresses(rows.map(o => o.buyer_address))

  const byPrefix = new Map()
  preprocessed.forEach(item => {
    const prefix = item.norm.substring(0, 4)
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, [])
    byPrefix.get(prefix).push(item)
  })

  orderAddressCache = { data: rows, preprocessed, byPrefix, updateTime: now }
  console.log("[风险检测] 订单地址缓存刷新完成，共 " + rows.length + " 条，" + byPrefix.size + " 个前缀组")
  return orderAddressCache
}

async function loadReportAddressCache() {
  const now = Date.now()
  if (reportAddressCache.addresses.length > 0 && (now - reportAddressCache.updateTime) < reportAddressCache.ttl) {
    return reportAddressCache
  }

  console.log("[风险检测] 刷新举报地址缓存...")
  const sql = "SELECT receiver_address FROM report " +
              "WHERE receiver_address IS NOT NULL AND CHAR_LENGTH(receiver_address) >= 6 " +
              "AND receiver_address NOT LIKE '%*%' AND status = 1"
  const [rows] = await pool.query(sql)

  const addresses = rows.map(r => r.receiver_address)
  const preprocessed = preprocessAddresses(addresses)

  const byPrefix = new Map()
  preprocessed.forEach(item => {
    const prefix = item.norm.substring(0, 4)
    if (!byPrefix.has(prefix)) byPrefix.set(prefix, [])
    byPrefix.get(prefix).push(item)
  })

  reportAddressCache = { addresses, preprocessed, byPrefix, updateTime: now }
  console.log("[风险检测] 举报地址缓存刷新完成，共 " + addresses.length + " 条")
  return reportAddressCache
}

function matchAddressFromCache(searchAddr, cache) {
  if (!searchAddr || searchAddr.length < 6) return []

  const targetNorm = normalizeAddress(searchAddr)
  if (targetNorm.length < 8) return []

  const targetPrefix = targetNorm.substring(0, 4)
  let candidates = []
  if (cache.byPrefix.has(targetPrefix)) {
    candidates = cache.byPrefix.get(targetPrefix)
  }

  const matched = []
  for (const item of candidates) {
    if (item.norm === targetNorm) {
      matched.push(item.index)
      continue
    }
    const minLen = Math.min(item.norm.length, targetNorm.length)
    const maxLen = Math.max(item.norm.length, targetNorm.length)
    if (minLen / maxLen < 0.7) continue

    const sim = calcSimilarity(item.norm, targetNorm)
    if (sim >= 0.7) {
      matched.push(item.index)
    }
  }

  return matched
}

// 获取订单列表
router.get('/list', auth, async (req, res) => {
  try {
    const { shopId, page = 1, size = 20 } = req.query
    const offset = (page - 1) * size

    const [[totalRow]] = await pool.query(
      `SELECT COUNT(*) AS total FROM \`order\` 
       WHERE shop_id = ?`,
      [shopId]
    )
    const total = totalRow.total

    const [list] = await pool.query(
      `SELECT * FROM \`order\` 
       WHERE shop_id = ?
       ORDER BY order_time DESC
       LIMIT ? OFFSET ?`,
      [shopId, Number(size), Number(offset)]
    )

    res.json({ code: 0, data: { list, total } })
  } catch (err) {
    console.error('获取订单列表错误:', err)
    res.json({ code: -1, msg: '获取订单失败' })
  }
})

// 新增单条订单
router.post('/add', auth, async (req, res) => {
  try {
    const {
      shop_id,
      shop_name,
      order_no,
      goods_name,
      goods_count,
      pay_amount,
      buyer_account,
      buyer_name,
      buyer_phone,
      buyer_address,
      order_time
    } = req.body

    if (!shop_id) return res.json({ code: -1, msg: '缺少店铺ID' })
    if (!order_no) return res.json({ code: -1, msg: '订单号不能为空' })
    if (!goods_name) return res.json({ code: -1, msg: '商品名称不能为空' })

    const [shopCheck] = await pool.query(
      'SELECT id FROM shop WHERE user_id = ? AND shop_id = ?',
      [req.userId, shop_id]
    )
    if (shopCheck.length === 0) {
      return res.json({ code: -1, msg: '店铺不存在或无权限操作' })
    }

    const [orderExist] = await pool.query(
      'SELECT id FROM `order` WHERE shop_id = ? AND order_no = ?',
      [shop_id, order_no]
    )
    if (orderExist.length > 0) {
      return res.json({ code: -1, msg: `订单号【${order_no}】已存在` })
    }

    await pool.query(
      `INSERT INTO \`order\` 
      (shop_id, shop_name, order_no, goods_name, goods_count, pay_amount, buyer_account, buyer_name, buyer_phone, buyer_address, order_time)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [
        shop_id,
        shop_name,
        order_no,
        goods_name,
        Number(goods_count),
        Number(pay_amount),
        buyer_account,
        buyer_name,
        buyer_phone,
        buyer_address,
        order_time
      ]
    )

    res.json({ code: 0, msg: '订单添加成功' })
  } catch (err) {
    console.error('新增订单错误:', err)
    res.json({ code: -1, msg: '新增订单失败: ' + err.message })
  }
})

// 编辑订单
router.post('/edit', auth, async (req, res) => {
  try {
    const {
      id,
      shop_id,
      shop_name,
      order_no,
      goods_name,
      goods_count,
      pay_amount,
      buyer_account,
      buyer_name,
      buyer_phone,
      buyer_address,
      order_time
    } = req.body

    if (!id) return res.json({ code: -1, msg: '缺少订单id' })
    if (!shop_id) return res.json({ code: -1, msg: '缺少店铺ID' })
    if (!order_no) return res.json({ code: -1, msg: '订单号不能为空' })

    const [shopCheck] = await pool.query(
      'SELECT id FROM shop WHERE user_id = ? AND shop_id = ?',
      [req.userId, shop_id]
    )
    if (shopCheck.length === 0) {
      return res.json({ code: -1, msg: '店铺不存在或无权限操作' })
    }

    const [orderRow] = await pool.query(
      'SELECT id,order_no FROM `order` WHERE id = ? AND shop_id = ?',
      [id, shop_id]
    )
    if (orderRow.length === 0) {
      return res.json({ code: -1, msg: '订单不存在' })
    }

    const [dupOrder] = await pool.query(
      'SELECT id FROM `order` WHERE shop_id = ? AND order_no = ? AND id != ?',
      [shop_id, order_no, id]
    )
    if (dupOrder.length > 0) {
      return res.json({ code: -1, msg: `订单号【${order_no}】已存在` })
    }

    await pool.query(
      `UPDATE \`order\` SET 
        shop_name=?,
        order_no=?,
        goods_name=?,
        goods_count=?,
        pay_amount=?,
        buyer_account=?,
        buyer_name=?,
        buyer_phone=?,
        buyer_address=?,
        order_time=?
      WHERE id=? AND shop_id=?`,
      [
        shop_name,
        order_no,
        goods_name,
        Number(goods_count),
        Number(pay_amount),
        buyer_account,
        buyer_name,
        buyer_phone,
        buyer_address,
        order_time,
        id,
        shop_id
      ]
    )

    res.json({ code: 0, msg: '订单修改成功' })
  } catch (err) {
    console.error('编辑订单错误：', err)
    res.json({ code: -1, msg: '编辑订单失败：' + err.message })
  }
})

// 删除订单
router.delete('/del', auth, async (req, res) => {
  try {
    const { id, shop_id } = req.body
    if (!id || !shop_id) {
      return res.json({ code: -1, msg: '缺少订单id或shop_id' })
    }

    const [shopCheck] = await pool.query(
      'SELECT id FROM shop WHERE user_id = ? AND shop_id = ?',
      [req.userId, shop_id]
    )
    if (shopCheck.length === 0) {
      return res.json({ code: -1, msg: '店铺不存在或无权限操作' })
    }

    const [orderRow] = await pool.query(
      'SELECT id FROM `order` WHERE id = ? AND shop_id = ?',
      [id, shop_id]
    )
    if (orderRow.length === 0) {
      return res.json({ code: -1, msg: '订单不存在' })
    }

    await pool.query(
      'DELETE FROM `order` WHERE id = ? AND shop_id = ?',
      [id, shop_id]
    )

    res.json({ code: 0, msg: '删除订单成功' })
  } catch (err) {
    console.error('删除订单错误：', err)
    res.json({ code: -1, msg: '删除订单失败：' + err.message })
  }
})

// 批量删除订单
router.delete('/batchDel', auth, async (req, res) => {
  try {
    const { ids, shop_id } = req.body
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.json({ code: -1, msg: '请选择要删除的订单' })
    }
    if (!shop_id) {
      return res.json({ code: -1, msg: '缺少店铺ID' })
    }

    // 权限校验：只能删自己店铺的订单
    const [shopCheck] = await pool.query(
      'SELECT id FROM shop WHERE user_id = ? AND shop_id = ?',
      [req.userId, shop_id]
    )
    if (shopCheck.length === 0) {
      return res.json({ code: -1, msg: '店铺不存在或无权限操作' })
    }

    // 构造IN占位符
    const placeholders = ids.map(() => '?').join(',')
    const [result] = await pool.query(
      `DELETE FROM \`order\` WHERE shop_id = ? AND id IN (${placeholders})`,
      [shop_id, ...ids]
    )

    res.json({
      code: 0,
      msg: `成功删除 ${result.affectedRows} 条订单`,
      data: { deletedCount: result.affectedRows }
    })
  } catch (err) {
    console.error('批量删除订单错误：', err)
    res.json({ code: -1, msg: '批量删除失败：' + err.message })
  }
})

// 清空店铺所有订单（保留店铺，只删订单）
router.delete('/clearByShop', auth, async (req, res) => {
  try {
    const { shop_id } = req.body
    if (!shop_id) {
      return res.json({ code: -1, msg: '缺少店铺ID' })
    }

    // 权限校验
    const [shopCheck] = await pool.query(
      'SELECT id FROM shop WHERE user_id = ? AND shop_id = ?',
      [req.userId, shop_id]
    )
    if (shopCheck.length === 0) {
      return res.json({ code: -1, msg: '店铺不存在或无权限操作' })
    }

    const [result] = await pool.query(
      'DELETE FROM `order` WHERE shop_id = ?',
      [shop_id]
    )

    res.json({
      code: 0,
      msg: `已清空该店铺全部 ${result.affectedRows} 条订单`,
      data: { deletedCount: result.affectedRows }
    })
  } catch (err) {
    console.error('清空店铺订单错误：', err)
    res.json({ code: -1, msg: '清空失败：' + err.message })
  }
})

// 批量导入订单【同店铺订单号存在则覆盖更新，不存在新增】
router.post('/batchAdd', auth, async (req, res) => {
  const connection = await pool.getConnection()
  try {
    const { list } = req.body
    if (!Array.isArray(list) || list.length === 0) {
      connection.release()
      return res.json({ code: -1, msg: '没有待导入数据' })
    }

    const firstItem = list[0]
    const shop_id = firstItem.shop_id

    const [shopCheck] = await connection.query(
      'SELECT id FROM shop WHERE user_id = ? AND shop_id = ?',
      [req.userId, shop_id]
    )
    if (shopCheck.length === 0) {
      connection.release()
      return res.json({ code: -1, msg: '店铺不存在或无权限操作' })
    }

    await connection.beginTransaction()

    let insertCount = 0
    let updateCount = 0
    const updateOrderNos = []

    for (const item of list) {
      const {
        shop_name,
        order_no,
        goods_name,
        goods_count,
        pay_amount,
        buyer_account,
        buyer_name,
        buyer_phone,
        buyer_address,
        order_time
      } = item

      const [exist] = await connection.query(
        'SELECT id FROM `order` WHERE shop_id = ? AND order_no = ?',
        [shop_id, order_no]
      )

      if (exist.length > 0) {
        await connection.query(
          `UPDATE \`order\` SET
            shop_name=?,
            goods_name=?,
            goods_count=?,
            pay_amount=?,
            buyer_account=?,
            buyer_name=?,
            buyer_phone=?,
            buyer_address=?,
            order_time=?
          WHERE shop_id = ? AND order_no = ?`,
          [
            shop_name,
            goods_name,
            Number(goods_count),
            Number(pay_amount),
            buyer_account,
            buyer_name,
            buyer_phone,
            buyer_address,
            order_time,
            shop_id,
            order_no
          ]
        )
        updateCount++
        updateOrderNos.push(order_no)
      } else {
        await connection.query(
          `INSERT INTO \`order\` 
          (shop_id, shop_name, order_no, goods_name, goods_count, pay_amount, buyer_account, buyer_name, buyer_phone, buyer_address, order_time)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [
            shop_id,
            shop_name,
            order_no,
            goods_name,
            Number(goods_count),
            Number(pay_amount),
            buyer_account,
            buyer_name,
            buyer_phone,
            buyer_address,
            order_time
          ]
        )
        insertCount++
      }
    }

    await connection.commit()

    let message = `导入完成：新增${insertCount}条`
    if (updateCount > 0) {
      message += `，${updateCount}条订单已覆盖更新`
    }

    res.json({
      code: 0,
      msg: message,
      data: {
        total: list.length,
        insert: insertCount,
        update: updateCount,
        updateOrderNos
      }
    })
  } catch (err) {
    await connection.rollback()
    console.error('批量导入订单错误：', err)
    res.json({ code: -1, msg: '批量导入失败：' + err.message })
  } finally {
    connection.release()
  }
})

/**
 * 跨店铺账号风险匹配查询（POST）
 * 检测对象：当前用户自有店铺内、指定时间范围内出现过的买家账号
 * 风险判定：基于全库所有店铺的同时段订单，判断账号是否跨店/多单
 * 风险等级：2=跨店铺高风险，1=同店铺多单中风险
 * 排序规则：风险等级降序 > 买家账号升序 > 下单时间降序
 */
router.post('/matchByAccount', auth, async (req, res) => {
  try {
    const { startTime, endTime, type } = req.body

    if (!startTime || !endTime) {
      return res.json({ code: -1, msg: '请选择开始时间和结束时间' })
    }

    // 第一步：查询当前用户名下所有店铺
    const [userShops] = await pool.query(
      'SELECT shop_id FROM shop WHERE user_id = ?',
      [req.userId]
    )
    const shopIds = userShops.map(item => item.shop_id).filter(Boolean)

    if (shopIds.length === 0) {
      return res.json({
        code: 0,
        data: { groups: [], highRiskCount: 0, userShopCount: 0, riskAccountCount: 0, totalOrder: 0, shopCount: 0 }
      })
    }

    // 第二步：提取【自有店铺】时间范围内的去重买家账号和地址
    const shopPlaceholders = shopIds.map(() => '?').join(',')
    const [shopOrders] = await pool.query(
      `SELECT DISTINCT buyer_account, buyer_address
       FROM \`order\`
       WHERE shop_id IN (${shopPlaceholders})
         AND order_time >= ?
         AND order_time <= ?`,
      [...shopIds, startTime, endTime]
    )
    const accounts = [...new Set(shopOrders.map(o => o.buyer_account).filter(Boolean))]
    // 过滤掉带*号的脱敏地址，匹配不准确
    const addresses = [...new Set(
      shopOrders.map(o => o.buyer_address)
        .filter(addr => addr && !addr.includes('*'))
    )]

    if (accounts.length === 0 && addresses.length === 0) {
      return res.json({
        code: 0,
        data: { groups: [], highRiskCount: 0, userShopCount: shopIds.length, riskAccountCount: 0, totalOrder: 0, shopCount: 0 }
      })
    }

    // 第三步：全库查询账号匹配订单（全部时段）
    let accountOrders = []
    if (accounts.length > 0 && type !== 'address') {
      const ph = accounts.map(() => '?').join(',')
      const [rows] = await pool.query(
        `SELECT o.* FROM \`order\` o
         WHERE o.buyer_account IN (${ph})
         ORDER BY o.order_time DESC`,
        accounts
      )
      accountOrders = rows
    }

    // 第四步：全库查询地址匹配订单（智能模糊匹配）
    // 第四步：全库查询地址匹配订单（智能模糊匹配）
    const addressMatchMap = new Map()
    // 过滤掉脱敏地址（带星号的），这些地址匹配不准，跳过
    const validAddresses = addresses.filter(addr => addr && !addr.includes('*'))
    if (validAddresses.length > 0 && type !== 'account') {
      // 只查最近90天的订单，减少数据量
      const sql = "SELECT id, shop_id, order_no, goods_name, goods_count, pay_amount, order_time, " +
                  "buyer_account, buyer_name, buyer_address, buyer_phone " +
                  "FROM `order` " +
                  "WHERE buyer_address IS NOT NULL AND CHAR_LENGTH(buyer_address) >= 6 " +
                  "AND buyer_address NOT LIKE '%*%' " +
                  "AND order_time >= DATE_SUB(NOW(), INTERVAL 90 DAY) " +
                  "ORDER BY order_time DESC"
      const [allAddrOrders] = await pool.query(sql)
      // 预处理全库地址（标准化一次）
      const preprocessed = preprocessAddresses(allAddrOrders.map(o => o.buyer_address))
      validAddresses.forEach(addr => {
        if (!addr || addr.length < 6) return
        const matchedIndexes = batchMatchAddress(addr, preprocessed)
        if (matchedIndexes.length > 0) {
          addressMatchMap.set(addr, matchedIndexes.map(i => allAddrOrders[i]))
        }
      })
    }

    // 第五步：查询账号被举报次数
    const accountReportMap = {}
    if (accounts.length > 0 && type !== 'address') {
      const ph = accounts.map(() => '?').join(',')
      const [rows] = await pool.query(
        `SELECT buyer_account, COUNT(*) as cnt FROM report WHERE buyer_account IN (${ph}) AND status = 1 GROUP BY buyer_account`,
        accounts
      )
      rows.forEach(r => { accountReportMap[r.buyer_account] = r.cnt })
    }

    // 第六步：查询地址被举报次数（智能模糊匹配）
    // 第六步：查询地址被举报次数（智能模糊匹配）
    const addressReportMap = {}
    if (validAddresses.length > 0 && type !== 'account') {
      const sql = "SELECT receiver_address FROM report " +
                  "WHERE receiver_address IS NOT NULL AND CHAR_LENGTH(receiver_address) >= 6 " +
                  "AND receiver_address NOT LIKE '%*%' AND status = 1"
      const [allReportRows] = await pool.query(sql)
      const allReportAddrs = allReportRows.map(r => r.receiver_address)
      const preprocessed = preprocessAddresses(allReportAddrs)
      validAddresses.forEach(addr => {
        if (!addr || addr.length < 6) return
        const cnt = batchMatchAddress(addr, preprocessed).length
        if (cnt > 0) addressReportMap[addr] = cnt
      })
    }

    // ====== 查询店铺创建人信息，对店铺名称脱敏 ======
    const allRelatedShopIds = new Set()
    accountOrders.forEach(o => allRelatedShopIds.add(o.shop_id))
    addressMatchMap.forEach(orders => orders.forEach(o => allRelatedShopIds.add(o.shop_id)))
    const shopInfoMap = {}
    if (allRelatedShopIds.size > 0) {
      const sph = [...allRelatedShopIds].map(() => '?').join(',')
      const [shopRows] = await pool.query(
        `SELECT s.shop_id, s.shop_name, s.user_id, u.username
         FROM shop s LEFT JOIN user u ON s.user_id = u.id
         WHERE s.shop_id IN (${sph})`,
        [...allRelatedShopIds]
      )
      shopRows.forEach(s => { shopInfoMap[s.shop_id] = s })
    }
    const maskShopName = (order) => {
      const info = shopInfoMap[order.shop_id]
      if (!info) return order.shop_name || '未知店铺'
      if (String(info.user_id) === String(req.userId)) {
        return info.shop_name
      }
      return (info.username || '匿名') + '的小店'
    }
    const processOrder = (o) => ({
      ...o,
      shop_name: maskShopName(o),
      is_own_shop: shopInfoMap[o.shop_id] && String(shopInfoMap[o.shop_id].user_id) === String(req.userId)
    })
    accountOrders = accountOrders.map(processOrder)
    // 地址匹配结果也脱敏
    const processedAddressMatchMap = new Map()
    addressMatchMap.forEach((orders, myAddr) => {
      processedAddressMatchMap.set(myAddr, orders.map(processOrder))
    })

    const groups = []

    // ====== 账号维度分组 ======
    const accountGroupMap = {}
    accountOrders.forEach(order => {
      const acc = order.buyer_account
      if (!accountGroupMap[acc]) {
        accountGroupMap[acc] = { orders: [], shopIds: new Set() }
      }
      accountGroupMap[acc].orders.push(order)
      accountGroupMap[acc].shopIds.add(String(order.shop_id))
    })
    for (const acc in accountGroupMap) {
      const g = accountGroupMap[acc]
      const crossShopCount = g.shopIds.size
      const totalOrderCount = g.orders.length
      const reportCount = accountReportMap[acc] || 0
      const tags = []
      let riskLevel = 'normal'

      if (reportCount > 0) {
        tags.push(`账号被举报${reportCount}次`)
        riskLevel = 'high'
      }
      if (crossShopCount >= 2) {
        tags.push(`全库跨${crossShopCount}家店铺(账号)`)
        if (riskLevel === 'normal') riskLevel = 'medium'
      } else if (totalOrderCount >= 2) {
        tags.push(`同店铺下单${totalOrderCount}次`)
        if (riskLevel === 'normal') riskLevel = 'low'
      }

      if (riskLevel !== 'normal') {
        groups.push({
          groupType: 'account',
          groupKey: acc,
          groupName: acc,
          riskLevel,
          riskLevelText: riskLevel === 'high' ? '高风险' : riskLevel === 'medium' ? '中风险' : '低风险',
          crossShopCount,
          totalOrderCount,
          reportCount,
          tags,
          orders: g.orders
        })
      }
    }

    // ====== 地址维度分组（以自己店铺的地址为key，写法不同但智能匹配的订单归到同一组） ======
    processedAddressMatchMap.forEach((orders, myAddr) => {
      const shopIds = new Set()
      orders.forEach(o => shopIds.add(String(o.shop_id)))
      const crossShopCount = shopIds.size
      const totalOrderCount = orders.length
      const reportCount = addressReportMap[myAddr] || 0
      const tags = []
      let riskLevel = 'normal'

      if (reportCount > 0) {
        tags.push(`地址被举报${reportCount}次`)
        riskLevel = 'high'
      }
      if (crossShopCount >= 2) {
        tags.push(`全库跨${crossShopCount}家店铺(地址)`)
        if (riskLevel === 'normal') riskLevel = 'medium'
      }

      if (riskLevel !== 'normal') {
        groups.push({
          groupType: 'address',
          groupKey: myAddr,
          groupName: myAddr,
          riskLevel,
          riskLevelText: riskLevel === 'high' ? '高风险' : riskLevel === 'medium' ? '中风险' : '低风险',
          crossShopCount,
          totalOrderCount,
          reportCount,
          tags,
          orders
        })
      }
    })

    // 排序：风险等级高>中>低，同等级按最新订单时间降序，再按订单数倒序
    groups.sort((a, b) => {
      const levelOrder = { high: 3, medium: 2, low: 1 }
      if (levelOrder[b.riskLevel] !== levelOrder[a.riskLevel]) {
        return levelOrder[b.riskLevel] - levelOrder[a.riskLevel]
      }
      const timeA = a.orders[0] ? new Date(a.orders[0].order_time).getTime() : 0
      const timeB = b.orders[0] ? new Date(b.orders[0].order_time).getTime() : 0
      if (timeB !== timeA) return timeB - timeA
      return b.totalOrderCount - a.totalOrderCount
    })

    // 统计
    const allOrders = groups.flatMap(g => g.orders)
    const allShopIds = [...new Set(allOrders.map(o => String(o.shop_id)))]

    res.json({
      code: 0,
      data: {
        groups,
        highRiskCount: groups.filter(g => g.riskLevel === 'high').length,
        userShopCount: shopIds.length,
        riskAccountCount: groups.length,
        totalOrder: allOrders.length,
        shopCount: allShopIds.length
      }
    })
  } catch (err) {
  }
})
module.exports = router

