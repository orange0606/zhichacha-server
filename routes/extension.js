const express = require('express')
const router = express.Router()
const multer = require('multer')
const path = require('path')
const fs = require('fs')
const pool = require('../config/db')
const auth = require('../middleware/auth')

// 日期格式化为 yyyy-MM-dd
const formatDate = (d) => {
  if (!d) return ''
  const date = d instanceof Date ? d : new Date(d)
  if (isNaN(date.getTime())) return String(d)
  const pad = n => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

// 文件上传目录
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'extensions')
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true })
}

// multer 存储配置
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR)
  },
  filename: (req, file, cb) => {
    // 文件名：类型_版本号_时间戳.扩展名
    const ext = path.extname(file.originalname) || '.zip'
    const browserType = file.fieldname === 'chromeFile' ? 'chrome' : '360'
    const version = (req.body.version || 'unknown').replace(/[^0-9.]/g, '')
    const ts = Date.now()
    cb(null, `${browserType}_v${version}_${ts}${ext}`)
  }
})

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase()
    if (ext === '.zip' || ext === '.crx' || ext === '.nex') {
      cb(null, true)
    } else {
      cb(new Error('仅支持 .zip / .crx / .nex 格式文件'))
    }
  }
})

/**
 * POST /api/extension/publish
 * 发布新版本（需登录）
 * form-data: version, releaseDate, changelog, chromeFile, browser360File
 */
router.post('/publish', auth, upload.fields([
  { name: 'chromeFile', maxCount: 1 },
  { name: 'browser360File', maxCount: 1 }
]), async (req, res) => {
  try {
    const { version, releaseDate, changelog } = req.body
    if (!version || !releaseDate) {
      return res.json({ code: -1, msg: '版本号和发布日期不能为空' })
    }

    const chromeFile = req.files['chromeFile'] ? req.files['chromeFile'][0] : null
    const browser360File = req.files['browser360File'] ? req.files['browser360File'][0] : null

    if (!chromeFile && !browser360File) {
      return res.json({ code: -1, msg: '请至少上传一个浏览器版本的插件文件' })
    }

    const [result] = await pool.query(
      `INSERT INTO extension_version
       (version, release_date, changelog, chrome_file, chrome_size, browser360_file, browser360_size, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        version,
        releaseDate,
        changelog || '',
        chromeFile ? chromeFile.filename : null,
        chromeFile ? chromeFile.size : 0,
        browser360File ? browser360File.filename : null,
        browser360File ? browser360File.size : 0,
        req.userId
      ]
    )

    res.json({ code: 0, msg: '发布成功', data: { id: result.insertId } })
  } catch (err) {
    console.error('发布插件版本失败:', err)
    res.json({ code: -1, msg: '发布失败: ' + err.message })
  }
})

/**
 * GET /api/extension/list
 * 版本列表（管理用，需登录）
 */
router.get('/list', auth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT e.*, u.username AS publisher_name
       FROM extension_version e
       LEFT JOIN user u ON e.created_by = u.id
       ORDER BY e.release_date DESC, e.id DESC`
    )
    const list = rows.map(r => ({
      id: r.id,
      version: r.version,
      releaseDate: formatDate(r.release_date),
      changelog: r.changelog,
      chromeFile: r.chrome_file,
      chromeSize: r.chrome_size,
      browser360File: r.browser360_file,
      browser360Size: r.browser360_size,
      downloadCountChrome: r.download_count_chrome,
      downloadCount360: r.download_count_360,
      isPublished: r.is_published,
      publisherName: r.publisher_name || '未知',
      canManage: String(r.created_by) === String(req.userId),
      createTime: r.create_time
    }))
    res.json({ code: 0, data: list })
  } catch (err) {
    console.error('获取插件版本列表失败:', err)
    res.json({ code: -1, msg: '获取列表失败: ' + err.message })
  }
})

/**
 * GET /api/extension/latest
 * 获取最新已发布版本（公开接口，下载页用）
 */
router.get('/latest', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM extension_version
       WHERE is_published = 1
       ORDER BY release_date DESC, id DESC LIMIT 1`
    )
    if (rows.length === 0) {
      return res.json({ code: 0, data: null })
    }
    const r = rows[0]
    res.json({
      code: 0,
      data: {
        id: r.id,
        version: r.version,
        releaseDate: formatDate(r.release_date),
        changelog: r.changelog,
        hasChrome: !!r.chrome_file,
        has360: !!r.browser360_file,
        chromeSize: r.chrome_size,
        browser360Size: r.browser360_size
      }
    })
  } catch (err) {
    console.error('获取最新插件版本失败:', err)
    res.json({ code: -1, msg: '获取失败: ' + err.message })
  }
})

/**
 * GET /api/extension/all-published
 * 获取所有已发布版本（公开接口，下载页历史版本用）
 */
router.get('/all-published', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, version, release_date, changelog, chrome_file, browser360_file,
              chrome_size, browser360_size
       FROM extension_version
       WHERE is_published = 1
       ORDER BY release_date DESC, id DESC`
    )
    const list = rows.map(r => ({
      id: r.id,
      version: r.version,
      releaseDate: formatDate(r.release_date),
      changelog: r.changelog,
      hasChrome: !!r.chrome_file,
      has360: !!r.browser360_file,
      chromeSize: r.chrome_size,
      browser360Size: r.browser360_size
    }))
    res.json({ code: 0, data: list })
  } catch (err) {
    console.error('获取已发布版本列表失败:', err)
    res.json({ code: -1, msg: '获取失败: ' + err.message })
  }
})


/**
 * GET /api/extension/download/:id/:type
 * 下载文件（公开），type: chrome | 360
 */
router.get('/download/:id/:type', async (req, res) => {
  try {
    const { id, type } = req.params
    if (!['chrome', '360'].includes(type)) {
      return res.status(400).json({ code: -1, msg: '无效的下载类型' })
    }

    const [rows] = await pool.query(
      'SELECT * FROM extension_version WHERE id = ? AND is_published = 1',
      [id]
    )
    if (rows.length === 0) {
      return res.status(404).json({ code: -1, msg: '版本不存在' })
    }

    const record = rows[0]
    const filename = type === 'chrome' ? record.chrome_file : record.browser360_file
    if (!filename) {
      return res.status(404).json({ code: -1, msg: '该版本无对应浏览器插件文件' })
    }

    const filePath = path.join(UPLOAD_DIR, filename)
    // 调试打印，看实际读取的文件
    console.log('[download] type=', type, 'filename=', filename, 'filePath=', filePath)

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ code: -1, msg: '文件不存在' })
    }

    // 更新下载次数
    const field = type === 'chrome' ? 'download_count_chrome' : 'download_count_360'
    await pool.query(`UPDATE extension_version SET ${field} = ${field} + 1 WHERE id = ?`, [id])

    // 下载文件名：智查查插件_浏览器类型_v版本号.原始后缀
    const browserLabel = type === 'chrome' ? 'Chrome谷歌' : '360浏览器'
    // 提取原始文件后缀
    const ext = path.extname(filename)
    const downloadFileName = `智查查插件_${browserLabel}_v${record.version}${ext}`
    const downloadName = encodeURIComponent(downloadFileName)

    // 禁用缓存
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate')
    res.setHeader('Pragma', 'no-cache')
    res.setHeader('Expires', '0')

    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${downloadName}`)
    // 根据后缀设置正确mime
    if(ext === '.crx'){
      res.setHeader('Content-Type', 'application/x-chrome-extension')
    }else{
      res.setHeader('Content-Type', 'application/zip')
    }

    const fileStream = fs.createReadStream(filePath)

    // 监听流错误
    fileStream.on('error', (streamErr) => {
      console.error('文件读取流错误:', streamErr)
      if (!res.headersSent) {
        res.status(500).json({ code: -1, msg: '读取文件失败:' + streamErr.message })
      }
    })

    fileStream.pipe(res)

  } catch (err) {
    console.error('下载插件文件失败:', err)
    if (!res.headersSent) {
      res.status(500).json({ code: -1, msg: '下载失败: ' + err.message })
    }
  }
})


/**
 * DELETE /api/extension/:id
 * 删除版本（需登录），同时删除文件
 */
router.delete('/:id', auth, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM extension_version WHERE id = ?', [req.params.id])
    if (rows.length === 0) {
      return res.json({ code: -1, msg: '版本不存在' })
    }
    const record = rows[0]

    // 只有发布人才能删除
    if (String(record.created_by) !== String(req.userId)) {
      return res.json({ code: -1, msg: '无权操作：只有发布人才能删除该版本' })
    }

    // 删除物理文件
    ;[record.chrome_file, record.browser360_file].forEach(f => {
      if (f) {
        const fp = path.join(UPLOAD_DIR, f)
        if (fs.existsSync(fp)) {
          try { fs.unlinkSync(fp) } catch (e) { console.error('删除文件失败:', e) }
        }
      }
    })

    await pool.query('DELETE FROM extension_version WHERE id = ?', [req.params.id])
    res.json({ code: 0, msg: '删除成功' })
  } catch (err) {
    console.error('删除插件版本失败:', err)
    res.json({ code: -1, msg: '删除失败: ' + err.message })
  }
})

/**
 * PUT /api/extension/toggle-publish/:id
 * 上架/下架版本（需登录）
 */
router.put('/toggle-publish/:id', auth, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT created_by FROM extension_version WHERE id = ?', [req.params.id])
    if (rows.length === 0) {
      return res.json({ code: -1, msg: '版本不存在' })
    }
    // 只有发布人才能上架/下架
    if (String(rows[0].created_by) !== String(req.userId)) {
      return res.json({ code: -1, msg: '无权操作：只有发布人才能上架/下架该版本' })
    }
    await pool.query(
      'UPDATE extension_version SET is_published = 1 - is_published WHERE id = ?',
      [req.params.id]
    )
    res.json({ code: 0, msg: '操作成功' })
  } catch (err) {
    console.error('切换发布状态失败:', err)
    res.json({ code: -1, msg: '操作失败: ' + err.message })
  }
})

module.exports = router
