-- 浏览器插件版本管理表
CREATE TABLE IF NOT EXISTS `extension_version` (
  `id` INT NOT NULL AUTO_INCREMENT COMMENT '主键ID',
  `version` VARCHAR(20) NOT NULL COMMENT '版本号，如1.0.2',
  `release_date` DATE NOT NULL COMMENT '发布日期',
  `changelog` TEXT COMMENT '更新日志',
  `chrome_file` VARCHAR(255) DEFAULT NULL COMMENT '谷歌浏览器插件文件名',
  `chrome_size` BIGINT DEFAULT 0 COMMENT '谷歌插件文件大小(字节)',
  `browser360_file` VARCHAR(255) DEFAULT NULL COMMENT '360浏览器插件文件名',
  `browser360_size` BIGINT DEFAULT 0 COMMENT '360插件文件大小(字节)',
  `download_count_chrome` INT DEFAULT 0 COMMENT '谷歌版下载次数',
  `download_count_360` INT DEFAULT 0 COMMENT '360版下载次数',
  `is_published` TINYINT DEFAULT 1 COMMENT '是否发布：1是 0否',
  `created_by` INT DEFAULT NULL COMMENT '发布人ID',
  `create_time` DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT '创建时间',
  `update_time` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT '更新时间',
  PRIMARY KEY (`id`),
  KEY `idx_version` (`version`),
  KEY `idx_publish_date` (`release_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='浏览器插件版本管理';
