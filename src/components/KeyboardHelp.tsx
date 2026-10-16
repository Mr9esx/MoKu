import "./keyboardHelp.css";

const groups = [
  { title: "通用操作", className: "shortcut-common", rows: [
    ["Ctrl / ⌘ Z", "撤销上一次修改"],
    ["Esc", "取消拖动、取消选中或关闭弹窗"],
    ["方向键", "沿 X / Y 微调 1 mm；Shift 加速至 10 mm"],
    ["R / Shift R", "绕 Z 轴旋转 90° / 反向旋转"],
    ["L", "锁定 / 解锁所选零件"],
    ["M", "开启 / 关闭磁吸；拖动时 Alt 暂停"],
    ["F", "定位所选；未选中时适应全部"],
    ["0 / Shift F", "适应全部；也支持 Ctrl / ⌘ 0"],
    ["+ / −", "放大 / 缩小画布"],
    ["Alt 2 / Alt 3", "切换二维图纸 / 三维组装"],
    ["Ctrl / ⌘ O", "打开导入图纸"],
    ["Ctrl / ⌘ Shift E", "打开导出图纸"],
    ["? / F1", "打开快捷键与操作帮助"],
  ] },
  { title: "二维排版", rows: [
    ["V / H", "选择工具 / 平移工具"],
    ["Ctrl / ⌘ D", "复制一个所选零件，放入待放置列表"],
    ["Delete / Backspace", "删除所选零件，可撤销"],
  ] },
  { title: "三维组装", rows: [
    ["Delete / Backspace", "移出场景，保留零件库，可撤销"],
    ["X / Y / Z", "绕对应世界轴旋转 90°；Shift 反向"],
    ["PageUp / PageDown", "沿 Z 轴升降 1 mm；Shift 加速至 10 mm"],
    ["T / B", "透视查看 / 爆炸查看"],
    ["1 / 3 / 7 / 9", "前视 / 右视 / 上视 / 等轴视图"],
  ] },
];

export function KeyboardHelp() {
  return <div className="help shortcut-help">
    <p className="shortcut-intro">先选中零件，再使用编辑快捷键。输入框、下拉框和输入法输入时保留正常输入；原图、候选和搜索中的编辑限制与按钮一致。</p>
    <div className="shortcut-groups">{groups.map(group => <section key={group.title} className={group.className}>
      <h3>{group.title}</h3>
      <dl>{group.rows.map(([keys, description]) => <div key={keys}>
        <dt><kbd>{keys}</kbd></dt><dd>{description}</dd>
      </div>)}</dl>
    </section>)}</div>
    <div className="shortcut-mouse">
      <p><strong>二维鼠标：</strong>拖动零件摆放；普通滚轮平移，Shift 滚轮横移，Ctrl / ⌘ 滚轮围绕指针缩放。</p>
      <p><strong>三维鼠标：</strong>拖动零件或箭头移动，拖动圆环旋转；左键拖空白旋转视角，右键 / 中键 / Shift 左键平移，滚轮缩放。Alt 暂停磁吸与旋转角度吸附。</p>
    </div>
  </div>;
}
