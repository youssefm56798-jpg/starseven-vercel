'use client';
import {createContext,useContext,useState,useEffect,forwardRef,createElement} from 'react';
import {usePathname} from 'next/navigation';
import {ADMIN_LANGUAGE_COOKIE,adminLanguage,adminTranslate,adminFormat,adminTitle} from '../../../lib/admin-copy.mjs';
const Language=createContext('en');
const ChangeLanguage=createContext(()=>{});
export const useAdminLanguage=()=>useContext(Language);
export function AdminLocaleProvider({lang,children}) {
  const [selected,setSelected]=useState(()=>adminLanguage(lang));
  const path=usePathname();
  useEffect(()=>{document.title=adminTitle(selected,document.title);},[selected,path]);
  const choose=value=>{
    if(value===selected)return;
    document.cookie=`${ADMIN_LANGUAGE_COOKIE}=${value}; Path=/admin; Max-Age=31536000; SameSite=Lax${location.protocol==='https:'?'; Secure':''}`;
    setSelected(value);
  };
  return <Language.Provider value={selected}><ChangeLanguage.Provider value={choose}><div className="s7admin" dir={selected==='ar'?'rtl':'ltr'} lang={selected}>{children}</div></ChangeLanguage.Provider></Language.Provider>;
}
export function AdminText({text,values=[],translateValues=false}) {
  const lang=useAdminLanguage();
  // Only controlled labels opt in. Merchant/customer text stays as entered.
  const localized=translateValues?values.map(value=>Array.isArray(value)?value.map(label=>adminTranslate(lang,label)).join(', '):adminTranslate(lang,value)):values;
  return <>{adminTranslate(lang,text,localized)}</>;
}
export function AdminFormat({value,kind}) { return <>{adminFormat(useAdminLanguage(),value,kind)}</>; }
export const AdminElement=forwardRef(function AdminElement({as:Tag='input',children,...props},ref){
  const lang=useAdminLanguage();
  for(const key of ['placeholder','title','aria-label','alt'])if(typeof props[key]==='string')props[key]=adminTranslate(lang,props[key]);
  return createElement(Tag,{...props,ref},children);
});
export function LanguageSwitch(){
  const lang=useAdminLanguage();
  const choose=useContext(ChangeLanguage);
  return <div className="admin-language" role="group" aria-label="Language / اللغة"><button type="button" lang="en" aria-pressed={lang==='en'} onClick={()=>choose('en')}>English</button><button type="button" lang="ar" aria-pressed={lang==='ar'} onClick={()=>choose('ar')}>العربية</button></div>;
}

export function AdminActor({value}){
  const match=String(value??'').match(/^admin:(\d+)$/);
  return match?<AdminText text="Admin #{0}" values={[match[1]]}/>:String(value??'').startsWith('system')?<AdminText text="Automatic"/>:<>{value}</>;
}
export function StockReason({value}){
  return ['stock-write','order-reservation','order-edit','order-status','return-receipt','product-change','product-edit'].includes(value)?<AdminText text={value}/>:<>{value}</>;
}
