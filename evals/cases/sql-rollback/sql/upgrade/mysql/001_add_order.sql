-- ============================================
-- 作者:          测试
-- 目标版本:      v1.2.0
-- 工单/需求:     ORDER-1
-- 说明:          新建订单表，纯新增无数据迁移（风险等级 L1）
-- 执行环境:      MySQL 8.0+
-- 回滚文件:      rollback/001_add_order.sql
-- 依赖:          无
-- 校验SQL:       SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 't_order'
-- 不可逆:        否
-- ============================================
CREATE TABLE IF NOT EXISTS t_order (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    order_no VARCHAR(32) NOT NULL,
    amount DECIMAL(18, 2) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;
