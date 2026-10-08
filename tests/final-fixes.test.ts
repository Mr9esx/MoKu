import { expect, it, vi } from 'vitest';
import { measureLayout, remnantAxis, validateLayout } from '../src/core/geometry';
import { createWorkbenchStore, defaults, startSearch, workbench } from '../src/store';
import { optimizeLayout } from '../src/core/nesting';
import type { Project } from '../src/core/types';
function fixture(n = 1): Project {
  const sheets = [{ id: 's', name: 's', width: 1220, height: 2440, thickness: 12, material: 'wood' }];
  return { name: 'bounded', units: 'mm', warnings: [], sheets,
    parts: Array.from({ length: n }, (_, i) => ({ id: `${i}`, name: `${i}`, stockId: 's', layer: '', thickness: 12, width: 2, height: 2, area: 4, outline: [{x:0,y:0},{x:2,y:0},{x:2,y:2},{x:0,y:2}], holes: [], pockets: [], label: {x:1,y:1} })),
    original: { sheets, placements: Array.from({length:n}, (_,i) => ({partId:`${i}`,sheetId:'s',x:10+5*i,y:10+10*i,rotation:0})) } };
}
it('bounds remnant work for 200 valid independent parts and never crosses expanded boxes', () => {
  const p = fixture(200);
  expect(validateLayout(p,p.original,defaults)).toEqual([]);
  const start = performance.now();
  const m = measureLayout(p,p.original,defaults);
  expect(performance.now()-start).toBeLessThan(2000);
  expect(m.remnants.length).toBe(1);
  for (const r of m.remnants) {
    expect(r.x).toBeGreaterThanOrEqual(6); expect(r.y).toBeGreaterThanOrEqual(6);
    expect(r.x+r.width).toBeLessThanOrEqual(1214); expect(r.y+r.height).toBeLessThanOrEqual(2434);
    expect(r.width).toBeGreaterThanOrEqual(100); expect(r.height).toBeGreaterThanOrEqual(100);
    for(const q of p.original.placements) expect(r.x+r.width<=q.x-3 || r.x>=q.x+5 || r.y+r.height<=q.y-3 || r.y>=q.y+5).toBe(true);
  }
  expect(measureLayout(p,p.original,{...defaults,margin:700}).remnants).toEqual([]);
});
it('sends validated incumbents including the seed before any search iteration', () => {
  const p=fixture(); const updates:any[]=[];
  optimizeLayout(p,{...defaults,iterations:0},(...args)=>updates.push(args));
  expect(updates.length).toBeGreaterThan(0);
  for(const [, , layout] of updates) if(layout) expect(validateLayout(p,layout,defaults)).toEqual([]);
  expect(updates[0][2]).toEqual(p.original);
});
it('retains a legal checkpoint on cancel and rejects invalid or stale checkpoints', () => {
  const s=createWorkbenchStore(),p=fixture(); s.getState().importProject(p);
  const run=s.getState().beginSearch(); const layout=structuredClone(p.original); layout.placements[0].x=30;
  s.getState().progress(run,1,layout);
  const bad=structuredClone(layout); bad.placements=[]; s.getState().progress(run,2,bad);
  s.getState().cancel(); expect(s.getState().candidate?.layout).toEqual(layout);
  expect(s.getState().current).toEqual(p.original);
  s.getState().progress(run,3,p.original); expect(s.getState().candidate?.layout).toEqual(layout);
  s.getState().apply(); expect(s.getState().current).toEqual(layout);
});
it.each(['settings','lock','thickness','import'])('clears checkpoints on %s mutation and rejects stale progress', action => {
  const s=createWorkbenchStore(),p=fixture(); s.getState().importProject(p); const run=s.getState().beginSearch();
  s.getState().progress(run,1,p.original);
  expect(s.getState().candidate?.layout).toEqual(p.original);
  if(action==='settings')s.getState().setSettings({gap:4});
  if(action==='lock')s.getState().toggleLock('0');
  if(action==='thickness')s.getState().setThickness('s',10);
  if(action==='import')s.getState().beginImport();
  s.getState().progress(run,2,p.original); expect(s.getState().candidate).toBeNull();
});
it('Worker transport exposes a checkpoint and cancel terminates the worker without applying it', () => {
  let instance:any;
  class FakeWorker { onmessage:any; onerror:any; terminate=vi.fn(); postMessage=vi.fn(); constructor(){instance=this;} }
  vi.stubGlobal('Worker',FakeWorker);
  try {
    const p=fixture(); workbench.getState().importProject(p); startSearch();
    instance.onmessage({data:{type:'progress',attempt:1,bestLayout:p.original}});
    workbench.getState().cancel(); expect(instance.terminate).toHaveBeenCalledOnce();
    expect(workbench.getState().candidate?.layout).toEqual(p.original);
  } finally { vi.unstubAllGlobals(); }
});

it('caps coordinate storage while preserving exact stock boundaries', () => {
  const axis=remnantAxis(6,2434,Array.from({length:10000},(_,i)=>i/4));
  expect(axis).toHaveLength(256); expect(axis[0]).toBe(6); expect(axis.at(-1)).toBe(2434);
  expect(axis.every((x,i)=>i===0 || x>axis[i-1])).toBe(true);
});
it('Worker implementation posts a complete independently valid seed checkpoint', async () => {
  const messages:any[]=[];
  const scope={onmessage:undefined as any,postMessage:(data:any)=>messages.push(data)};
  vi.stubGlobal('self',scope);
  try {
    await import('../src/core/nesting.worker');
    const p=fixture();
    scope.onmessage({data:{type:'start',project:p,settings:{...defaults,iterations:0}}});
    const update=messages.find(m=>m.type==='progress');
    expect(update.bestLayout).toEqual(p.original);
    expect(validateLayout(p,update.bestLayout,defaults)).toEqual([]);
    expect(messages.at(-1).type).toBe('done');
  } finally {vi.unstubAllGlobals();}
});
it('table and canvas keep original sheet identity after cross-sheet compaction', async () => {
  const {renderToStaticMarkup}=await import('react-dom/server');
  const {createElement}=await import('react');
  const {PartsTable}=await import('../src/components/PartsTable');
  const {StockCanvas}=await import('../src/components/StockCanvas');
  const p=fixture(); p.sheets.push({...p.sheets[0],id:'target',name:'target'});
  workbench.getState().importProject(p);
  const layout={sheets:[p.sheets[1]],placements:p.original.placements.map(q=>({...q,sheetId:'target'}))};
  workbench.getState().receiveResult(workbench.getState().beginSearch(),{layout,metrics:measureLayout(p,layout,defaults),originalMetrics:measureLayout(p,p.original,defaults),attempts:1,elapsedMs:0,message:'ok',issues:[]});
  const initialState=vi.spyOn(workbench,'getInitialState').mockImplementation(workbench.getState);
  expect(renderToStaticMarkup(createElement(PartsTable))).toContain('<td>2</td>');
  expect(renderToStaticMarkup(createElement(StockCanvas,{layout,metrics:measureLayout(p,layout,defaults)}))).toContain('02 / 12 mm');
  workbench.getState().setView('original');
  expect(renderToStaticMarkup(createElement(PartsTable))).toContain('<td>1</td>');
  initialState.mockRestore();
});
