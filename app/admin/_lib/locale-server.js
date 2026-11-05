import {cookies} from 'next/headers';
import {ADMIN_LANGUAGE_COOKIE,adminLanguage,adminTranslate} from '../../../lib/admin-copy.mjs';
export async function getAdminLanguage(){return adminLanguage((await cookies()).get(ADMIN_LANGUAGE_COOKIE)?.value);}
export async function localizedAdminMetadata(metadata){
  const lang=await getAdminLanguage();
  return {...metadata,title:adminTranslate(lang,metadata.title)};
}
