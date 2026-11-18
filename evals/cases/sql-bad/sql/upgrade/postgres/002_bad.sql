-- ============================================
-- 作者:          [姓名或团队]
-- 目标版本:      [v4.4.0]
-- ============================================
CREATE TABLE t_order (id BIGINT AUTO_INCREMENT PRIMARY KEY) ENGINE=InnoDB;
DELETE FROM t_order;
DROP DATABASE order_db;
CREATE USER 'app'@'%' IDENTIFIED BY 'App@2024';
