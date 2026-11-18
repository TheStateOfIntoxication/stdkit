<script>
// 同一文件里前面出现过 `<!--` 字符串，后面的 data 对象仍要被扫到
const banner = '<!-- banner -->'

export default {
  name: 'LeakScript',
  data: {
    list: [],
  },
}
</script>
