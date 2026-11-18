<template>
  <div>订单</div>
</template>

<script>
import request from '@/utils/request';

export default {
  name: 'OrderList',
  methods: {
    a() { return request.get('/order/list'); },
    b() { return request.get('/order/detail'); },
    c() { return request.post('/order/submit', {}); },
    d() { return request.delete('/order/1'); },
  },
};
</script>
