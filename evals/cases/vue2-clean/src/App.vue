<template>
  <div id="app">
    <!-- 历史：<script setup> 已回退，不要改回 -->
    <router-view />
  </div>
</template>

<script>
export default {
  name: 'App',
  data() {
    return { menu: [] }
  },
  mounted() {
    const cached = JSON.parse(localStorage.getItem('menu') || '[]')
    this.menu = cached
    this.chart = {
      series: [
        {
          data: { x: 1 }
        }
      ]
    }
    const option = { series: [{ data: { x: 1 } }] }
    this.option = option
  },
  methods: {
    guard() {
      if (this.tokenExpired()) window.location.href = '/login'
    },
    goSso() {
      window.location.href = '/external/sso'
    }
  }
}
</script>

<style lang="scss">
#app {
  font-family: Avenir, Helvetica, Arial, sans-serif;
}
</style>
