import { useEffect, useMemo, useRef, useState } from "react";
import type { Project } from "../core/types";
import type {
  Assembly,
  AssemblyAnalysis,
  PlacementCandidate,
} from "../core/assemblyTypes";
import {
  assemblyCheckProject,
  createAssemblyRequestQueue,
} from "../core/assemblyRequests";
type Result = {
  kind?: "analysis" | "guidance";
  revision: number;
  analysis?: AssemblyAnalysis;
  candidates?: PlacementCandidate[];
  error?: string;
};
/** Real geometry and placement suggestions stay off the input thread; old gestures never win. */
export function useAssemblyAnalysis(
  project: Project,
  preview: Assembly,
  committed: Assembly,
  selected: string | null,
) {
  const worker = useRef<Worker | null>(null),
    revision = useRef(0),
    guidanceRevision = useRef(0),
    failure = useRef("");
  const queue = useRef<ReturnType<typeof createAssemblyRequestQueue> | null>(
    null,
  );
  const input = useMemo(
    () => assemblyCheckProject(project),
    [project.parts, project.name],
  );
  const [result, setResult] = useState<{
    analysis: AssemblyAnalysis | null;
    pending: boolean;
    error: string;
  }>({ analysis: null, pending: true, error: "" });
  const [guidance, setGuidance] = useState<{
    candidates: PlacementCandidate[];
    pending: boolean;
    error?: string;
  }>({ candidates: [], pending: false });
  useEffect(() => {
    try {
      const instance = new Worker(
        new URL("../core/assembly.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.current = instance;
      queue.current = createAssemblyRequestQueue((request) =>
        instance.postMessage(request),
      );
      instance.onmessage = (event: MessageEvent<Result>) => {
        const data = event.data,
          kind = data.kind ?? "analysis";
        queue.current?.complete(kind);
        if (kind === "guidance") {
          if (data.revision === guidanceRevision.current)
            setGuidance({
              candidates: data.candidates ?? [],
              pending: false,
              error: data.error,
            });
          return;
        }
        if (data.revision === revision.current)
          setResult({
            analysis: data.analysis ?? null,
            pending: false,
            error: data.error ?? "",
          });
      };
      instance.onerror = () => {
        failure.current = "检测线程无法运行，请刷新页面重试";
        queue.current?.clear();
        queue.current = null;
        instance.terminate();
        worker.current = null;
        setResult({
          analysis: null,
          pending: false,
          error: failure.current,
        });
        setGuidance({ candidates: [], pending: false });
      };
      return () => {
        revision.current++;
        guidanceRevision.current++;
        queue.current?.clear();
        queue.current = null;
        instance.terminate();
        worker.current = null;
      };
    } catch {
      failure.current = "当前设备无法启动装配检测线程";
      setResult({
        analysis: null,
        pending: false,
        error: failure.current,
      });
    }
  }, []);
  useEffect(() => {
    const id = ++revision.current;
    if (!queue.current) {
      setResult({
        analysis: null,
        pending: false,
        error: failure.current || "装配检测线程未就绪",
      });
      return;
    }
    setResult({ analysis: null, pending: true, error: "" });
    const timer = setTimeout(
      () =>
        queue.current?.enqueue({
          kind: "analysis",
          revision: id,
          project: input,
          assembly: preview,
        }),
      90,
    );
    return () => clearTimeout(timer);
  }, [input, preview]);
  useEffect(() => {
    const id = ++guidanceRevision.current;
    setGuidance({ candidates: [], pending: !!selected && !!queue.current });
    if (selected)
      queue.current?.enqueue({
        kind: "guidance",
        revision: id,
        project: input,
        assembly: committed,
        partId: selected,
      });
  }, [input, committed, selected]);
  return {
    ...result,
    candidates: guidance.candidates,
    guidancePending: guidance.pending,
    guidanceError: guidance.error,
  };
}
