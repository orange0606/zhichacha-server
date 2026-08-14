const express = require('express')
const router = express.Router()
const pool = require('../config/db')
const auth = require('../middleware/auth')
const { isAddressMatch } = require('../utils/addressMatcher')

// 去重类型映射
const DISPUTE_TYPE_MAP = {
  1: '异常索赔',
  2: '仅退款',
  3: '异常退货',
  4: '异常评价',
  5: '骗取财物',
  6: '其它'
}

// 状态映射
const STATUS_MAP = {
  0: '待审核',
  1: '已通过',
  2: '已驳回',
  3: '已撤销'
}

/**
 * 判断一条举报是否匹配关键词（账号LIKE 或 地址智能匹配）
 */
function matchKeyword(item, keyword) {
  if (!keyword) return true
  const kw = keyword.toLowerCase()
  // 账号LIKE匹配
  if (item.buyer_account && item.buyer_account.toLowerCase().includes(kw)) return true
  // 地址智能匹配
  if (item.receiver_address && isAddressMatch(keyword, item.receiver_address)) return true
  return false
}

/**
 * 计算搜索匹配度（0-100）
 */
function calcSimilarity(item, keyword) {
  if (!keyword || !keyword.trim()) return 0
  const kw = keyword.trim().toLowerCase()

  const calcFieldScore = (field) => {
    if (!field) return 0
    const str = field.toLowerCase()
    if (str === kw) return 100
    if (str.includes(kw)) return Math.round((kw.length / str.length) * 100)
    // 地址智能匹配给个基础分
    if (field === item.receiver_address && isAddressMatch(keyword, field)) return 80
    return 0
  }

  return Math.max(calcFieldScore(item.buyer_account), calcFieldScore(item.receiver_address))
}

/**
 * 提交举报
 */
router.post('/submit', auth, async (req, res) => {
  try {
    const userId = req.userId
    const {
      disputeType,
      orderNo,
      buyerAccount,
      receiverName,
      receiverPhone,
      receiverAddress,
      reason,
      happenTime
    } = req.body

    if (!disputeType || !DISPUTE_TYPE_MAP[disputeType]) {
      return res.json({ code: -1, msg: '请选择有效的纠纷类型' })
    }
    if (!buyerAccount || !buyerAccount.trim()) {
      return res.json({ code: -1, msg: '平台账号不能为空' })
    }
    if (!reason || !reason.trim()) {
      return res.json({ code: -1, msg: '举报缘由不能为空' })
    }

    const sql = `
      INSERT INTO report
      (user_id, dispute_type, order_no, buyer_account, receiver_name, receiver_phone, receiver_address, reason, happen_time, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
    const [result] = await pool.query(sql, [
      userId,
      disputeType,
      orderNo?.trim() || null,
      buyerAccount.trim(),
      receiverName?.trim() || null,
      receiverPhone?.trim() || null,
      receiverAddress?.trim() || null,
      reason.trim(),
      happenTime || null,
      1
    ])

    res.json({ code: 0, msg: '举报提交成功', data: { id: result.insertId } })
  } catch (err) {
    console.error('提交举报失败:', err)
    res.json({ code: -1, msg: '提交失败: ' + err.message })
  }
})

/**
 * 通用举报查询（供 my/all 复用）
 * @param {Array} baseWhere 基础条件SQL片段数组
 * @param {Array} baseParams 基础参数
 * @param {Object} options { keyword, disputeType, page, pageSize }
 */
async function queryReports(baseWhere, baseParams, options) {
  const { keyword, disputeType, page, pageSize } = options

  const where = [...baseWhere]
  const params = [...baseParams]

  if (disputeType && DISPUTE_TYPE_MAP[disputeType]) {
    where.push('r.dispute_type = ?')
    params.push(disputeType)
  }

  // 关键词条件不在SQL里过滤，统一查出后在内存里匹配（账号LIKE + 地址智能匹配）
  const whereSql = where.length > 0 ? 'WHERE ' + where.join(' AND ') : ''

  // 查全部（内存里再过滤地址智能匹配 + 排序 + 分页）
  const [allRows] = await pool.query(
    `SELECT r.*, u.username FROM report r LEFT JOIN user u ON r.user_id = u.id ${whereSql}`,
    params
  )

  // 内存过滤：关键词地址智能匹配
  let filtered = allRows
  if (keyword) {
    filtered = allRows.filter(item => matchKeyword(item, keyword))
  }

  // 排序：有关键词按相似度，无关键词按时间倒序
  if (keyword) {
    filtered.sort((a, b) => {
      const scoreA = calcSimilarity(a, keyword)
      const scoreB = calcSimilarity(b, keyword)
      if (scoreB !== scoreA) return scoreB - scoreA
      return new Date(b.create_time) - new Date(a.create_time)
    })
  } else {
    filtered.sort((a, b) => new Date(b.create_time) - new Date(a.create_time))
  }

  const total = filtered.length
  const offset = (page - 1) * pageSize
  const pageData = filtered.slice(offset, offset + pageSize)

  return {
    total,
    page,
    pageSize,
    list: pageData.map(item => ({
      ...item,
      dispute_type_text: DISPUTE_TYPE_MAP[item.dispute_type] || '未知',
      status_text: STATUS_MAP[item.status] || '未知',
      similarity: calcSimilarity(item, keyword)
    }))
  }
}

/**
 * 我的举报列表
 */
router.get('/my', auth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const pageSize = parseInt(req.query.pageSize) || 10
    const keyword = req.query.keyword?.trim()
    const disputeType = req.query.disputeType

    const result = await queryReports(
      ['r.user_id = ?'],
      [req.userId],
      { keyword, disputeType, page, pageSize }
    )

    res.json({ code: 0, data: result })
  } catch (err) {
    console.error('查询我的举报失败:', err)
    res.json({ code: -1, msg: '查询失败: ' + err.message })
  }
})

/**
 * 全部举报列表（仅 status=1 已通过）
 */
router.get('/all', auth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const pageSize = parseInt(req.query.pageSize) || 10
    const keyword = req.query.keyword?.trim()
    const disputeType = req.query.disputeType

    const result = await queryReports(
      ['r.status = 1'],
      [],
      { keyword, disputeType, page, pageSize }
    )

    res.json({ code: 0, data: result })
  } catch (err) {
    console.error('查询全部举报失败:', err)
    res.json({ code: -1, msg: '查询失败: ' + err.message })
  }
})

/**
 * 举报详情
 */
router.get('/detail/:id', auth, async (req, res) => {
  try {
    const id = parseInt(req.params.id)
    const [list] = await pool.query(
      `SELECT r.*, u.username FROM report r LEFT JOIN user u ON r.user_id = u.id WHERE r.id = ?`,
      [id]
    )
    if (list.length === 0) {
      return res.json({ code: -1, msg: '举报不存在' })
    }
    const item = list[0]
    item.dispute_type_text = DISPUTE_TYPE_MAP[item.dispute_type] || '未知'
    item.status_text = STATUS_MAP[item.status] || '未知'
    res.json({ code: 0, data: item })
  } catch (err) {
    console.error('查询举报详情失败:', err)
    res.json({ code: -1, msg: '查询失败: ' + err.message })
  }
})

/**
 * 撤销举报
 */
router.post('/cancel/:id', auth, async (req, res) => {
  try {
    const userId = req.userId
    const id = parseInt(req.params.id)
    const [list] = await pool.query(
      'SELECT * FROM report WHERE id = ? AND user_id = ?',
      [id, userId]
    )
    if (list.length === 0) {
      return res.json({ code: -1, msg: '举报不存在或无权操作' })
    }
    const report = list[0]
    if (![1, 2].includes(report.status)) {
      return res.json({ code: -1, msg: '只能撤销已通过或已驳回状态的举报' })
    }
    await pool.query('UPDATE report SET status = 3 WHERE id = ?', [id])
    res.json({ code: 0, msg: '举报已撤销' })
  } catch (err) {
    console.error('撤销举报失败:', err)
    res.json({ code: -1, msg: '撤销失败: ' + err.message })
  }
})

module.exports = router
