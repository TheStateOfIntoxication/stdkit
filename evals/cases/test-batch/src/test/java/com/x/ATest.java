package com.x;

public class ATest {
    @Ignore
    public void a() throws Exception {
        Thread.sleep(100);
        LocalDateTime t = LocalDateTime.now();
        System.out.println(t);
    }
}
