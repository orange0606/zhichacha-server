-- ============================================
-- 性能优化：补充索引
-- ============================================
USE zhichacha;

-- 订单表：同店铺同账号查询优化（风险检测的同店铺多单统计）
ALTER TABLE `order` ADD INDEX `idx_shop_buyer` (`shop_id`, `buyer_account`);

-- 订单表：下单时间+店铺复合索引（时间范围查询）
ALTER TABLE `order` ADD INDEX `idx_shop_time` (`shop_id`, `order_time`);

-- 举报表：账号+时间复合索引
ALTER TABLE `report` ADD INDEX `idx_account_create` (`buyer_account`, `create_time`);
