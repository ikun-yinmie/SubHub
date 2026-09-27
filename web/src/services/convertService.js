/**
 * 解析 / 转格式服务
 *
 * 同一个输入框吃两类东西：
 *   - 订阅地址（http(s)://…）
 *   - 节点内容（ss:// vmess:// 分享链接、多行、整段 base64）
 * 后端两类都认，这里仍按类型分开送：http(s) 走 url，其余走 data。
 * 好处是混着粘也能一次转完（后端会合并两者），而且出问题时能看出是哪一类的问题。
 */

const CONVERT_TIMEOUT = 60 * 1000

/**
 * 整段结构化配置的根级键 (Clash / mihomo YAML、sing-box JSON、Surge 分节…)
 * 命中它就把输入当成"一份配置", 而不是"一堆一行一条的链接"。
 */
const CONFIG_ROOT_KEY =
  /^[ \t]*(proxies|proxy-groups|proxy-providers|rule-providers|rules|outbounds|inbounds|listeners|dns|experimental|mixed-port|socks-port|redir-port|tproxy-port)[ \t]*:/m

// 目标表一次会话内只拉一次
let targetsPromise

export class ConvertService {
  /** 目标格式表（/api/v1/targets） */
  static async targets($axios) {
    if (!targetsPromise) {
      targetsPromise = $axios
        .get('/api/v1/targets', { timeout: CONVERT_TIMEOUT })
        .then((response) => response.data?.data?.targets ?? [])
        .catch((error) => {
          targetsPromise = undefined
          throw error
        })
    }
    return targetsPromise
  }

  /**
   * 这段输入是不是一整份配置 (Clash YAML / sing-box JSON / Surge 分节…)
   *
   * 为什么必须单独认出来: 配置靠缩进表达结构, 一旦按行 trim 再拼回去,
   * `ws-opts:` / `path:` 全部顶到第 0 列, YAML 直接解析失败 —— 内核会退回
   * 逐行解析, 把 `type: vless` 这种单行当成一条节点, 于是输出一屏
   * `vless://undefined@undefined:undefined`。配置必须原样整段送走后端。
   */
  static looksLikeConfig(input = '') {
    const text = `${input}`.trim()
    if (text.length === 0) return false
    // JSON / YAML 流式写法：{"proxies":[…]}
    if (/^[[{]/.test(text)) return true
    if (!text.includes('\n')) return false
    return CONFIG_ROOT_KEY.test(text)
  }

  /** 把输入拆成「远程订阅地址」与「本地节点内容」两类 */
  static classify(input = '') {
    const remote = []
    const inline = []
    const text = `${input}`

    if (ConvertService.looksLikeConfig(text)) {
      // 原样保留（含缩进与空行），只摘掉顶格、整行就是一个地址的行：
      // 缩进里的 url 属于配置本身，摘出来会把配置拆坏。
      for (const line of text.split(/\r?\n/)) {
        const value = line.trim()
        const indented = /^[ \t]/.test(line)
        if (!indented && /^https?:\/\/\S+$/i.test(value)) remote.push(value)
        else inline.push(line)
      }
      const body = inline.join('\n').trim()
      return { remote, inline: body.length > 0 ? [body] : [], whole: true }
    }

    for (const line of text.split(/\r?\n/)) {
      for (const piece of line.split('|')) {
        const value = piece.trim()
        if (value.length === 0) continue
        if (/^https?:\/\//i.test(value)) remote.push(value)
        else inline.push(value)
      }
    }

    return { remote, inline, whole: false }
  }

  /** 组装请求体：url 与 data 可以同时给，后端会合并 */
  static payload(input) {
    const { remote, inline, whole } = ConvertService.classify(input)
    const body = {}
    if (remote.length > 0) body.url = remote.join('|')
    if (inline.length > 0) body.data = whole ? inline[0] : inline.join('\n')
    return body
  }

  /** 转成某一个目标格式，返回后端 data 段 */
  static async convert($axios, input, target) {
    const response = await $axios.post(
      '/api/v1/convert',
      { ...ConvertService.payload(input), target },
      { timeout: CONVERT_TIMEOUT }
    )
    const result = response.data
    if (result?.status !== 'success') {
      throw new Error(result?.error?.message || '转换失败')
    }
    return result.data
  }

  /** 从 axios 错误里取出人话 */
  static errorMessage(error) {
    const apiError = error?.response?.data
    if (apiError?.error?.message) {
      const code = apiError.error.code ? `[${apiError.error.code}] ` : ''
      return `${code}${apiError.error.message}`
    }
    if (apiError?.message) return apiError.message
    return error?.message || '解析失败，请检查输入内容'
  }

  static extension(format) {
    if (format === 'yaml') return 'yaml'
    if (format === 'json') return 'json'
    if (format === 'html') return 'html'
    return 'txt'
  }

  static mime(format) {
    if (format === 'yaml') return 'text/yaml;charset=utf-8'
    if (format === 'json') return 'application/json;charset=utf-8'
    if (format === 'html') return 'text/html;charset=utf-8'
    return 'text/plain;charset=utf-8'
  }

  /** 文件名里的时间戳用本地时间（toISOString 是 UTC，差 8 小时会让人看不懂） */
  static timestamp(date = new Date()) {
    const pad = (value) => `${value}`.padStart(2, '0')
    return (
      `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
      `-${pad(date.getHours())}${pad(date.getMinutes())}`
    )
  }

  static filename(targetId, format) {
    return `subhub-${targetId}-${ConvertService.timestamp()}.${ConvertService.extension(format)}`
  }

  static sizeOf(content = '') {
    const bytes = new Blob([content]).size
    if (bytes < 1024) return `${bytes} B`
    return `${(bytes / 1024).toFixed(1)} KB`
  }

  /** 浏览器下载文本 */
  static download(filename, content, mime = 'text/plain;charset=utf-8') {
    const blob = new Blob([content], { type: mime })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }
}
