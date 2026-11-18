// Reuse the exact fixed photos already registered for the former V3 uploader.
export const FIXED_GENJUTSU_MODELS = [
  {key:'jujuh',name:'Jujuh',tag:'JUJUH'},
  {key:'sahry_japah',name:'Sahry Japah',tag:'SAHRY JAPAH'},
];
const check=(r:any)=>{if(r.error)throw r.error;return r.data;};
export async function fixedGenjutsuModels(admin:any,owner:string,signGet:any){
  const rows=check(await admin.from('genjutsu_v3_models').select('model_key,photo_id').eq('user_id',owner))||[];
  return Promise.all(FIXED_GENJUTSU_MODELS.map(async model=>{
    const row=rows.find((r:any)=>r.model_key===model.key);
    const photo=row?.photo_id?check(await admin.from('genjutsu_v3_model_photos').select('id,model_key,storage_path,mime_type,size_bytes')
      .eq('id',row.photo_id).eq('user_id',owner).eq('model_key',model.key).maybeSingle()):null;
    return {...model,photo_id:photo?.id||null,photo_url:photo?await signGet('r2',photo.storage_path):null,
      mime_type:photo?.mime_type||null,size_bytes:photo?.size_bytes||null};
  }));
}
export async function fixedGenjutsuPhoto(admin:any,owner:string,body:any,old:any){
  if(!body.model_key)return null;
  const model=FIXED_GENJUTSU_MODELS.find(m=>m.key===body.model_key);
  if(!model)throw new Error('Modelo inválida.');
  const prior=old?.meta?.fixed_model;
  if(prior){
    if(prior.key!==model.key||prior.photo_id!==body.photo_id)throw new Error('A modelo deste envio já foi fixada. Crie um novo envio para trocar.');
    return prior;
  }
  if(old)throw new Error('O modo deste envio já foi fixado. Crie um novo envio.');
  const current=check(await admin.from('genjutsu_v3_models').select('photo_id').eq('user_id',owner).eq('model_key',model.key).maybeSingle());
  if(!current?.photo_id||current.photo_id!==body.photo_id)throw new Error('A foto fixa mudou. Atualize e selecione a modelo novamente.');
  const photo=check(await admin.from('genjutsu_v3_model_photos').select('id,storage_path,mime_type,size_bytes')
    .eq('id',current.photo_id).eq('user_id',owner).eq('model_key',model.key).maybeSingle());
  if(!photo?.storage_path?.startsWith(owner+'/')||!['image/jpeg','image/png','image/webp'].includes(photo.mime_type)||
    !Number.isSafeInteger(photo.size_bytes)||photo.size_bytes<1||photo.size_bytes>10*1024*1024)throw new Error('Foto fixa indisponível.');
  return {...model,photo_id:photo.id,path:photo.storage_path,mime:photo.mime_type,size:photo.size_bytes,
    name:model.name+(photo.mime_type==='image/png'?'.png':photo.mime_type==='image/webp'?'.webp':'.jpg')};
}
