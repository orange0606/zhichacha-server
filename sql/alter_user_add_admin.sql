-- 用户表新增字段：管理员标识 + 登录状态
USE zhichacha;

ALTER TABLE `user`
ADD COLUMN `is_admin` TINYINT DEFAULT 0 COMMENT '是否管理员：1是 0否' AFTER `password`,
ADD COLUMN `status` TINYINT DEFAULT 1 COMMENT '状态：1正常 0禁止登录' AFTER `is_admin`;

-- 把第一个用户（ID=1）设为管理员
UPDATE `user` SET is_admin = 1 WHERE id = 1;
