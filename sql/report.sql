-- ============================================
-- 举报表
-- ============================================
USE zhichacha;

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
