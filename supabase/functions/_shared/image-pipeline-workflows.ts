// Published workflows stay untouched; Genjutsu also authorizes prompt #910 per execution.
export const PIPELINE_VIDEO_WORKFLOWS = [
  {key:'genjutsu',label:'Genjutsu',workflowId:'2117411301344411649',videoNodeId:'970',videoFieldName:'video',frameNodeId:'496',frameFieldName:'image',outputNodeId:'482'},
  {key:'motion_control',label:'Motion Control V7',workflowId:'2110721194974982146',videoNodeId:'275',videoFieldName:'video',frameNodeId:'299',frameFieldName:'image',outputNodeId:'285'},
  {key:'standard',label:'Vídeo 7 minutos',workflowId:'2100995504908824578',videoNodeId:'336',videoFieldName:'video',frameNodeId:'338',frameFieldName:'image'}
];
export function pipelineVideoWorkflow(key:string){
  const workflow=PIPELINE_VIDEO_WORKFLOWS.find(w=>w.key===key);
  if(!workflow)throw new Error('Workflow de vídeo inválido.');
  return {...workflow};
}
