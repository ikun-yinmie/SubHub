// 按需引入组件，配合 unplugin-element-plus 注入对应样式，避免引入全量 CSS
import {
  ElAlert,
  ElAutocomplete,
  ElButton,
  ElCard,
  ElCheckbox,
  ElCheckboxButton,
  ElCheckboxGroup,
  ElCol,
  ElContainer,
  ElDialog,
  ElDivider,
  ElForm,
  ElFormItem,
  ElIcon,
  ElInput,
  ElLink,
  ElMessage,
  ElNotification,
  ElOption,
  ElOptionGroup,
  ElPopover,
  ElRadio,
  ElRow,
  ElSelect,
  ElTabPane,
  ElTabs,
  ElTag
} from 'element-plus'

const components = [
  ElRow,
  ElCol,
  ElCard,
  ElContainer,
  ElForm,
  ElFormItem,
  ElRadio,
  ElInput,
  ElSelect,
  ElOption,
  ElOptionGroup,
  ElAutocomplete,
  ElButton,
  ElCheckbox,
  ElCheckboxGroup,
  ElCheckboxButton,
  ElPopover,
  ElLink,
  ElDivider,
  ElDialog,
  ElIcon,
  ElTabs,
  ElTabPane,
  ElAlert,
  ElTag
]

export function setupElementPlus(app) {
  components.forEach(component => app.use(component))

  app.config.globalProperties.$notify = ElNotification
  app.config.globalProperties.$message = ElMessage
}
