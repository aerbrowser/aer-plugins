// Host API 3. Only the isolated plugin main frame receives this transport.
let sequence = 0;
const pending = new Map();
window.__aerReply = ({id, result, error}) => {
  const call = pending.get(id);
  if (!call) return;
  clearTimeout(call.timer); pending.delete(id);
  error ? call.reject(new Error(error)) : call.resolve(result);
};
function invoke(method, params = {}) {
  return new Promise((resolve, reject) => {
    const transport = window.webkit?.messageHandlers?.aer;
    if (!transport) return reject(new Error('请从支持浮动插件的 AER 中打开。'));
    const id = String(++sequence);
    const timer = setTimeout(() => { pending.delete(id); if(method === 'ai.transform') transport.postMessage({id: 'cancel-'+id, method: 'ai.cancel', params: {}}); reject(new Error('请求超时，请重试。')); }, 180000);
    pending.set(id, {resolve, reject, timer});
    try { transport.postMessage({id, method, params}); }
    catch (error) { clearTimeout(timer); pending.delete(id); reject(error); }
  });
}
export const aer = Object.freeze({
  page: {capture: () => invoke('page.capture')},
  ai: {transform: (action, text, target) => invoke('ai.transform', {action, text, target}), cancel: () => invoke('ai.cancel')},
  storage: {get: () => invoke('storage.get'), put: draft => invoke('storage.put', {draft})},
  clipboard: {write: text => invoke('clipboard.write', {text})},
  panel: {close: () => invoke('panel.close'), minimize: () => invoke('panel.minimize'), menu: () => invoke('panel.menu')},
  settings: () => invoke('settings.open')
});
