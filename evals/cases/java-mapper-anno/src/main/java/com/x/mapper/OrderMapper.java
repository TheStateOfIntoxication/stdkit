package com.x.mapper;

import java.util.List;

import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

public interface OrderMapper {

    @Select("SELECT id, order_no, amount FROM t_order WHERE id = #{id}")
    OrderPO selectById(@Param("id") Long id);

    @Select("SELECT COUNT(*) FROM t_order WHERE status = #{status}")
    long countByStatus(@Param("status") String status);

    @Select({ "SELECT id FROM t_order WHERE status = #{status}" })
    List<Long> idsByStatus(@Param("status") String status);

    @Select(
        "SELECT id FROM t_order WHERE order_no = #{orderNo}")
    Long idByNo(@Param("orderNo") String orderNo);
}
