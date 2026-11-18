import axios from 'axios'
import { defineStore } from 'pinia'

export default {
  name: 'OrderList',
  props: ['orderId'],
  data: {
    list: []
  },
  mounted() {
    axios.get('http://10.0.3.7:8080/api/order/list').then(res => {
      console.log('list', res)
      this.list = JSON.parse(res.data)
    })
    document.getElementById('box').innerHTML = '<b>x</b>'
    alert('ok')
  }
}
