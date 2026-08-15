const express = require('express')
const router = express.Router()
const pool = require('../config/db')
const auth = require('../middleware/auth')
const { preprocessAddresses, batchMatchAddress } = require('../utils/addressMatcher')

/**
 * 风险检测接口
 * 按买家账号或地址搜索最近14天的订单
 * 自动检测：同店铺多次下单、跨店铺下单
 * 开放查询所有店铺数据，不限制当前用户所属店铺
 */
router.get('/riskQuery', auth, async (req, res) => {
  try {
    const { keyword, type } = req.query
    const searchKey = keyword?.trim()

    if (!searchKey) {
      return res.json({ code: -1, msg: '请输入搜索关键词' })
    }

    let orders = []

    if (type === 'account') {
      // 按买家账号精确匹配
      const [rows] = await pool.query(
        `SELECT o.*, s.shop_name
         FROM \`order\` o
         LEFT JOIN shop s ON o.shop_id = s.shop_id
         WHERE o.buyer_account = ?
           AND o.order_time >= DATE_SUB(NOW(), INTERVAL 14 DAY)
         ORDER BY o.order_time DESC`,
        [searchKey]
      )
      orders = rows
    } else {
      // 按地址智能模糊匹配：先查近14天所有非脱敏订单，内存里智能匹配
      const [rows] = await pool.query(
        `SELECT o.*, s.shop_name
         FROM \`order\` o
         LEFT JOIN shop s ON o.shop_id = s.shop_id
         WHERE o.buyer_address IS NOT NULL AND CHAR_LENGTH(o.buyer_address) >= 6
           AND o.buyer_address NOT LIKE '%*%'
           AND o.order_time >= DATE_SUB(NOW(), INTERVAL 14 DAY)
         ORDER BY o.order_time DESC`
      )
      const preprocessed = preprocessAddresses(rows.map(o => o.buyer_address))
      const matchedIndexes = batchMatchAddress(searchKey, preprocessed)
      orders = matchedIndexes.map(i => rows[i])
    }

    // 分析风险等级
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
