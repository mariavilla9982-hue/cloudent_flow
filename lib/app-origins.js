const CANONICAL="https://cloudent-flow.vercel.app";
// Both names are verified production domains of the same Vercel project.
const ORIGINS=new Set([CANONICAL,"https://cloudentflow-pc.vercel.app"]);

export function appOrigin(req){
  const candidate="https://"+String(req.headers?.host||"").toLowerCase();
  return ORIGINS.has(candidate)?candidate:CANONICAL;
}

export function sameAppOrigin(req){
  const origin=String(req.headers?.origin||"");
  const destination="https://"+String(req.headers?.host||"").toLowerCase();
  return ORIGINS.has(destination)&&origin===destination;
}
