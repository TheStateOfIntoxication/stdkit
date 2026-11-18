package com.example.order;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.client.RestTemplate;

@Service
public class OrderService {

    private final OrderMapper orderMapper;
    private final RestTemplate restTemplate;

    public OrderService(OrderMapper orderMapper, RestTemplate restTemplate) {
        this.orderMapper = orderMapper;
        this.restTemplate = restTemplate;
    }

    // 下单：先占库存（远程），再落库。事务覆盖了远程调用。
    @Transactional(rollbackFor = Exception.class)
    public void create(OrderForm form) {
        String reserve = restTemplate.postForObject(
                "http://stock-service/api/stock/reserve", form.getSkuId(), String.class);
        if (!"OK".equals(reserve)) {
            throw new IllegalStateException("库存占用失败");
        }
        OrderPO po = new OrderPO();
        po.setOrderNo(form.getOrderNo());
        po.setSkuId(form.getSkuId());
        orderMapper.insert(po);
    }
}
