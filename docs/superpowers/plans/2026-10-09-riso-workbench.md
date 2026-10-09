# Riso Workbench Implementation Plan

**Goal:** 将用户参考图的双色印刷风格融入完整木作工作台。

**Architecture:** 保留 Zustand 与现有业务组件接口。新增独立欢迎页组件与装饰 SVG，更新全局 CSS 的色彩和排版，图纸 SVG 统一语义色彩。

**Tech Stack:** React 19、TypeScript、Vite、CSS、SVG。

## Global Constraints

- 保持现有导入、几何、排版、撤销和导出行为。
- 字体本地托管、附上许可；不增加运行时依赖。
- 桌面与窄屏都可操作；装饰不拦截指针；表单与尺寸保持可读。

## Tasks

- [x] 新增 `src/components/EmptyWorkbench.tsx`，接收 `project: Project | null` 和 `open: (dialog: Dialog) => void`，输出欢迎页、SVG 木作插画、导入/示例按钮。替换 `src/App.tsx` 的旧空白提示，增加品牌副标与概览引导。
- [x] 更新 `src/styles.css` 的调色板，托管 `public/fonts/woodwork-serif-heavy.woff2` 与许可，重构标题、工具栏、面板、表单与响应式欢迎页；更新 `index.html` 元信息与字体预加载。
- [x] 修改 `StockCanvas.tsx` 和 `Thumbnail.tsx` 的图形语义色彩，使用类名匹配纸底、蓝线、朱橙选中；孔槽清楚区分。
- [x] 执行 `pnpm test` 与 `pnpm build`；浏览器验证欢迎页、打开示例并确认导入、选择零件、打开板材/排版弹窗、390px 窄屏。保存截图至 `docs/feasibility/`，记录验证结果。
