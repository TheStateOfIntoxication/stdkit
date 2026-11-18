// 登录兜底：单引号 / 双引号 / 模板字符串（含插值）都不该报
if (!token) window.location.href = '/login'
if (!token) window.location.href = "/user/login"
if (!token) window.location.href = `/login?redirect=${encodeURIComponent(path)}`
if (code === 401) window.location.href = `/sso?code=${code}`
// 业务跳转仍要报（在 vue2-bad 里锁）
