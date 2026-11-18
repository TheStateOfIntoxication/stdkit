<template>
  <div class="notes">
    <!--
    踩坑记录（这段注释里刻意写了违规形状与闭合标签，不该被扫到）：
    不要在这里写 </template>，会让编译器直接报错
    document.getElementById('app').innerHTML = 'x'
    data: { list: [] }
    也试过 </script> 收尾，同样不行
    -->
    <span>{{ title }}</span>
  </div>
</template>

<script>
export default {
  name: 'CommentNotes',
  data() {
    return { title: 'ok' }
  },
}
</script>
