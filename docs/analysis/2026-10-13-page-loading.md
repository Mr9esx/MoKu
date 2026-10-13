# 页面加载排查

## 已确认的现象

- 本地 Vite 服务在 127.0.0.1:4190 正常监听，CPU 占用约 0%。首页、main.tsx、App.tsx 与字体资源均返回 HTTP 200，耗时约 2–4 ms。
- 当前旧标签页 3 的浏览器控制连接连续超时，无法读取其 DOM 和错误日志；不能仅凭这一点确认用户看到的加载指示具体来源。
- 相同地址的临时新标签页约 1 秒显示完整首页，主标题可见，页面错误日志为空。
- 源码未发现 location.reload 或循环导航逻辑。

## 可复现的开发期整页刷新原因

`src/App.tsx` 同时导出 React 组件和 `formatPercent` 工具函数。该工具函数仅在本文件内使用。每次修改本文件，工具函数产生新引用，React Fast Refresh 校验认为 `formatPercent` 导出不兼容，无法保留组件状态地热更新，改为向上失效传播并触发整页刷新。

直接使用本项目已安装的 `@vitejs/plugin-react/dist/refresh-runtime.js` 复现导出校验：

- 同时导出组件和两个版本的 formatPercent：返回 `Could not Fast Refresh ("formatPercent" export is incompatible)`。
- 仅导出组件：校验通过。

此问题解释编辑 App.tsx 时出现的反复完整加载；当前旧标签页连接超时是否由此导致尚不能确认。生产版本不受开发热更新流程影响。

## 准备的修复

将 `export const formatPercent` 改成文件内部的 `const formatPercent`，无需新增模块或修改功能。补丁已准备在 `/tmp/homemade-hot-refresh.patch`，尚未应用。

首次移除导出也会让旧的热更新边界失效一次，可能刷新当前页面。项目仅保存在本页内存，刷新会丢失未导出的编辑，因此已询问用户是否存在尚未导出的修改，得到确认后再应用。
