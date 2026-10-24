// Cancel only a chained Motion that has not been claimed or sent to RunningHub.
export async function cancelPipelineMotion(admin:any,userId:string,id:string){
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))return {ok:false,error:'Job inválido.',status:400};
  const {data,error}=await admin.rpc('cancel_waiting_pipeline_motion',{p_id:id,p_user_id:userId});
  if(error)throw error;
  if(data?.ok)return data;
  return {...data,ok:false,error:data?.reason==='not_found'?'Pipeline não encontrado.':'A fila está atualizando ou o envio já começou. Aguarde a atualização do status e tente novamente.'};
}
