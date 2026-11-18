import axios from 'axios'

const service = axios.create({ baseURL: '/api', timeout: 8000 })

service.interceptors.response.use((res) => res.data)

// 自建封装：导出的函数就叫 fetch，但它是封装而不是原生调用
export function fetch(url, config) {
  return service.get(url, config)
}

export function post(url, data) {
  return service.post(url, data)
}
