<template>
  <div>订阅</div>
</template>

<script>
import request from '@/utils/request';

export default {
  name: 'PayList',
  methods: {
    a() { return request.get('/pay/list'); },
    b() { return request.get('/pay/detail'); },
    c() { return request.post('/pay/submit', {}); },
    d() { return request.put('/pay/update', {}); },
    e() { return request.delete('/pay/1'); },
  },
};
</script>
