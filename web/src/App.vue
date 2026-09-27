<template>
  <el-config-provider :locale="locale" :z-index="3000">
    <div id="app">
      <nav class="app-nav">
        <span class="app-nav-brand">SubHub</span>
        <el-tabs v-model="activeTab" class="app-nav-tabs" @tab-change="onTabChange">
          <el-tab-pane label="订阅转换" name="/" />
          <el-tab-pane label="解析 / 转格式" name="/parse" />
        </el-tabs>
      </nav>
      <router-view/>
    </div>
  </el-config-provider>
</template>

<script>
import { ElConfigProvider } from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'

export default {
  name: 'App',
  components: {
    ElConfigProvider
  },
  data() {
    return {
      activeTab: ''
    }
  },
  computed: {
    locale() {
      return zhCn
    },
    currentTab() {
      return this.$route?.path === '/parse' ? '/parse' : '/'
    }
  },
  watch: {
    '$route.path'() {
      this.activeTab = this.currentTab
    }
  },
  methods: {
    onTabChange(name) {
      if (this.$route.path !== name) this.$router.push(name)
    }
  },
  created() {
    this.activeTab = this.currentTab
  }
}
</script>

<style>
.app-nav {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 16px;
  border-bottom: 1px solid #e4e7ed;
  background: #fff;
}

.app-nav-brand {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  white-space: nowrap;
}

.app-nav-tabs .el-tabs__header {
  margin: 0;
}

.app-nav-tabs .el-tabs__nav-wrap::after {
  display: none;
}
</style>
