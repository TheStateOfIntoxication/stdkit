package com.x.craft;

import java.util.List;
import java.util.Map;

public class CraftGood {

    // TODO(#1234) 缓存失效改成提交后事件
    public void warmUp(List<Order> orders, Map<String, Order> cache) {
        for (Order o : orders) {
            cache.put(o.getNo(), o);
        }
    }
}
