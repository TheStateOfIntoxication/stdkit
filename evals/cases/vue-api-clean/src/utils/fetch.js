import axios from 'axios'

const service = axios.create({ baseURL: process.env.VUE_APP_BASE_API, timeout: 10000 })

service.interceptors.request.use((config) => {
  config.headers.Authorization = `Bearer ${getToken()}`
  return config
})

service.interceptors.response.use(
  (response) => {
    // 拦截器负责解包与解密，这是全站唯一允许 JSON.parse(response.data) 的位置
    const data = JSON.parse(decrypt(response.data))
    return data
  },
  (error) => Promise.reject(error),
)

export function get(url, params) {
  return service.get(url, { params })
}

export function post(url, data) {
  return service.post(url, data)
}
