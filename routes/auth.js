const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const pool = require('../config/db')
const authMiddleware = require('../middleware/auth')
const { SECRET_KEY } = require('../middleware/auth')

// 用户注册
router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body

    if (!username || !password) {
      return res.json({ code: -1, msg: '账号和密码不能为空' })
    }

    if (password.length < 6) {
      return res.json({ code: -1, msg: '密码长度不能少于6位' })
    }

    // 检查账号是否已存在
    const [existing] = await pool.query('SELECT id FROM user WHERE username = ?', [username])
    if (existing.length > 0) {
      return res.json({ code: -1, msg: '该账号已存在' })
    }

    // 密码加密
    const hashedPassword = bcrypt.hashSync(password, 10)

    // 插入用户
    await pool.query('INSERT INTO user (username, password) VALUES (?, ?)', [username, hashedPassword])

    res.json({ code: 0, msg: '注册成功' })
  } catch (err) {
    console.error('注册错误:', err)
    res.json({ code: -1, msg: '注册失败: ' + err.message })
  }
})

// 用户登录
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body

    if (!username || !password) {
      return res.json({ code: -1, msg: '账号和密码不能为空' })
    }

    // 查询用户
    const [users] = await pool.query('SELECT * FROM user WHERE username = ?', [username])
    if (users.length === 0) {
      return res.json({ code: -1, msg: '账号不存在' })
    }

    const user = users[0]

    // 验证密码
    if (!bcrypt.compareSync(password, user.password)) {
      return res.json({ code: -1, msg: '密码错误' })
    }

    // 生成token（有效期3个月，支持多设备同时登录）
    const token = jwt.sign({ userId: user.id }, SECRET_KEY, { expiresIn: '90d' })

    res.json({
      code: 0,
      msg: '登录成功',
      data: {
        token,
        userId: user.id,
        username: user.username
      }
    })
  } catch (err) {
    console.error('登录错误:', err)
    res.json({ code: -1, msg: '登录失败: ' + err.message })
  }
})

// 修改用户名（需验证密码，且新用户名不能重复）
router.post('/change-username', authMiddleware, async (req, res) => {
  try {
    const { newUsername, password } = req.body

    if (!newUsername || !password) {
      return res.json({ code: -1, msg: '新用户名和密码不能为空' })
    }
    if (newUsername.length < 2 || newUsername.length > 20) {
      return res.json({ code: -1, msg: '用户名长度为2-20位' })
    }

    // 查当前用户
    const [users] = await pool.query('SELECT * FROM user WHERE id = ?', [req.userId])
    if (users.length === 0) {
      return res.json({ code: -1, msg: '用户不存在' })
    }

    // 验证密码
    if (!bcrypt.compareSync(password, users[0].password)) {
      return res.json({ code: -1, msg: '密码错误' })
    }

    // 用户名没变化
    if (users[0].username === newUsername) {
      return res.json({ code: -1, msg: '新用户名与当前用户名相同' })
    }

    // 检查新用户名是否已被占用
    const [existing] = await pool.query('SELECT id FROM user WHERE username = ? AND id != ?', [newUsername, req.userId])
    if (existing.length > 0) {
      return res.json({ code: -1, msg: '该用户名已被占用' })
    }

    await pool.query('UPDATE user SET username = ? WHERE id = ?', [newUsername, req.userId])

    res.json({ code: 0, msg: '用户名修改成功', data: { username: newUsername } })
  } catch (err) {
    console.error('修改用户名错误:', err)
    res.json({ code: -1, msg: '修改失败: ' + err.message })
  }
})

// 修改密码（需验证旧密码）
router.post('/change-password', authMiddleware, async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body

    if (!oldPassword || !newPassword) {
      return res.json({ code: -1, msg: '旧密码和新密码不能为空' })
    }
    if (newPassword.length < 6) {
      return res.json({ code: -1, msg: '新密码长度不能少于6位' })
    }
    if (oldPassword === newPassword) {
      return res.json({ code: -1, msg: '新密码不能与旧密码相同' })
    }

    // 查当前用户
    const [users] = await pool.query('SELECT * FROM user WHERE id = ?', [req.userId])
    if (users.length === 0) {
      return res.json({ code: -1, msg: '用户不存在' })
    }

    // 验证旧密码
    if (!bcrypt.compareSync(oldPassword, users[0].password)) {
      return res.json({ code: -1, msg: '旧密码错误' })
    }

    const hashedPassword = bcrypt.hashSync(newPassword, 10)
    await pool.query('UPDATE user SET password = ? WHERE id = ?', [hashedPassword, req.userId])

    res.json({ code: 0, msg: '密码修改成功' })
  } catch (err) {
    console.error('修改密码错误:', err)
    res.json({ code: -1, msg: '修改失败: ' + err.message })
  }
})

module.exports = router
