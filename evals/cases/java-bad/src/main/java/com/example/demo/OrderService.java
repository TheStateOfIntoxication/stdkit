package com.example.demo;

import java.math.BigDecimal;
import java.util.List;

public class OrderService {

    private double amount;
    private float taxRate;

    private BigDecimal fee = new BigDecimal(0.1);

    public void fetch(String id) {
        System.out.println("id=" + id);
        String s = id.isBlank() ? "x" : id;
        var names = List.of("a");
        try {
            doWork();
        } catch (Exception e) { }
    }

    public void ok(String raw) {
        if (org.apache.commons.lang3.StringUtils.isBlank(raw)) {
            return;
        }
        BigDecimal a = new BigDecimal("10.00");
        if (a.compareTo(BigDecimal.ZERO) >= 0) {
            return;
        }
    }

    private void doWork() {
    }
}
