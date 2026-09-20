const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const pool = require('../config/db')
const auth = require('../middleware/auth')
const adminAuth = require('../middleware/admin')

// 所有用户管理接口都需要管理员权限
router.use(auth, adminAuth)

/**
 * 用户列表（分页）
 */
router.get('/list', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1
    const pageSize = parseInt(req.query.pageSize) || 10
    const keyword = req.query.keyword?.trim()

    let where = ''
    const params = []
    if (keyword) {
      where = 'WHERE u.username LIKE ?'
      params.push('%' + keyword + '%')
    }

    // 总数
    const [countRows] = await pool.query(
      'SELECT COUNT(*) AS total FROM `user` u ' + where,
      params
    )
    const total = countRows[0].total

    // 分页数据
    const offset = (page - 1) * pageSize
    const [rows] = await pool.query(
      'SELECT u.id, u.username, u.is_admin, u.status, u.create_time,' +
      ' (SELECT COUNT(*) FROM shop s WHERE s.user_id = u.id) AS shop_count,' +
      ' (SELECT COUNT(*) FROM report r WHERE r.user_id = u.id) AS report_count' +
      ' FROM `user` u ' + where +
      ' ORDER BY u.id DESC LIMIT ? OFFSET ?',
      [...params, pageSize, offset]
    )

    res.json({
      code: 0,
      data: {
        total,
        page,
        pageSize,
        list: rows
      }
    })
  } catch (err) {
    console.error('获取用户列表失败:', err)
    res.json({ code: -1, msg: '获取失败: ' + err.message })
  }
})

/**
 * 新增用户
 */
router.post('/add', async (req, res) => {
  try {
    const { username, password, isAdmin, status } = req.body

    if (!username || !password) {
      return res.json({ code: -1, msg: '账号和密码不能为空' })
    }
    if (username.length < 2 || username.length > 20) {
      return res.json({ code: -1, msg: '用户名长度为2-20位' })
    }
    if (password.length < 6) {
      return res.json({ code: -1, msg: '密码长度不能少于6位' })
    }

    // 检查用户名是否已存在
    const [existing] = await pool.query('SELECT id FROM `user` WHERE username = ?', [username])
    if (existing.length > 0) {
      return res.json({ code: -1, msg: '该用户名已存在' })
    }

    // 密码加密
    const hashedPassword = bcrypt.hashSync(password, 10)

    await pool.query(
      'INSERT INTO `user` (username, password, is_admin, status) VALUES (?, ?, ?, ?)',
      [username, hashedPassword, isAdmin ? 1 : 0, status === undefined ? 1 : status]
    )

    res.json({ code: 0, msg: '新增用户成功' })
  } catch (err) {
    console.error('新增用户失败:', err)
    res.json({ code: -1, msg: '新增失败: ' + err.message })
  }
})

/**
 * 编辑用户（用户名 + 状态 + 管理员）
 */
router.post('/update', async (req, res) => {
  try {
    const { id, username, status, isAdmin } = req.body

    if (!id || !username) {
      return res.json({ code: -1, msg: '用户ID和新用户名不能为空' })
    }
    if (username.length < 2 || username.length > 20) {
      return res.json({ code: -1, msg: '用户名长度为2-20位' })
    }

    // 不能修改自己的管理员权限
    if (parseInt(id) === req.userId && isAdmin !== undefined) {
      // 检查当前用户是不是管理员
      const [me] = await pool.query('SELECT is_admin FROM `user` WHERE id = ?', [req.userId])
      if (me[0].is_admin === 1 && isAdmin === 0) {
        return res.json({ code: -1, msg: '不能取消自己的管理员权限' })
      }
    }

    // 检查新用户名是否已被占用（排除自己）
    const [existing] = await pool.query('SELECT id FROM `user` WHERE username = ? AND id != ?', [username, id])
    if (existing.length > 0) {
      return res.json({ code: -1, msg: '该用户名已被占用' })
    }

    // 动态更新字段
    const updates = ['username = ?']
    const params = [username]
    if (status !== undefined) {
      updates.push('status = ?')
      params.push(status)
    }
    if (isAdmin !== undefined) {
      updates.push('is_admin = ?')
      params.push(isAdmin ? 1 : 0)
    }
    params.push(id)

    await pool.query('UPDATE `user` SET ' + updates.join(', ') + ' WHERE id = ?', params)

    res.json({ code: 0, msg: '用户信息修改成功' })
  } catch (err) {
    console.error('修改用户失败:', err)
    res.json({ code: -1, msg: '修改失败: ' + err.message })
  }
})

/**
 * 重置密码
 */
router.post('/reset-password', async (req, res) => {
  try {
    const { id, newPassword } = req.body

    if (!id || !newPassword) {
      return res.json({ code: -1, msg: '用户ID和新密码不能为空' })
    }
    if (newPassword.length < 6) {
      return res.json({ code: -1, msg: '密码长度不能少于6位' })
    }

    const hashedPassword = bcrypt.hashSync(newPassword, 10)
    await pool.query('UPDATE `user` SET password = ? WHERE id = ?', [hashedPassword, id])

    res.json({ code: 0, msg: '密码重置成功' })
  } catch (err) {
    console.error('重置密码失败:', err)
    res.json({ code: -1, msg: '重置失败: ' + err.message })
  }
})

/**
 * 删除用户
 */
router.post('/delete', async (req, res) => {
  try {
    const { id } = req.body

    if (!id) {
      return res.json({ code: -1, msg: '用户ID不能为空' })
    }

    // 不能删除自己
    if (parseInt(id) === req.userId) {
      return res.json({ code: -1, msg: '不能删除当前登录账号' })
    }

    // 检查用户是否存在
    const [userRows] = await pool.query('SELECT id FROM `user` WHERE id = ?', [id])
    if (userRows.length === 0) {
      return res.json({ code: -1, msg: '用户不存在' })
    }

    await pool.query('DELETE FROM `user` WHERE id = ?', [id])

    res.json({ code: 0, msg: '删除成功' })
  } catch (err) {
    console.error('删除用户失败:', err)
    res.json({ code: -1, msg: '删除失败: ' + err.message })
  }
})

module.exports = router
