const express = require('express')
const router = express.Router()
const pool = require('../config/db')
const auth = require('../middleware/auth')
const { preprocessAddresses, batchMatchAddress } = require('../utils/addressMatcher')

/**
 * 根据时间范围获取开始时间
 */
function getStartTime(range) {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  switch (range) {
    case 'today':
      return today
    case 'yesterday': {
      const y = new Date(today)
      y.setDate(y.getDate() - 1)
      return y
    }
    case '7d': {
      const d = new Date(today)
      d.setDate(d.getDate() - 7)
      return d
    }
    case '15d': {
      const d = new Date(today)
      d.setDate(d.getDate() - 15)
      return d
    }
    case '30d': {
      const d = new Date(today)
      d.setDate(d.getDate() - 30)
      return d
    }
    default:
      return today
  }
}

/**
 * 根据时间范围获取结束时间
 * yesterday 结束于今天0点，其他结束于当前时刻
 */
function getEndTime(range) {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (range === 'yesterday') {
    return today // 今天0点，即昨天结束
  }
  return now
}

/**
 * 总览数据
 * GET /api/dashboard/overview
 * 返回：总店铺数、总订单数、总订单金额、风险订单数(占位)
 */
router.get('/overview', auth, async (req, res) => {
  try {
    // 总店铺数
    const [shopRows] = await pool.query(
      'SELECT COUNT(*) as total FROM shop WHERE user_id = ?',
      [req.userId]
    )
    const totalShops = shopRows[0].total || 0

    // 总订单数和总金额
    const [orderRows] = await pool.query(
      `SELECT COUNT(*) as total, IFNULL(SUM(pay_amount), 0) as amount
       FROM \`order\` o
       JOIN shop s ON o.shop_id = s.shop_id
       WHERE s.user_id = ?`,
      [req.userId]
    )
    const totalOrders = orderRows[0].total || 0
    const totalAmount = Number(orderRows[0].amount) || 0

    // 风险订单数：账号或地址被举报过的订单数
    let riskOrders = 0
    try {
      const [userShopRows] = await pool.query(
        'SELECT shop_id FROM shop WHERE user_id = ?',
        [req.userId]
      )
      const shopIds = userShopRows.map(s => s.shop_id)
      if (shopIds.length > 0) {
        const ph = shopIds.map(() => '?').join(',')
        // 获取用户所有订单
        const [allUserOrders] = await pool.query(
          `SELECT id, buyer_account, buyer_address FROM \`order\` WHERE shop_id IN (${ph})`,
          shopIds
        )
        // 去重账号和地址
        const accounts = [...new Set(allUserOrders.map(o => o.buyer_account).filter(Boolean))]
        const addresses = [...new Set(allUserOrders.map(o => o.buyer_address).filter(a => a && !a.includes('*') && a.length >= 6))]

        // 查被举报的账号
        const riskAccounts = new Set()
        if (accounts.length > 0) {
          const aph = accounts.map(() => '?').join(',')
          const [r] = await pool.query(
            `SELECT DISTINCT buyer_account FROM report WHERE buyer_account IN (${aph})`,
            accounts
          )
          r.forEach(row => riskAccounts.add(row.buyer_account))
        }

        // 查被举报的地址（智能匹配）
        const riskAddresses = new Set()
        if (addresses.length > 0) {
          const [allReportRows] = await pool.query(
            `SELECT DISTINCT receiver_address FROM report
             WHERE receiver_address IS NOT NULL AND CHAR_LENGTH(receiver_address) >= 6
               AND receiver_address NOT LIKE '%*%'`
          )
          const allReportAddrs = allReportRows.map(r => r.receiver_address)
          const preprocessed = preprocessAddresses(allReportAddrs)
          addresses.forEach(addr => {
            if (!addr || addr.length < 6) return
            if (batchMatchAddress(addr, preprocessed).length > 0) {
              riskAddresses.add(addr)
            }
          })
        }

        // 统计风险订单数
        riskOrders = allUserOrders.filter(o =>
          riskAccounts.has(o.buyer_account) ||
          (o.buyer_address && riskAddresses.has(o.buyer_address))
        ).length
      }
    } catch (e) {
      console.error('统计风险订单数失败：', e.message)
    }

    res.json({
      code: 0,
      data: {
        totalShops,
        totalOrders,
        totalAmount,
        riskOrders
      }
    })
  } catch (err) {
    console.error('获取总览数据失败：', err)
    res.json({ code: -1, msg: '获取数据失败：' + err.message })
  }
})

/**
 * 各店铺订单统计
 * GET /api/dashboard/shop-stats?range=today|yesterday|7d|15d|30d
 * 返回每个店铺的订单数和订单金额
 */
router.get('/shop-stats', auth, async (req, res) => {
  try {
    const range = req.query.range || 'today'
    const startTime = getStartTime(range)
    const endTime = getEndTime(range)

    const [rows] = await pool.query(
      `SELECT
        s.shop_id,
        s.shop_name,
        COUNT(o.id) as order_count,
        IFNULL(SUM(o.pay_amount), 0) as order_amount
       FROM shop s
       LEFT JOIN \`order\` o ON s.shop_id = o.shop_id AND o.order_time >= ? AND o.order_time <= ?
       WHERE s.user_id = ?
       GROUP BY s.shop_id, s.shop_name
       ORDER BY order_count DESC`,
      [startTime, endTime, req.userId]
    )

    const list = rows.map(r => ({
      shopId: r.shop_id,
      shopName: r.shop_name,
      orderCount: r.order_count,
      orderAmount: Number(r.order_amount) || 0
    }))

    // 合计
    const totalCount = list.reduce((sum, item) => sum + item.orderCount, 0)
    const totalAmount = list.reduce((sum, item) => sum + item.orderAmount, 0)

    res.json({
      code: 0,
      data: {
        range,
        list,
        totalCount,
        totalAmount
      }
    })
  } catch (err) {
    console.error('获取店铺统计失败：', err)
    res.json({ code: -1, msg: '获取数据失败：' + err.message })
  }
})

/**
 * 最近举报列表（最新10条）
 * GET /api/dashboard/recent-reports
 */
router.get('/recent-reports', auth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT r.id, r.dispute_type, r.order_no, r.buyer_account, r.receiver_name,
              r.receiver_phone, r.receiver_address, r.reason, r.status, r.create_time,
              u.username AS reporter_name
       FROM report r
       LEFT JOIN user u ON r.user_id = u.id
       ORDER BY r.create_time DESC
       LIMIT 10`
    )

    const typeMap = {
      1: '异常索赔', 2: '仅退款', 3: '异常退货',
      4: '异常评价', 5: '骗取财物', 6: '其它'
    }
    const statusMap = {
      0: '待处理', 1: '已处理', 2: '已驳回', 3: '已撤销'
    }

    const list = rows.map(r => ({
      id: r.id,
      disputeType: r.dispute_type,
      disputeTypeText: typeMap[r.dispute_type] || '未知',
      orderNo: r.order_no,
      buyerAccount: r.buyer_account,
      receiverName: r.receiver_name,
      receiverPhone: r.receiver_phone,
      receiverAddress: r.receiver_address,
      reporterName: r.reporter_name,
      reason: r.reason,
      status: r.status,
      statusText: statusMap[r.status] || '未知',
      createTime: r.create_time
    }))

    res.json({ code: 0, data: list })
  } catch (err) {
    console.error('获取最近举报失败：', err)
    res.json({ code: -1, msg: '获取数据失败：' + err.message })
  }
})

/**
 * 风险检测
 * GET /api/dashboard/risk-check?range=today|yesterday|7d|15d|30d
 * 检测当前用户所有店铺在时间范围内的风险订单
 * 逻辑：先取自己店铺的账号/地址，再去全库所有订单匹配跨店、多单、举报
 */
router.get('/risk-check', auth, async (req, res) => {
  try {
    const range = req.query.range || 'today'
    const startTime = getStartTime(range)
    const endTime = getEndTime(range)

    // 1. 获取当前用户所有店铺ID
    const [shops] = await pool.query(
      'SELECT shop_id, shop_name FROM shop WHERE user_id = ?',
      [req.userId]
    )
    if (shops.length === 0) {
      return res.json({
        code: 0,
        data: { range, summary: { total: 0, high: 0, medium: 0, low: 0, fake: 0 }, list: [] }
      })
    }
    const myShopIds = shops.map(s => s.shop_id)
    const myShopIdStrs = myShopIds.map(String)
    const shopPlaceholders = myShopIds.map(() => '?').join(',')

    // 2. 先查自己店铺时间范围内的所有订单（最终只返回这些）
    const [myOrders] = await pool.query(
      `SELECT id, shop_id, shop_name, order_no, goods_name, goods_count, pay_amount,
              order_time, buyer_account, buyer_name, buyer_phone, buyer_address
       FROM \`order\`
       WHERE shop_id IN (${shopPlaceholders}) AND order_time >= ? AND order_time <= ?
       ORDER BY order_time DESC`,
      [...myShopIds, startTime, endTime]
    )

    if (myOrders.length === 0) {
      return res.json({
        code: 0,
        data: { range, summary: { total: 0, high: 0, medium: 0, low: 0, fake: 0 }, list: [] }
      })
    }

    // 3. 提取自己店铺的账号和地址（去重，过滤脱敏地址）
    const myAccounts = [...new Set(myOrders.map(o => o.buyer_account).filter(Boolean))]
    const myAddresses = [...new Set(
      myOrders.map(o => o.buyer_address)
        .filter(addr => addr && !addr.includes('*'))
    )]

    // 4. 全库查询这些账号的所有订单（所有用户的店铺）
    const accountPlaceholders = myAccounts.map(() => '?').join(',')
    const [allAccountOrders] = await pool.query(
      `SELECT shop_id, buyer_account FROM \`order\`
       WHERE buyer_account IN (${accountPlaceholders})`,
      myAccounts
    )

    // 5. 全库查询这些地址的所有订单（智能模糊匹配）
    let allAddressOrders = []
    if (myAddresses.length > 0) {
      const [allAddrRows] = await pool.query(
        `SELECT shop_id, buyer_address FROM \`order\`
         WHERE buyer_address IS NOT NULL AND CHAR_LENGTH(buyer_address) >= 6
           AND buyer_address NOT LIKE '%*%'`
      )
      const preprocessed = preprocessAddresses(allAddrRows.map(o => o.buyer_address))
      const matchedMap = new Map()
      myAddresses.forEach(addr => {
        if (!addr || addr.length < 6) return
        const matchedIndexes = batchMatchAddress(addr, preprocessed)
        if (matchedIndexes.length > 0) {
          matchedMap.set(addr, matchedIndexes.map(i => allAddrRows[i]))
        }
      })
      matchedMap.forEach((orders, addr) => {
        orders.forEach(o => {
          allAddressOrders.push({ shop_id: o.shop_id, buyer_address: addr })
        })
      })
    }

    // 6. 统计账号：全库跨店数、全库同店次数
    const accountStats = {}
    allAccountOrders.forEach(o => {
      const acc = o.buyer_account
      if (!accountStats[acc]) {
        accountStats[acc] = { shopIds: new Set(), sameShopCount: {} }
      }
      accountStats[acc].shopIds.add(String(o.shop_id))
      const sid = String(o.shop_id)
      accountStats[acc].sameShopCount[sid] = (accountStats[acc].sameShopCount[sid] || 0) + 1
    })

    // 7. 统计地址：全库跨店数
    const addressStats = {}
    allAddressOrders.forEach(o => {
      const addr = o.buyer_address
      if (!addressStats[addr]) {
        addressStats[addr] = { shopIds: new Set() }
      }
      addressStats[addr].shopIds.add(String(o.shop_id))
    })

    // 8. 查询账号被举报次数（全库）
    const accountReportMap = {}
    if (myAccounts.length > 0) {
      const accReportPh = myAccounts.map(() => '?').join(',')
      const [reportRows] = await pool.query(
        `SELECT buyer_account, COUNT(*) as cnt FROM report
         WHERE buyer_account IN (${accReportPh}) GROUP BY buyer_account`,
        myAccounts
      )
      reportRows.forEach(r => { accountReportMap[r.buyer_account] = r.cnt })
    }

    // 9. 查询地址被举报次数（智能模糊匹配）
    const addressReportMap = {}
    if (myAddresses.length > 0) {
      const [allReportRows] = await pool.query(
        `SELECT receiver_address FROM report
         WHERE receiver_address IS NOT NULL AND CHAR_LENGTH(receiver_address) >= 6
           AND receiver_address NOT LIKE '%*%'`
      )
      const allReportAddrs = allReportRows.map(r => r.receiver_address)
      const preprocessed = preprocessAddresses(allReportAddrs)
      myAddresses.forEach(addr => {
        if (!addr || addr.length < 6) return
        const cnt = batchMatchAddress(addr, preprocessed).length
        if (cnt > 0) addressReportMap[addr] = cnt
      })
    }

    // 10. 给自己店铺的每个订单打标签
    const riskOrders = []
    myOrders.forEach(o => {
      const sid = String(o.shop_id)
      const acc = o.buyer_account
      const addr = o.buyer_address

      const accStat = accountStats[acc] || { shopIds: new Set(), sameShopCount: {} }
      const addrStat = addressStats[addr] || { shopIds: new Set() }

      const crossShopAccountCount = accStat.shopIds.size || 1
      const crossShopAddressCount = addrStat.shopIds.size || 1
      const sameShopAccountCount = accStat.sameShopCount[sid] || 1
      const accountReportCount = accountReportMap[acc] || 0
      const addressReportCount = addr ? (addressReportMap[addr] || 0) : 0

      const tags = []
      let riskLevel = null

      // 高风险：只有被举报过
      if (accountReportCount > 0) {
        tags.push(`账号被举报${accountReportCount}次`)
        riskLevel = 'high'
      }
      if (addressReportCount > 0) {
        tags.push(`地址被举报${addressReportCount}次`)
        riskLevel = 'high'
      }

      // 中风险：跨店铺（账号/地址）
      if (crossShopAccountCount >= 2) {
        tags.push(`全库跨${crossShopAccountCount}家店铺(账号)`)
        if (!riskLevel) riskLevel = 'medium'
      }
      if (crossShopAddressCount >= 2) {
        tags.push(`全库跨${crossShopAddressCount}家店铺(地址)`)
        if (!riskLevel) riskLevel = 'medium'
      }
      // 低风险：同店多单
      if (sameShopAccountCount >= 2) {
        tags.push(`同店铺下单${sameShopAccountCount}次`)
        if (!riskLevel) riskLevel = 'low'
      }

      // 只保留有风险的
      if (riskLevel) {
        riskOrders.push({
          id: o.id,
          shopId: o.shop_id,
          shopName: o.shop_name,
          orderNo: o.order_no,
          goodsName: o.goods_name,
          payAmount: Number(o.pay_amount),
          orderTime: o.order_time,
          buyerAccount: acc,
          buyerName: o.buyer_name,
          buyerPhone: o.buyer_phone,
          buyerAddress: addr,
          riskLevel,
          tags,
          crossShopAccountCount,
          crossShopAddressCount,
          sameShopAccountCount,
          accountReportCount,
          addressReportCount
        })
      }
    })

    // 11. 排序：高风险在前，同风险按时间倒序
    const levelOrder = { high: 3, medium: 2, low: 1 }
    riskOrders.sort((a, b) => {
      if (levelOrder[b.riskLevel] !== levelOrder[a.riskLevel]) {
        return levelOrder[b.riskLevel] - levelOrder[a.riskLevel]
      }
      return new Date(b.orderTime) - new Date(a.orderTime)
    })

    const summary = {
      total: riskOrders.length,
      high: riskOrders.filter(o => o.riskLevel === 'high').length,
      medium: riskOrders.filter(o => o.riskLevel === 'medium').length,
      low: riskOrders.filter(o => o.riskLevel === 'low').length,
      fake: riskOrders.filter(o => o.riskLevel === 'high').length
    }

    res.json({ code: 0, data: { range, summary, list: riskOrders } })
  } catch (err) {
    console.error('风险检测失败：', err)
    res.json({ code: -1, msg: '风险检测失败：' + err.message })
  }
})

module.exports = router
