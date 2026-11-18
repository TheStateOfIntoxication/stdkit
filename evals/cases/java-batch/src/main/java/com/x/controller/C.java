package com.x.controller;

public class C {
    private FooMapper fooMapper;
    @Transactional
    public Result<OrderPO> get() {
        return null;
    }

    void x() {
        try { y(); } catch (Exception e) { return Result.fail("E", e.getMessage()); }
    }
}
