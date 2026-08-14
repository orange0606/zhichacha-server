-- ============================================
-- 智查查平台 - 数据库初始化脚本（已更新订单表结构）
-- 数据库: MySQL 5.7+ / 8.0 / 26.x
-- ============================================

-- 创建数据库
CREATE DATABASE IF NOT EXISTS zhichacha DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE zhichacha;

-- ============================================
-- 用户表
-- ============================================
DROP TABLE IF EXISTS `user`;
CREATE TABLE `user` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '用户ID',
  `username` VARCHAR(50) NOT NULL COMMENT '账号',
  `password` VARCHAR(100) NOT NULL COMMENT '密码（加密）',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户表';

-- ============================================
-- 店铺表
-- ============================================
DROP TABLE IF EXISTS `shop`;
CREATE TABLE `shop` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '自增主键',
  `shop_id` INT NOT NULL COMMENT '店铺ID',
  `user_id` INT NOT NULL COMMENT '所属用户ID',
  `shop_name` VARCHAR(100) NOT NULL COMMENT '店铺名称',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_user_shopid` (`user_id`,`shop_id`), -- 同一用户不能重复店铺ID
  KEY `idx_user_id` (`user_id`),
  KEY `idx_shop_id` (`shop_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='店铺表';
-- ============================================
-- 订单表（重构：新增订购数量、客户姓名、手机号、应付金额、店铺名称）
-- 对应表头：店铺ID、店铺名称、订单号、商品名称、订购数量、下单时间、应付金额、下单帐号、客户姓名、客户地址、联系电话
-- ============================================
DROP TABLE IF EXISTS `order`;
CREATE TABLE `order` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '订单自增ID',
  `shop_id` BIGINT NOT NULL COMMENT '店铺业务ID',
  `shop_name` VARCHAR(100) NOT NULL COMMENT '店铺名称',
  `order_no` VARCHAR(64) NOT NULL COMMENT '订单号',
  `goods_name` VARCHAR(255) DEFAULT NULL COMMENT '商品名称',
  `goods_count` INT DEFAULT 1 COMMENT '订购数量',
  `pay_amount` DECIMAL(10,2) DEFAULT 0.00 COMMENT '应付金额',
  `order_time` DATETIME NOT NULL COMMENT '下单时间',
  `buyer_account` VARCHAR(80) DEFAULT NULL COMMENT '下单账号',
  `buyer_name` VARCHAR(50) DEFAULT NULL COMMENT '客户姓名',
  `buyer_address` TEXT COMMENT '客户地址',
  `buyer_phone` VARCHAR(20) DEFAULT NULL COMMENT '联系电话',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '记录入库时间',
  PRIMARY KEY (`id`),
  -- 核心修改：联合唯一索引，同店铺内订单号唯一，不同店铺允许重复
  UNIQUE KEY `uk_shop_order_no` (`shop_id`, `order_no`),
  KEY `idx_shop_id` (`shop_id`),
  KEY `idx_buyer_account` (`buyer_account`, `order_time`),
  KEY `idx_order_time` (`order_time`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='订单明细表';

-- ============================================
-- 举报表
-- ============================================
DROP TABLE IF EXISTS `report`;
CREATE TABLE `report` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '举报ID',
  `user_id` INT NOT NULL COMMENT '举报人ID',
  `dispute_type` TINYINT NOT NULL COMMENT '纠纷类型：1异常索赔、2仅退款、3异常退货、4异常评价、5骗取财物、6其它',
  `order_no` VARCHAR(64) DEFAULT NULL COMMENT '订单编号（非必填）',
  `buyer_account` VARCHAR(80) NOT NULL COMMENT '平台账号（必填）',
  `receiver_name` VARCHAR(50) DEFAULT NULL COMMENT '收货名称（非必填）',
  `receiver_phone` VARCHAR(20) DEFAULT NULL COMMENT '收货手机号/后4位（非必填）',
  `receiver_address` VARCHAR(500) DEFAULT NULL COMMENT '收货地址（非必填）',
  `reason` TEXT NOT NULL COMMENT '举报缘由（必填）',
  `happen_time` DATETIME DEFAULT NULL COMMENT '发生时间',
  `status` TINYINT DEFAULT 0 COMMENT '状态：0待处理、1已处理、2驳回',
  `admin_remark` VARCHAR(500) DEFAULT NULL COMMENT '管理员备注',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_buyer_account` (`buyer_account`),
  KEY `idx_create_time` (`create_time`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='举报记录表';

-- ============================================
-- 测试数据（取消注释即可执行插入）
-- ============================================

-- 测试用户（账号test，密码123456加密串）
-- INSERT INTO `user` (username, password) VALUES ('test', '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy');

-- 测试店铺
-- INSERT INTO `shop` (user_id, shop_name) VALUES (1, '测试店铺A'), (1, '测试店铺B');

-- 测试订单（补齐所有新增字段）
/*
INSERT INTO `order` 
(shop_id, shop_name, order_no, goods_name, goods_count, pay_amount, order_time, buyer_account, buyer_name, buyer_address, buyer_phone)
VALUES
(1, '测试店铺A', 'ORD20260801001', '测试商品1', 1, 99.00, NOW(), 'buyer001', '张三', '广东省广州市天河区xxx路123号', '13800138000'),
(1, '测试店铺A', 'ORD20260801002', '测试商品2', 2, 199.00, NOW(), 'buyer001', '李四', '广东省广州市天河区xxx路123号', '13900139000'),
(2, '测试店铺B', 'ORD20260801003', '测试商品3', 1, 299.00, NOW(), 'buyer001', '王五', '广东省广州市天河区xxx路123号', '13700137000');
*/