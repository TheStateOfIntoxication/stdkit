// 掩码：命中行本身就是密钥时，把它原样写进 CI 日志 / 模型上下文是二次泄漏。
// 策略：保留键名与结构，把值替换成 ***；行号与规则 ID 不变，排障靠 --no-mask。
const SECRET_KEY =
  /([A-Za-z0-9_.\-]*(?:password|passwd|pwd|secret|secretkey|accesskey|token|appsecret|clientsecret|key-store-password)[A-Za-z0-9_.\-]*\s*[:=]\s*)(?:"[^"]*"|'[^']*'|\S+)/gi;

/** 把 `key: value` / `key=value` 里的值掩掉；顺带掩掉常见密钥字面量形状。 */
export function maskSecretLine(line) {
  let out = String(line).replace(SECRET_KEY, '$1***');
  out = out.replace(/\bsk_(?:live|test)_[A-Za-z0-9]{4,}/g, 'sk_***');
  out = out.replace(/\bAKIA[0-9A-Z]{12,}\b/g, 'AKIA***');
  return out;
}

/** 长度超过 24 的连续 hex/base64 串（不像人写的标识符）也掩掉。 */
export function maskLongToken(s) {
  return String(s).replace(/\b[A-Fa-f0-9]{32,}\b/g, '***').replace(/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, '***');
}

/** 对外输出统一入口：先按键值掩码，再掩长 token。 */
export function maskText(text) {
  return maskLongToken(maskSecretLine(text));
}
