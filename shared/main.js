import {aer} from './aer.js';
import config from './config.js';
const $ = id => document.getElementById(id);
$('name').textContent = config.name; $('mark').textContent = config.glyph;
document.title = config.name;
let busy = false, source = null, revision = 0, saveTimer, saveChain = Promise.resolve();
const status = (text, error = false) => { $('status').textContent = text; $('status').dataset.error = String(error); };
function changed() { revision++; $('count').textContent = `${$('input').value.length} 字`; }
function save() {
  clearTimeout(saveTimer);
  const draft = {input:$('input').value, output:$('output').value, source, target:$('target').value};
  saveChain = saveChain.catch(() => {}).then(() => aer.storage.put(draft)).then(() => true).catch(e => { status(`草稿保存失败：${e.message}`, true); return false; });
  return saveChain;
}
function edit() { changed(); clearTimeout(saveTimer); saveTimer = setTimeout(save, 350); }
$('input').addEventListener('input', edit); $('output').addEventListener('input', edit); $('target').addEventListener('change', edit);
function locked(value) { busy=value; document.querySelectorAll('[data-action],#capture').forEach(b => b.disabled=value); $('cancel').hidden=!value; }
$('capture').onclick = async () => {
  locked(true); status('正在读取页面…'); const before=revision;
  try { const page=await aer.page.capture(); if(before!==revision)throw new Error('素材已编辑，请再次读取。'); source=page; $('input').value=page.text; $('source').textContent=page.title||page.url; $('source').title=page.url; changed(); if(!await save())return; status(page.text?'已读取；点击翻译、二创或缩写继续':'未找到正文，请选中文字或粘贴素材。'); }
  catch(e){status(e.message,true);} finally{locked(false);}
};
for(const button of document.querySelectorAll('[data-action]')) button.onclick=async()=>{
  if(busy)return; const text=$('input').value.trim(); if(!text)return status('请先读取页面或粘贴素材。',true);
  locked(true); status('正在生成…'); const before=revision;
  try { const result=await aer.ai.transform(button.dataset.action,text,$('target').value); if(before!==revision)throw new Error('素材或草稿已修改，未覆盖你的编辑，请重新生成。'); $('output').value=result.text; changed(); if(!await save())return; status('已生成，请核对事实与来源后使用。'); }
  catch(e){status(e.message,true);}finally{locked(false);}
};
$('cancel').onclick=()=>aer.ai.cancel().catch(e=>status(e.message,true));
$('copy').onclick=async()=>{try{await aer.clipboard.write($('output').value);status('已复制');}catch(e){status(e.message,true);}};
$('close').onclick=async()=>{try{if(await save())await aer.panel.close();}catch(e){status(e.message,true);}};
$('minimize').onclick=()=>aer.panel.minimize().catch(e=>status(e.message,true));
$('menu').onclick=()=>aer.panel.menu().catch(e=>status(e.message,true));
$('settings').onclick=()=>aer.settings().catch(e=>status(e.message,true));
document.addEventListener('contextmenu', e=>{e.preventDefault();aer.panel.menu().catch(e=>status(e.message,true));});
const initial=revision;
try { const draft=await aer.storage.get(); if(initial===revision&&draft){ $('input').value=draft.input||''; $('output').value=draft.output||''; source=draft.source||null; if(source)$('source').textContent=source.title||source.url; if(draft.target)$('target').value=draft.target; changed(); } }
catch(e){status(e.message,true);}
