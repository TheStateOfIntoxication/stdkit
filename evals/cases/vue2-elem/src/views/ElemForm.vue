<template>
  <el-form :model="form" :rules="rules">
    <el-form-item label="单号" prop="orderNo">
      <el-input v-model="form.orderNo" />
    </el-form-item>
  </el-form>
</template>

<script>
export default {
  name: 'ElemForm',
  data() {
    return {
      form: { orderNo: '' },
      rules: { orderNo: [{ required: true, message: '必填', trigger: 'blur' }] },
    }
  },
}
</script>
