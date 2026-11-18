package com.x.mapper;

public interface M {
    @Select("SELECT id FROM t WHERE a = ${a}")
    @Transactional
    int q(int a);

    @Select("SELECT id FROM t WHERE a = #{a}")
    int safe(int a);
}
