<template>
  <div>
    <el-row style="margin-top: 10px">
      <el-col>
        <el-card>
          <template #header>
            <div class="page-header">
              <span>解析 / 转格式</span>
              <span class="page-header-tip">订阅地址或节点链接 → 一次转成多种格式</span>
            </div>
          </template>

          <el-form :model="form" label-width="110px" label-position="left" style="width: 100%">
            <el-form-item label="输入内容:">
              <el-input v-model="form.input" type="textarea" :rows="6" :disabled="loading"
                placeholder="订阅地址 / 节点分享链接（ss:// ssr:// vmess:// vless:// trojan:// hysteria2:// …），每行一个或用 | 分隔；整段 base64 订阅、Clash / mihomo YAML、Surge 配置也能直接粘进来"
                @blur="saveInput" />
              <div class="detect-line">
                <template v-if="form.input.trim().length > 0">
                  <el-tag v-if="detected.remote.length > 0" type="success" effect="plain" size="small">
                    订阅地址 {{ detected.remote.length }} 个
                  </el-tag>
                  <el-tag v-if="detected.whole" type="info" effect="plain" size="small">
                    整段配置（保留原始缩进）
                  </el-tag>
                  <el-tag v-if="detected.inline.length > 0" type="warning" effect="plain" size="small">
                    节点 / 内容 {{ detected.inline.length }} 条
                  </el-tag>
                </template>
                <span v-else class="detect-hint">支持订阅地址，也支持只有节点、没有订阅的场景</span>
              </div>
            </el-form-item>

            <el-form-item label="输出格式:">
              <div v-if="targetsLoading" class="detect-hint">正在读取可用目标格式…</div>
              <template v-else>
                <div class="format-toolbar">
                  <el-input v-model="formatQuery" size="small" clearable class="format-search"
                    :prefix-icon="Search"
                    placeholder="搜索格式或别名，如 v2ray / v2rayn / mixed / sub" />
                  <el-button v-if="formatQuery.trim().length > 0" size="small" type="primary" link
                    :disabled="filteredGroups.length === 0" @click="selectFiltered">
                    只选中筛出的 {{ filteredCount }} 个
                  </el-button>
                  <el-popover placement="bottom-start" trigger="click" :width="520">
                    <template #reference>
                      <el-button size="small" type="primary" link>别名对照</el-button>
                    </template>
                    <div class="alias-panel">
                      <div class="alias-panel-title">
                        所有目标都能用这些名字调用（接口参数 target=），别名与规范名输出完全一致。
                        大家常问的 v2ray / v2rayn 就是「分享链接 (Base64 订阅)」。
                      </div>
                      <div v-for="group in targetGroups" :key="group.kind" class="alias-group">
                        <div class="alias-group-title">{{ group.label }}</div>
                        <div v-for="target in group.targets" :key="target.id" class="alias-row">
                          <span class="alias-label">{{ target.label }}</span>
                          <span class="alias-names">{{ aliasNames(target).join(' / ') }}</span>
                        </div>
                      </div>
                    </div>
                  </el-popover>
                </div>
                <div v-for="group in filteredGroups" :key="group.kind" class="format-group">
                  <span class="format-group-label">{{ group.label }}</span>
                  <el-checkbox-group v-model="form.selected" :disabled="loading">
                    <el-checkbox-button v-for="target in group.targets" :key="target.id" :value="target.id"
                      :title="aliasTitle(target)">
                      {{ target.label }}
                      <span v-if="matchedAlias(target)" class="alias-chip">· {{ matchedAlias(target) }}</span>
                    </el-checkbox-button>
                  </el-checkbox-group>
                </div>
                <el-alert v-if="!targetsLoading && filteredGroups.length === 0" type="info" :closable="false" show-icon
                  title="没有匹配的格式" description="试试 v2ray / v2rayn / mixed / sing-box，或清空筛选看全部。别名对照里能查到所有可用名字。" />
              </template>
              <div class="detect-line">
                <span class="detect-hint">{{ groupHint }}</span>
              </div>
            </el-form-item>

            <el-form-item label-width="0">
              <el-button type="primary" :icon="MagicStick" :loading="loading" :disabled="!canParse" @click="run">
                {{ loading ? '正在解析…' : '开始解析' }}
              </el-button>
              <el-button :icon="Operation" :disabled="loading" @click="fillSample">填充示例</el-button>
              <el-button :icon="Delete" :disabled="loading || form.input.length === 0" @click="clear">
                清空
              </el-button>
            </el-form-item>
          </el-form>
        </el-card>
      </el-col>
    </el-row>

    <el-row v-if="results.length > 0 || sharedError" style="margin-top: 10px">
      <el-col>
        <el-card>
          <template #header>
            <div class="page-header">
              <span>解析结果</span>
              <span v-if="results.length > 0" class="page-header-tip">{{ resultSummary }}</span>
            </div>
          </template>

          <el-alert v-if="sharedError" :title="sharedError" type="error" :closable="false" show-icon />

          <el-tabs v-if="results.length > 0" v-model="activeResult" class="result-tabs">
            <el-tab-pane v-for="item in results" :key="item.id" :name="item.id">
              <template #label>
                <span>{{ item.label }}</span>
                <el-tag size="small" effect="plain" :type="item.error ? 'danger' : 'info'" class="result-tab-tag">
                  {{ item.error ? '失败' : item.count + ' 节点' }}
                </el-tag>
              </template>

              <div class="result-toolbar">
                <el-button v-if="!item.error" size="small" :icon="CopyDocument"
                  @click="copy(item.content, item.label + ' 已复制')">
                  复制
                </el-button>
                <el-button v-if="!item.error" size="small" :icon="Download" @click="download(item)">
                  下载 {{ filenameOf(item) }}
                </el-button>
                <span class="result-meta">
                  {{ metaOf(item) }}
                </span>
              </div>

              <el-alert v-if="item.error" :title="item.error" type="error" :closable="false" show-icon />
              <pre v-else class="result-body">{{ item.content }}</pre>
            </el-tab-pane>
          </el-tabs>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script>
import { CopyDocument, Delete, Download, MagicStick, Operation, Search } from '@element-plus/icons-vue'

import { ConvertService } from '@/services/convertService'
import { copyText } from '@/utils/clipboard'
import { getLocalStorageItem, setLocalStorageItem } from '@/utils/storage'

// 目标表的 kind → 界面上分组标题
const GROUP_LABELS = {
  config: '完整配置',
  'share-link': '分享链接',
  'internal': '订阅打包',
  page: '订阅页'
}

// 默认勾选的格式（取交集，缺了就跳过）
const DEFAULT_SELECTED = ['mihomo', 'singbox', 'surge', 'uri', 'base64']

const SAMPLE = [
  'ss://YWVzLTI1Ni1nY206cGFzc3dvcmQ@10.0.0.1:8388#HK-1',
  'trojan://tpass@9.9.9.9:443?sni=example.com#JP-2'
].join('\n')

export default {
  name: 'Parse',
  data() {
    return {
      form: {
        input: '',
        selected: []
      },
      formatQuery: '',
      targets: [],
      targetsLoading: true,
      loading: false,
      results: [],
      activeResult: '',
      sharedError: '',
      // 图标组件经 computed 暴露，避免放入 data 被转换为响应式对象
      MagicStick,
      Operation,
      Delete,
      CopyDocument,
      Download,
      Search
    }
  },
  computed: {
    detected() {
      return ConvertService.classify(this.form.input)
    },

    canParse() {
      return this.form.input.trim().length > 0 && this.form.selected.length > 0 && !this.loading
    },

    targetGroups() {
      const groups = new Map()
      for (const target of this.targets) {
        const kind = target.kind
        if (!GROUP_LABELS[kind]) continue
        if (!groups.has(kind)) {
          groups.set(kind, { kind, label: GROUP_LABELS[kind], targets: [] })
        }
        groups.get(kind).targets.push(target)
      }
      return [...groups.values()]
    },

    /** 按关键字过滤后的分组（关键字能命中 id / 名称 / 别名 / subconverter 名称 / 说明） */
    filteredGroups() {
      const query = this.formatQuery.trim().toLowerCase()
      if (query.length === 0) return this.targetGroups
      return this.targetGroups
        .map((group) => ({
          ...group,
          targets: group.targets.filter((target) => this.searchText(target).includes(query))
        }))
        .filter((group) => group.targets.length > 0)
    },

    filteredCount() {
      return this.filteredGroups.reduce((sum, group) => sum + group.targets.length, 0)
    },

    groupHint() {
      if (this.form.selected.length === 0) return '至少选一个输出格式'
      const parts = [`已选 ${this.form.selected.length} 种格式，解析时会同时生成`]
      if (this.formatQuery.trim().length > 0) {
        parts.push(`筛选「${this.formatQuery.trim()}」显示 ${this.filteredCount} 个（只影响显示，不改变已选）`)
      }
      return parts.join('；')
    },

    resultSummary() {
      const failed = this.results.filter((item) => item.error).length
      const ok = this.results.length - failed
      return failed > 0 ? `${ok} 种成功 / ${failed} 种失败` : `${ok} 种格式已生成`
    }
  },
  created() {
    document.title = '解析 / 转格式 - SubHub'
    if (import.meta.env.VITE_USE_STORAGE === 'true') {
      const cached = getLocalStorageItem('parseInput')
      if (cached) this.form.input = cached
    }
  },
  async mounted() {
    try {
      this.targets = await ConvertService.targets(this.$axios)
      const available = new Set(this.targets.map((target) => target.id))
      this.form.selected = DEFAULT_SELECTED.filter((id) => available.has(id))
    } catch (error) {
      this.sharedError = `读取目标格式失败：${ConvertService.errorMessage(error)}`
    } finally {
      this.targetsLoading = false
    }
  },
  methods: {
    /** 一个目标的全部可用名字（别名 + subconverter 名称，去掉与 id 重复的） */
    aliasNames(target) {
      const names = [...(target.aliases ?? []), ...(target.subconverter ?? [])]
      return [...new Set(names)].filter((name) => name && name !== target.id)
    },

    aliasTitle(target) {
      const names = this.aliasNames(target)
      return names.length > 0 ? `别名：${names.join(' / ')}` : target.id
    },

    searchText(target) {
      return `${target.id} ${target.label} ${target.description ?? ''} ${this.aliasNames(target).join(' ')}`.toLowerCase()
    },

    /** 关键字只命中别名（没命中 id/名称）时，按钮上补一个提示，避免"找不到 v2ray" */
    matchedAlias(target) {
      const query = this.formatQuery.trim().toLowerCase()
      if (query.length === 0) return ''
      if (`${target.id} ${target.label}`.toLowerCase().includes(query)) return ''
      return this.aliasNames(target).find((name) => name.toLowerCase().includes(query)) ?? ''
    },

    /** 筛选框旁边的一键操作：把已选换成"当前筛出来的这几个" */
    selectFiltered() {
      this.form.selected = this.filteredGroups.flatMap((group) => group.targets.map((target) => target.id))
    },

    saveInput() {
      if (import.meta.env.VITE_USE_STORAGE !== 'true') return
      if (this.form.input.trim().length === 0) return
      setLocalStorageItem('parseInput', this.form.input, Number(import.meta.env.VITE_CACHE_TTL) || 86400)
    },

    fillSample() {
      this.form.input = SAMPLE
      this.saveInput()
    },

    clear() {
      this.form.input = ''
      this.results = []
      this.activeResult = ''
      this.sharedError = ''
    },

    async copy(text, successMessage = '已复制') {
      if (!text) return false
      const copied = await copyText(text)
      if (copied) this.$message.success(successMessage)
      else this.$message.error('复制失败，请手动选中内容复制')
      return copied
    },

    filenameOf(item) {
      return ConvertService.filename(item.id, item.format)
    },

    metaOf(item) {
      if (item.error) return ''
      const parts = [item.format ? `格式 ${item.format}` : '', ConvertService.sizeOf(item.content)]
      if (item.template) parts.push(`模板 ${item.template}`)
      if ((item.warnings ?? []).length > 0) parts.push(`告警 ${item.warnings.length} 条`)
      return parts.filter(Boolean).join(' · ')
    },

    download(item) {
      ConvertService.download(
        this.filenameOf(item),
        item.content,
        ConvertService.mime(item.format)
      )
    },

    async run() {
      const input = this.form.input.trim()
      if (input.length === 0) {
        this.$message.error('请先填订阅地址或节点链接')
        return
      }
      if (this.form.selected.length === 0) {
        this.$message.error('至少选一个输出格式')
        return
      }

      this.loading = true
      this.sharedError = ''
      this.results = []

      const targets = new Map(this.targets.map((target) => [target.id, target]))
      const selected = [...this.form.selected]

      try {
        this.saveInput()
        const settled = await Promise.allSettled(
          selected.map((id) => ConvertService.convert(this.$axios, input, id))
        )

        this.results = settled.map((entry, index) => {
          const id = selected[index]
          const target = targets.get(id) ?? { id, label: id, format: undefined }
          if (entry.status === 'fulfilled') {
            const data = entry.value ?? {}
            return {
              id,
              label: data.target?.label ?? target.label ?? id,
              format: data.format ?? target.format,
              count: data.count ?? 0,
              template: data.template,
              warnings: data.warnings ?? [],
              content: data.content ?? '',
              error: ''
            }
          }
          return {
            id,
            label: target.label ?? id,
            format: target.format,
            count: 0,
            content: '',
            error: ConvertService.errorMessage(entry.reason)
          }
        })

        this.activeResult = this.results[0]?.id ?? ''
        const failed = this.results.filter((item) => item.error).length
        if (failed > 0) this.$message.warning(`${this.results.length - failed} 种成功，${failed} 种失败`)
        else this.$message.success(`已生成 ${this.results.length} 种格式`)
      } catch (error) {
        this.sharedError = ConvertService.errorMessage(error)
        this.$message.error(this.sharedError)
      } finally {
        this.loading = false
      }
    }
  }
}
</script>

<style scoped>
.page-header {
  display: flex;
  align-items: baseline;
  gap: 12px;
}

.page-header-tip {
  font-size: 12px;
  color: #909399;
  font-weight: normal;
}

.detect-line {
  margin-top: 6px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.detect-hint {
  font-size: 12px;
  color: #909399;
}

.format-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
  margin-bottom: 12px;
}

.format-group-label {
  font-size: 12px;
  color: #909399;
}

.format-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  margin-bottom: 4px;
}

.format-search {
  width: 320px;
}

.alias-chip {
  /* 继承按钮文字色：未选中是深色、选中是白字，两边都看得见 */
  opacity: 0.85;
  font-size: 12px;
}

.alias-panel {
  max-height: 60vh;
  overflow: auto;
}

.alias-panel-title {
  font-size: 12px;
  color: #909399;
  margin-bottom: 8px;
  line-height: 1.6;
}

.alias-group {
  margin-bottom: 10px;
}

.alias-group-title {
  font-size: 12px;
  font-weight: 600;
  color: #606266;
  margin-bottom: 4px;
}

.alias-row {
  display: flex;
  gap: 8px;
  font-size: 12px;
  line-height: 1.8;
}

.alias-label {
  color: #303133;
  min-width: 150px;
}

.alias-names {
  color: #909399;
  word-break: break-all;
}

.result-tabs {
  margin-top: -10px;
}

.result-tab-tag {
  margin-left: 6px;
}

.result-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
  flex-wrap: wrap;
}

.result-meta {
  font-size: 12px;
  color: #909399;
}

.result-body {
  margin: 0;
  max-height: 60vh;
  overflow: auto;
  padding: 12px;
  background: #f5f7fa;
  border-radius: 4px;
  font-family: 'JetBrains Mono', Consolas, Menlo, monospace;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
