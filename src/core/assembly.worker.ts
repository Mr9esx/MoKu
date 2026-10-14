import type { Project } from './types';
import type { Assembly } from './assemblyTypes';
import { analyzeAssembly } from './assemblyChecks';
self.onmessage=(event:MessageEvent<{revision:number;project:Project;assembly:Assembly}>)=>{
  const {revision,project,assembly}=event.data;
  try{self.postMessage({revision,analysis:analyzeAssembly(project,assembly,{installation:true})});}
  catch(error){self.postMessage({revision,error:error instanceof Error?error.message:'装配检查失败'});}
};
