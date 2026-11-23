// Published workflows stay untouched; Genjutsu also authorizes prompt #910 per execution.
export const PIPELINE_VIDEO_WORKFLOWS = [
  {key:'genjutsu',label:'GENJUTSU 0',workflowId:'2124648844280733698',videoNodeId:'970',videoFieldName:'video',frameNodeId:'496',frameFieldName:'image',outputNodeId:'482'},
  {key:'motion_control',label:'Motion Control V7',workflowId:'2110721194974982146',videoNodeId:'275',videoFieldName:'video',frameNodeId:'299',frameFieldName:'image',outputNodeId:'285'}
];
export function pipelineVideoWorkflow(key:string){
  const workflow=PIPELINE_VIDEO_WORKFLOWS.find(w=>w.key===key);
  if(!workflow)throw new Error('Workflow de vídeo inválido.');
  return {...workflow};
}
