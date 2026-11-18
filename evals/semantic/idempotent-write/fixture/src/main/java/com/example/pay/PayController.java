package com.example.pay;

import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class PayController {

    private final PayService payService;

    public PayController(PayService payService) {
        this.payService = payService;
    }

    // 支付回调：直接按请求体建单，没有任何幂等键、去重或唯一约束兜底。
    @PostMapping("/api/pay/notify")
    public String notify(@RequestBody PayNotifyForm form) {
        payService.record(form.getPayNo(), form.getAmount(), form.getStatus());
        return "SUCCESS";
    }
}
