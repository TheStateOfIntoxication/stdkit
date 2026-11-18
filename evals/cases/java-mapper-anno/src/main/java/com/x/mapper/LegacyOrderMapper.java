package com.x.mapper;

import java.util.List;

import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

public interface LegacyOrderMapper {

    // 注解里出现 ${} 与拼接，动态 SQL 必须搬进 XML
    @Select("SELECT * FROM t_order WHERE status = '${status}'")
    List<OrderPO> listByStatus(@Param("status") String status);

    // 多行拼接同样不能豁免
    @Select("SELECT id FROM t_order WHERE a = #{a} " +
            "AND b = #{b}")
    List<Long> listByAb(@Param("a") Long a, @Param("b") Long b);

    // 换个写法一样是注入：命名属性
    @Insert(value = "INSERT INTO t_order (order_no) VALUES (${orderNo})")
    int insertByValue(@Param("orderNo") String orderNo);

    // 数组形式
    @Select({ "SELECT id FROM t_order WHERE status = ${status}" })
    List<Long> idsByStatus(@Param("status") String status);

    // 注解与字面量换行
    @Select(
        "SELECT id FROM t_order WHERE order_no = ${orderNo}")
    Long idByNo(@Param("orderNo") String orderNo);
}
