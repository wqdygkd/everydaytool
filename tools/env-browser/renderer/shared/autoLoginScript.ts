/**
 * 生成在 webview 内执行的自动登录脚本
 * 启发式定位：password 输入框 + 同表单 username 输入框
 */
export function buildAutoLoginScript(username: string, password: string): string {
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/'/g, '\\\'').replace(/\n/g, '\\n')
  const u = esc(username)
  const p = esc(password)
  // 需在 webview.executeJavaScript 中执行，返回 Promise<boolean>
  return `
(async () => {
  const username = '${u}';
  const password = '${p}';
  function delay(ms){ return new Promise(r=>setTimeout(r,ms)); }
  function dispatch(el, val){
    const proto = el.tagName === 'INPUT' ? HTMLInputElement.prototype : HTMLElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if(desc && desc.set){
      desc.set.call(el, val);
    } else {
      el.value = val;
    }
    el.dispatchEvent(new Event('input', {bubbles:true}));
    el.dispatchEvent(new Event('change', {bubbles:true}));
    el.dispatchEvent(new KeyboardEvent('keydown', {bubbles:true}));
    el.dispatchEvent(new KeyboardEvent('keyup', {bubbles:true}));
  }
  // 查找密码框
  let pwd = document.querySelector('input[type="password"]');
  if(!pwd){
    // 尝试查找 type 未标注但 name 含 pwd/pass 的
    pwd = document.querySelector('input[name*="pass" i], input[id*="pass" i], input[placeholder*="密码" i]');
  }
  if(!pwd) return { ok:false, reason:'no-password-input' };
  let form = pwd.closest('form');
  let user = null;
  if(form){
    const candidates = Array.from(form.querySelectorAll('input'));
    // 优先 name/id/placeholder 含 user/name/account/email/phone
    user = candidates.find(el => {
      if(el === pwd) return false;
      if(el.type === 'hidden' || el.type === 'password' || el.type === 'checkbox' || el.type === 'radio') return false;
      const s = (el.name + ' ' + el.id + ' ' + (el.placeholder||'') + ' ' + (el.autocomplete||'')).toLowerCase();
      return /user|name|account|email|phone|tel|mobile|用户名|账号|手机号/.test(s);
    });
    if(!user){
      user = candidates.find(el => el !== pwd && (el.type==='text' || el.type==='email' || el.type==='tel') && el.offsetParent !== null);
    }
  }
  if(!user){
    user = document.querySelector('input[type="text"], input[type="email"], input[type="tel"], input[name*="user" i], input[id*="user" i], input[autocomplete="username"]');
    if(user === pwd) user = null;
  }
  if(!user) return { ok:false, reason:'no-username-input' };

  try{
    user.focus();
    await delay(80);
    dispatch(user, username);
    await delay(120);
    pwd.focus();
    await delay(80);
    dispatch(pwd, password);
    await delay(200);
    // 尝试自动提交
    // 1) form submit
    // 2) 点击提交按钮
    let submitted = false;
    const submitBtn = form ? form.querySelector('button[type="submit"], input[type="submit"], button:not([type]), [class*="login" i] button, [id*="login" i]') : null;
    const globalBtn = document.querySelector('button[type="submit"], input[type="submit"]');
    const btn = submitBtn || globalBtn;
    if(btn){
      // 检查是否 disabled
      if(!btn.hasAttribute('disabled')){
        btn.click();
        submitted = true;
      }
    }
    if(!submitted && form && typeof form.requestSubmit === 'function'){
      try{ form.requestSubmit(); submitted = true; }catch{}
    }
    return { ok:true, submitted, userFound: !!user, pwdFound: !!pwd };
  }catch(e){
    return { ok:false, reason: String(e) };
  }
})();
`
}
