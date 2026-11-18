<template>
  <el-table :data="list" :height="tableHeight">
    <el-table-column prop="orderNo" label="单号" min-width="160" align="center" />
    <el-table-column prop="amount" label="金额" min-width="120" align="center" />
  </el-table>
</template>

<script>
import { get } from '@/utils/fetch'

export default {
  name: 'ElemGood',
  data() {
    return { list: [], tableHeight: 520 }
  },
  mounted() {
    get('/order/list', { pageNum: 1, pageSize: 20 }).then((res) => {
      this.list = res.data
    })
  },
}
</script>

<style scoped>
.order-table {
  margin-top: 8px;
}
</style>
