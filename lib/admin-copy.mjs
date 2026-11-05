import { AR } from './admin-ar.mjs';
export const ADMIN_LANGUAGE_COOKIE='s7_admin_lang';
export const adminLanguage=value=>value==='ar'?'ar':'en';
export function adminTitle(lang,title){
  const entries=Object.entries(AR).filter(([k])=>k==='Star Seven admin'||k.endsWith('— Star Seven admin')).sort((a,b)=>b[0].length-a[0].length);
  for(const [en,ar]of entries){
    for(const alias of [en,en.replace(/\u2014/g,'-')])if(title.startsWith(alias))return (lang==='ar'?ar:en)+title.slice(alias.length);
    if(title.startsWith(ar))return (lang==='ar'?ar:en)+title.slice(ar.length);
  }
  return title;
}
const patterns=Object.entries(AR).filter(([k])=>/\{\d+\}/.test(k)).map(([key,value])=>{
  const parts=key.split(/\{\d+\}/);
  return {regex:new RegExp('^'+parts.map(p=>p.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('(.*?)')+'$'),value};
});
export function adminTranslate(lang, key, values=[]) {
  if(typeof key!=='string')return key;
  let translated=key;
  if(lang==='ar'){
    translated=Object.hasOwn(AR,key)?AR[key]:key;
    if(translated===key&&!Object.hasOwn(AR,key))for(const p of patterns){const match=key.match(p.regex);if(match){translated=p.value;values=match.slice(1);break;}}
  }
  return translated.replace(/\{(\d+)\}/g,(token,index)=>String(values[Number(index)]??token));
}
export function adminFormat(lang,value,kind='number') {
  const locale=lang==='ar'?'ar-EG':'en-GB';
  if(kind==='money')return new Intl.NumberFormat(locale,{style:'currency',currency:'EGP',minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value)||0);
  if(kind==='number')return new Intl.NumberFormat(locale,{maximumFractionDigits:0}).format(Number(value)||0);
  if(!value)return '—';
  const date=value instanceof Date?value:new Date(String(value).replace(' ','T').replace(/([+-]\d{2})$/,'$1:00'));
  if(!Number.isFinite(date.getTime()))return '—';
  const options={timeZone:'Africa/Cairo',day:'numeric',month:'short'};
  if(kind==='day'||kind==='offerDateTime')options.year='numeric';
  if(kind==='dt'||kind==='offerDateTime'){options.hour='2-digit';options.minute='2-digit';options.hourCycle='h23';}
  if(kind==='offerDateTime')options.timeZoneName='shortOffset';
  return new Intl.DateTimeFormat(locale,options).format(date);
}
