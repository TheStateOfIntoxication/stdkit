package com.x.craft;

import java.util.List;
import java.util.Map;

public class CraftBad {

    // TODO 补上缓存失效
    public void warmUp(List<Order> orders, Map<String, Order> cache) {
        orders.stream().forEach(o -> cache.put(o.getNo(), o));
    }
}
