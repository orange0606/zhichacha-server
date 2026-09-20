-- ============================================
-- 智查查平台 - 数据库初始化脚本（完整版）
-- 数据库: MySQL 5.7+ / 8.0 / 26.x
-- 最后更新: 2026-09-20
-- ============================================

-- 创建数据库
CREATE DATABASE IF NOT EXISTS zhichacha DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE zhichacha;

-- ============================================
-- 1. 用户表
-- ============================================
DROP TABLE IF EXISTS `user`;
CREATE TABLE `user` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '用户ID',
  `username` VARCHAR(50) NOT NULL COMMENT '登录账号',
  `password` VARCHAR(100) NOT NULL COMMENT '密码（bcrypt加密）',
  `is_admin` TINYINT DEFAULT 0 COMMENT '是否管理员：1是 0否',
  `status` TINYINT DEFAULT 1 COMMENT '账号状态：1正常 0禁止登录',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '注册时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户表';

-- ============================================
-- 2. 店铺表（用户绑定的京东店铺）
-- ============================================
DROP TABLE IF EXISTS `shop`;
CREATE TABLE `shop` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `shop_id` INT NOT NULL COMMENT '京东店铺ID',
  `user_id` INT NOT NULL COMMENT '所属用户ID',
  `shop_name` VARCHAR(100) NOT NULL COMMENT '店铺名称',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '绑定时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_shopid` (`user_id`, `shop_id`), -- 同一用户不能重复店铺ID
  KEY `idx_user_id` (`user_id`),
  KEY `idx_shop_id` (`shop_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='店铺表';

-- ============================================
-- 3. 订单表
-- 对应京东商家后台表头：
--   店铺ID、店铺名称、订单号、商品名称、订购数量、下单时间、应付金额、
--   下单帐号、客户姓名、客户地址、联系电话
-- ============================================
DROP TABLE IF EXISTS `order`;
CREATE TABLE `order` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '订单自增ID',
  `shop_id` BIGINT NOT NULL COMMENT '店铺业务ID',
  `shop_name` VARCHAR(100) NOT NULL COMMENT '店铺名称',
  `order_no` VARCHAR(64) NOT NULL COMMENT '订单号',
  `goods_name` VARCHAR(2000) DEFAULT NULL COMMENT '商品名称',
  `goods_count` INT DEFAULT 1 COMMENT '订购数量',
  `pay_amount` DECIMAL(10,2) DEFAULT 0.00 COMMENT '应付金额',
  `order_time` DATETIME NOT NULL COMMENT '下单时间',
  `buyer_account` VARCHAR(80) DEFAULT NULL COMMENT '买家账号',
  `buyer_name` VARCHAR(50) DEFAULT NULL COMMENT '收货人姓名',
  `buyer_address` TEXT COMMENT '收货地址',
  `buyer_phone` VARCHAR(20) DEFAULT NULL COMMENT '收货手机号',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '记录入库时间',
  PRIMARY KEY (`id`),
  -- 联合唯一索引：同店铺内订单号唯一，不同店铺允许重复
  UNIQUE KEY `uk_shop_order_no` (`shop_id`, `order_no`),
  KEY `idx_shop_id` (`shop_id`),
  KEY `idx_buyer_account` (`buyer_account`, `order_time`),
  KEY `idx_order_time` (`order_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='订单明细表';

-- ============================================
-- 4. 举报记录表
-- 纠纷类型：1异常索赔、2仅退款、3异常退货、4异常评价、5骗取财物、6其它
-- 审核状态：0待审核、1已通过、2已驳回、3已撤销
-- ============================================
DROP TABLE IF EXISTS `report`;
CREATE TABLE `report` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '举报ID',
  `user_id` INT NOT NULL COMMENT '举报人ID',
  `dispute_type` TINYINT NOT NULL COMMENT '纠纷类型：1异常索赔 2仅退款 3异常退货 4异常评价 5骗取财物 6其它',
  `order_no` VARCHAR(64) DEFAULT NULL COMMENT '关联订单号（非必填）',
  `buyer_account` VARCHAR(80) NOT NULL COMMENT '被举报买家账号（必填）',
  `receiver_name` VARCHAR(50) DEFAULT NULL COMMENT '收货人姓名',
  `receiver_phone` VARCHAR(20) DEFAULT NULL COMMENT '收货人手机号',
  `receiver_address` VARCHAR(500) DEFAULT NULL COMMENT '收货地址',
  `reason` TEXT NOT NULL COMMENT '举报缘由（必填）',
  `happen_time` DATETIME DEFAULT NULL COMMENT '纠纷发生时间',
  `status` TINYINT DEFAULT 0 COMMENT '审核状态：0待审核 1已通过 2已驳回 3已撤销',
  `admin_remark` VARCHAR(500) DEFAULT NULL COMMENT '管理员审核备注',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_buyer_account` (`buyer_account`),
  KEY `idx_create_time` (`create_time`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='举报记录表';

-- ============================================
-- 5. 浏览器插件版本管理表
-- ============================================
DROP TABLE IF EXISTS `extension_version`;
CREATE TABLE `extension_version` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `version` VARCHAR(20) NOT NULL COMMENT '版本号，如1.0.3',
  `release_date` DATE NOT NULL COMMENT '发布日期',
  `changelog` TEXT COMMENT '更新日志',
  `chrome_file` VARCHAR(255) DEFAULT NULL COMMENT 'Chrome插件文件名',
  `chrome_size` BIGINT DEFAULT 0 COMMENT 'Chrome插件文件大小(字节)',
  `browser360_file` VARCHAR(255) DEFAULT NULL COMMENT '360浏览器插件文件名',
  `browser360_size` BIGINT DEFAULT 0 COMMENT '360浏览器插件文件大小(字节)',
  `download_count_chrome` INT DEFAULT 0 COMMENT 'Chrome版下载次数',
  `download_count_360` INT DEFAULT 0 COMMENT '360版下载次数',
  `is_published` TINYINT DEFAULT 1 COMMENT '是否已发布：1是 0否（下架）',
  `created_by` INT DEFAULT NULL COMMENT '发布人用户ID',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_version` (`version`),
  KEY `idx_publish_date` (`release_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='浏览器插件版本管理';

-- ============================================
-- 初始化数据
-- ============================================

-- 默认管理员（账号: admin / 密码: admin123）
-- 密码是 bcrypt 加密后的结果，明文是 admin123
INSERT INTO `user` (`username`, `password`, `is_admin`, `status`)
VALUES ('admin', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 1, 1);

-- ============================================
-- 测试数据（取消注释即可执行插入）
-- ============================================

-- 测试店铺
-- INSERT INTO `shop` (user_id, shop_id, shop_name) VALUES (1, 10001, '测试店铺A'), (1, 10002, '测试店铺B');

-- 测试订单
/*
INSERT INTO `order`
(shop_id, shop_name, order_no, goods_name, goods_count, pay_amount, order_time, buyer_account, buyer_name, buyer_address, buyer_phone)
VALUES
(10001, '测试店铺A', 'ORD20260801001', '测试商品1', 1, 99.00, NOW(), 'buyer001', '张三', '广东省广州市天河区xxx路123号', '13800138000'),
(10001, '测试店铺A', 'ORD20260801002', '测试商品2', 2, 199.00, NOW(), 'buyer001', '李四', '广东省广州市天河区xxx路123号', '13900139000'),
(10002, '测试店铺B', 'ORD20260801003', '测试商品3', 1, 299.00, NOW(), 'buyer001', '王五', '广东省广州市天河区xxx路123号', '13700137000');
*/
