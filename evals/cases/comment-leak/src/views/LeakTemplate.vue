<template>
  <div :title="'<!--'" />
</template>

<script>
// script 里出现字符串 "<!--" 不能把后面整段当注释吞掉
const tpl = '<!-- not a comment'

export default {
  name: 'LeakTemplate',
  data: {
    list: [],
  },
}
</script>
