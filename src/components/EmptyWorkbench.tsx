import { ArrowDownToLine, ArrowUpRight, Plus } from "lucide-react";
import type { Project } from "../core/types";
import type { Dialog } from "./WorkspaceDialogs";

/** Decorative joinery study. The working drawing stays free of print texture. */
function JoineryPrint() {
  return (
    <svg className="joinery-print" viewBox="0 0 480 520" aria-hidden="true">
      <defs>
        <pattern
          id="print-blue"
          width="4"
          height="4"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="1" cy="1" r="1.1" fill="var(--ink)" />
          <circle cx="3" cy="3" r="0.6" fill="var(--ink)" />
        </pattern>
        <pattern
          id="print-orange"
          width="3.5"
          height="3.5"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="1" cy="1" r="1.1" fill="var(--accent)" />
          <circle cx="2.8" cy="2.8" r="0.65" fill="var(--accent)" />
        </pattern>
        <pattern
          id="print-paper"
          width="7"
          height="7"
          patternUnits="userSpaceOnUse"
        >
          <circle cx="1" cy="2" r="0.7" fill="var(--paper)" />
          <circle cx="5" cy="6" r="0.4" fill="var(--paper)" />
        </pattern>
      </defs>
      <g fill="none" stroke="var(--line)" strokeWidth="0.8">
        <path d="M34 468 273 513 456 389M58 56V458M427 58V421" />
        <path d="M48 61h20M48 449h20M417 70h20M417 418h20" />
      </g>
      <g stroke="var(--ink)" strokeWidth="1.5" strokeLinejoin="round">
        <path d="m103 64 23-13 0 348-23 13Z" fill="url(#print-blue)" />
        <path d="m90 54 13 10 0 348-13-10Z" fill="var(--ink)" />
        <path d="m277 164 21-14 0 342-21 14Z" fill="url(#print-blue)" />
        <path d="m264 154 13 10 0 342-13-10Z" fill="var(--ink)" />
        <path d="m406 77 17-12 0 351-17 12Z" fill="url(#print-blue)" />
        <path d="m393 66 13 11 0 351-13-11Z" fill="var(--ink)" />
        <path d="m82 76 130-80 216 127-133 79Z" fill="url(#print-blue)" />
        <path d="m82 76 213 126 0 18L82 94Z" fill="var(--ink)" />
        <path d="m295 202 133-79v18l-133 79Z" fill="url(#print-blue)" />
        <path d="m82 212 131-80 215 127-133 79Z" fill="url(#print-blue)" />
        <path d="m82 212 213 126 0 18L82 230Z" fill="var(--ink)" />
        <path d="m295 338 133-79v18l-133 79Z" fill="url(#print-blue)" />
        <path d="m82 348 131-80 215 127-133 79Z" fill="url(#print-blue)" />
        <path d="m82 348 213 126 0 18L82 366Z" fill="var(--ink)" />
        <path d="m295 474 133-79v18l-133 79Z" fill="url(#print-blue)" />
      </g>
      <g stroke="var(--accent)" strokeWidth="1.8" strokeLinejoin="round">
        <path d="m215 12 179 106v259L215 271Z" fill="var(--paper)" />
        <path d="m215 12 179 106v259L215 271Z" fill="url(#print-orange)" />
        <path d="m215 12 8-5 179 105-8 6Z" fill="var(--accent)" />
        <path d="m394 118 8-6v260l-8 5Z" fill="var(--accent)" />
        <path
          d="m252 34 0 259m35-239v259m35-238v259m35-239v259"
          stroke="var(--paper)"
          strokeWidth="3"
        />
        <path
          d="m217 100 175 104m-175-17 175 104"
          stroke="var(--paper)"
          strokeWidth="2"
        />
      </g>
      <g fill="url(#print-paper)">
        <path d="m82 76 213 126v18L82 94Zm0 136 213 126v18L82 230Zm0 136 213 126v18L82 366Z" />
        <path d="m90 54 13 10v348l-13-10Zm174 100 13 10v342l-13-10Z" />
      </g>
      <g className="print-annotations" fill="var(--ink)">
        <text x="22" y="45">
          01 / JOINERY STUDY
        </text>
        <text x="341" y="485">
          板 · 榫 · 结构
        </text>
      </g>
      <g stroke="var(--accent)" strokeWidth="1" fill="none">
        <circle cx="112" cy="223" r="16" />
        <path d="m98 212-40-25H22M328 329l102 31h29" />
      </g>
    </svg>
  );
}

export function EmptyWorkbench({
  project,
  open,
  onClear,
}: {
  project: Project | null;
  open: (dialog: Dialog) => void;
  onClear: () => void;
}) {
  return (
    <div className="empty-canvas" onClick={onClear}>
      <div className="welcome-sheet">
        <div className="welcome-edition">
          <span>WOODWORK TOOLBOX</span>
        </div>
        <div className="welcome-composition">
          <div className="welcome-copy">
            <h1>
              {project ? (
                <>
                  备好板材，
                  <br />
                  让零件各就其位。
                </>
              ) : "MoKu"}
            </h1>
            {project && <p>{project.parts.length} 个零件待放置</p>}
            {!project && <p>木工工具箱，支持木材自动排版、榫卯清角、3D 组装预览和拼装问题检查。</p>}
            <div className="welcome-actions">
              <button
                className="primary"
                onClick={(e) => {
                  e.stopPropagation();
                  open(project ? "stock" : "import");
                }}
              >
                {project ? <Plus size={16} /> : <ArrowDownToLine size={16} />}
                {project ? "新增板材" : "导入 DXF 图纸"}
                <ArrowUpRight size={16} />
              </button>
              {!project && (
                <button
                  className="sample-link"
                  onClick={(e) => {
                    e.stopPropagation();
                    open("sample");
                  }}
                >
                  先看看示例 <ArrowUpRight size={15} />
                </button>
              )}
            </div>
            <span className="welcome-local">图纸只在本机处理 · 无需上传</span>
          </div>
          <div className="welcome-art">
            <JoineryPrint />
          </div>
        </div>
        <div className="welcome-steps">
          {[
            ["01", "自动排版", "按板厚、材质安排用料"],
            ["02", "榫卯清角", "支持狗骨 / T 骨"],
            ["03", "3D 组装", "预览效果，检查拼装问题"],
          ].map(([n, title, text]) => (
            <div key={n}>
              <span>{n}</span>
              <div>
                <strong>{title}</strong>
                <small>{text}</small>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
