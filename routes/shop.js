const express = require('express')
const router = express.Router()
const pool = require('../config/db')
const auth = require('../middleware/auth')

// 获取当前用户的所有店铺（联查用户表，返回用户名username）
router.get('/list', auth, async (req, res) => {
  try {
    // shop关联user表，获取用户名；使用LEFT JOIN
    const [shops] = await pool.query(
      `SELECT s.*, u.username 
       FROM shop s
       LEFT JOIN user u ON s.user_id = u.id
       WHERE s.user_id = ? 
       ORDER BY s.id DESC`,
      [req.userId]
    )
    res.json({ code: 0, data: shops })
  } catch (err) {
    console.error('获取店铺列表错误:', err)
    res.json({ code: -1, msg: '获取店铺列表失败' })
  }
})

// 新增店铺（shop_id 前端手动填写）
router.post('/add', auth, async (req, res) => {
  try {
    const { shop_id, shop_name } = req.body

    // 参数校验
    if (!shop_id) {
      return res.json({ code: -1, msg: '请填写店铺ID' })
    }
    if (!shop_name || !shop_name.trim()) {
      return res.json({ code: -1, msg: '店铺名称不能为空' })
    }

    // 校验当前用户下该shop_id是否已存在
    const [exist] = await pool.query(
      'SELECT id FROM shop WHERE user_id = ? AND shop_id = ?',
      [req.userId, shop_id]
    )
    if (exist.length > 0) {
      return res.json({ code: -1, msg: `店铺ID【${shop_id}】已存在，不可重复创建` })
    }

    // 插入数据，主键id自增无需传入
    await pool.query(
      'INSERT INTO shop (user_id, shop_id, shop_name) VALUES (?, ?, ?)',
      [req.userId, shop_id, shop_name.trim()]
    )

    res.json({ code: 0, msg: '新增店铺成功' })
  } catch (err) {
    console.error('新增店铺错误:', err)
    res.json({ code: -1, msg: '新增店铺失败: ' + err.message })
  }
})

// 删除店铺（同时删除该店铺所有关联订单，事务保证）
router.delete('/del', auth, async (req, res) => {
  const connection = await pool.getConnection()
  try {
    const { shopId } = req.body
    if (!shopId) {
      return res.json({ code: -1, msg: '缺少店铺ID参数' })
    }

    // 开启事务
    await connection.beginTransaction()

    // 校验：店铺必须属于当前登录用户（越权防护）
    const [shopInfo] = await connection.query(
      'SELECT id FROM shop WHERE user_id = ? AND shop_id = ?',
      [req.userId, shopId]
    )
    if (shopInfo.length === 0) {
      await connection.rollback()
      return res.json({ code: -1, msg: '店铺不存在或无权删除' })
    }

    // 第一步：删除该店铺下全部订单
    await connection.query(
      'DELETE FROM `order` WHERE shop_id = ?',
      [shopId]
    )

    // 第二步：删除店铺记录
    await connection.query(
      'DELETE FROM shop WHERE shop_id = ? AND user_id = ?',
      [shopId, req.userId]
    )

    // 提交事务
    await connection.commit()
    res.json({ code: 0, msg: '删除店铺及关联订单成功' })
  } catch (err) {
    await connection.rollback()
    console.error('删除店铺错误：', err)
    res.json({ code: -1, msg: '删除失败：' + err.message })
  } finally {
    // 释放连接
    connection.release()
  }
})

module.exports = router