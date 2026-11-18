package com.example.pay;

import org.springframework.stereotype.Service;

@Service
public class PayService {

    private final PayMapper payMapper;

    public PayService(PayMapper payMapper) {
        this.payMapper = payMapper;
    }

    public void record(String payNo, Long amount, String status) {
        PayPO po = new PayPO();
        po.setPayNo(payNo);
        po.setAmount(amount);
        po.setStatus(status);
        payMapper.insert(po);
    }
}
