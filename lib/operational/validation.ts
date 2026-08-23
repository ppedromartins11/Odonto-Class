import type { FileCategory } from "./types";
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const ALLOWED = new Map([["application/pdf", "pdf"], ["image/jpeg", "jpg"], ["image/png", "png"]]);
function signatureMatches(bytes: Uint8Array, mime: string) { if(mime==="application/pdf") return String.fromCharCode(...bytes.slice(0,5))==="%PDF-"; if(mime==="image/jpeg") return bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff; return bytes[0]===0x89&&bytes[1]===0x50&&bytes[2]===0x4e&&bytes[3]===0x47&&bytes[4]===0x0d&&bytes[5]===0x0a&&bytes[6]===0x1a&&bytes[7]===0x0a; }
export function safeUpload(file: {name:string;type:string;size:number}, bytes: Uint8Array, category: string): { ok: true; extension: string; category: FileCategory } | { ok: false; error: string } {
  if(category!=="administrativo"&&category!=="clinico")return{ok:false,error:"Categoria inválida."}; const extension=file.name.split(".").pop()?.toLowerCase();const expected=ALLOWED.get(file.type);
  if(!expected||!extension||(expected!==extension&&!(expected==="jpg"&&extension==="jpeg"))||!signatureMatches(bytes,file.type))return{ok:false,error:"Envie somente PDF, JPEG ou PNG válidos."}; if(!file.size||file.size>MAX_UPLOAD_BYTES)return{ok:false,error:"O arquivo deve ter no máximo 10 MiB."}; return{ok:true,extension:expected,category};
}
