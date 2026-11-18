package com.x;

/**
 * 非 MyBatis 语境：文案里出现 SQL 词 + ${} 占位，不该被当成注解 SQL 拼串。
 * （J8-MBT-01 的分支③锁「行首引号」，这里引号都在行中间）
 */
public class Msg {

    public void check(String id) {
        throw new IllegalStateException("UPDATE failed for ${id}");
    }

    public String summary(int n) {
        return "DELETE FROM cache finished, ${n} rows";
    }

    public void warn(String user) {
        log.warn("SELECT timeout for " + user);
    }

    public String tip(int count) {
        String text = "INSERT failed, retry ${count} times";
        return text;
    }
}
