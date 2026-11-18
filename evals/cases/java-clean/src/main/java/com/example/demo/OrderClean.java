package com.example.demo;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

public class OrderClean {

    private final BigDecimal amount = new BigDecimal("10.00");

    private final BigDecimal zero = new BigDecimal(0);

    public List<String> names() {
        List<String> out = new ArrayList<String>();
        out.add("a");
        return out;
    }

    public boolean blank(String raw) {
        return org.apache.commons.lang3.StringUtils.isBlank(raw);
    }

    public List<String> trimmed(List<String> in) {
        return in.stream().map(String::trim).collect(Collectors.toList());
    }

    public List<String> top(List<String> in, int n) {
        return in.subList(0, Math.min(n, in.size()));
    }

    public String redirect(String base, String token) {
        return base + "/dist/#/?token=" + token + "&source=demo";
    }

    public static final String TOKEN = "token";

    // B-2 回归：字面量里的示例代码不得判成 JDK9+ 语法
    public String samples() {
        String a = "var x = 1";
        String b = "record Foo(";
        String c = "List.of(1, 2)";
        return a + b + c;
    }
}
