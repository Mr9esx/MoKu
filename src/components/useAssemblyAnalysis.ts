import { useEffect, useRef, useState } from "react";
import type { Project } from "../core/types";
import type { Assembly, AssemblyAnalysis } from "../core/assemblyTypes";
/** Keep expensive geometry off the input thread and reject results from superseded gestures. */
export function useAssemblyAnalysis(project: Project, assembly: Assembly) {
  const worker = useRef<Worker | null>(null),
    revision = useRef(0);
  const [result, setResult] = useState<{
    analysis: AssemblyAnalysis | null;
    pending: boolean;
    error: string;
  }>({ analysis: null, pending: true, error: "" });
  useEffect(() => {
    try {
      const instance = new Worker(
        new URL("../core/assembly.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.current = instance;
      instance.onmessage = (
        event: MessageEvent<{
          revision: number;
          analysis?: AssemblyAnalysis;
          error?: string;
        }>,
      ) => {
        if (event.data.revision !== revision.current) return;
        setResult({
          analysis: event.data.analysis ?? null,
          pending: false,
          error: event.data.error ?? "",
        });
      };
      instance.onerror = () =>
        setResult({
          analysis: null,
          pending: false,
          error: "检测线程无法运行，请重新打开 3D 工作区重试",
        });
      return () => {
        revision.current++;
        instance.terminate();
        worker.current = null;
      };
    } catch {
      setResult({
        analysis: null,
        pending: false,
        error: "当前设备无法启动装配检测线程",
      });
    }
  }, []);
  useEffect(() => {
    const id = ++revision.current;
    setResult({ analysis: null, pending: true, error: "" });
    const timer = setTimeout(
      () => worker.current?.postMessage({ revision: id, project, assembly }),
      90,
    );
    return () => clearTimeout(timer);
  }, [project.parts, assembly]);
  return result;
}
