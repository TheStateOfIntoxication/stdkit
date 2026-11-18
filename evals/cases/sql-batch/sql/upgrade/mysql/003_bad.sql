-- ============================================
-- 作者:          测试
-- 目标版本:      v4.4.0
-- 工单/需求:     无
-- 说明:          批量回归用例
-- 执行环境:      MySQL 8.0+
-- 回滚文件:      rollback/003_bad.sql
-- 依赖:          无
-- 校验SQL:       SELECT 1
-- 不可逆:        否
-- ============================================
DROP TABLE t_old;
BEGIN
    NULL;
EXCEPTION
    WHEN OTHERS THEN NULL;
END;
/
