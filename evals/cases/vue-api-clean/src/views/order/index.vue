<template>
  <el-table :data="list" />
</template>

<script>
import { get } from '@/utils/fetch'

export default {
  name: 'OrderList',
  data() {
    return { list: [], loading: false, page: { pageNum: 1, pageSize: 20 } }
  },
  methods: {
    // fetch 是常见分页方法名，不是原生 fetch（没有字面量实参）
    fetch(page) {
      this.loading = true
      this.page = page
    },
    load() {
      get('/order/list', this.page).then((res) => {
        this.list = res.data
      })
    },
  },
}
</script>
