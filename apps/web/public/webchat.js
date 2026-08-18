/**
 * SEEG Omni — loader do webchat embutível.
 * Uso: <script src="https://chat.../webchat.js" data-org="minha-org" async></script>
 * ES5 puro, sem build, sem globals (IIFE). Injeta a bolha flutuante + iframe
 * apontando para {origin}/webchat/widget e conversa com ele via postMessage.
 */
(function () {
  'use strict';

  if (window.__smWebchatLoaded) return;
  window.__smWebchatLoaded = true;

  // ------------------------------------------------------------ script/origin
  var script = document.currentScript;
  if (!script) {
    // Fallback (navegadores antigos): último <script> com data-org apontando p/ webchat.js
    var scripts = document.getElementsByTagName('script');
    for (var i = scripts.length - 1; i >= 0; i--) {
      var s = scripts[i];
      if (s.src && s.src.indexOf('webchat.js') !== -1 && s.getAttribute('data-org')) {
        script = s;
        break;
      }
    }
  }
  if (!script || !script.src) return;

  var org = script.getAttribute('data-org');
  if (!org) {
    if (window.console && console.warn) console.warn('[sm-webchat] atributo data-org ausente');
    return;
  }

  // Deriva o origin do próprio src do script (funciona em qualquer página).
  var anchor = document.createElement('a');
  anchor.href = script.src;
  var chatOrigin = anchor.protocol + '//' + anchor.host;

  var widgetUrl =
    chatOrigin +
    '/webchat/widget?org=' +
    encodeURIComponent(org) +
    '&parent=' +
    encodeURIComponent(window.location.protocol + '//' + window.location.host);

  // ------------------------------------------------------------------- estilos
  var Z = 2147483000;
  var css =
    '.sm-wc-btn{position:fixed;right:20px;bottom:20px;width:56px;height:56px;border:0;margin:0;' +
    'padding:0;border-radius:50%;cursor:pointer;z-index:' + (Z + 2) + ';' +
    'background:linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%);' +
    'box-shadow:0 4px 12px rgba(79,70,229,.35),0 2px 4px rgba(0,0,0,.12);' +
    'display:block;line-height:0;-webkit-tap-highlight-color:transparent;' +
    'transition:transform .18s ease,box-shadow .18s ease;}' +
    '.sm-wc-btn:hover{transform:scale(1.06);box-shadow:0 6px 18px rgba(79,70,229,.45),0 2px 6px rgba(0,0,0,.15);}' +
    '.sm-wc-btn:active{transform:scale(.96);}' +
    '.sm-wc-btn svg{position:absolute;top:50%;left:50%;margin:-13px 0 0 -13px;width:26px;height:26px;' +
    'transition:opacity .18s ease,transform .18s ease;}' +
    '.sm-wc-icon-close{opacity:0;transform:rotate(-45deg) scale(.6);}' +
    '.sm-wc-open .sm-wc-icon-chat{opacity:0;transform:rotate(45deg) scale(.6);}' +
    '.sm-wc-open .sm-wc-icon-close{opacity:1;transform:rotate(0) scale(1);}' +
    '.sm-wc-badge{position:absolute;top:-4px;right:-4px;min-width:20px;height:20px;border-radius:10px;' +
    'background:#ef4444;color:#fff;font:700 11px/20px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
    'text-align:center;padding:0 5px;box-sizing:border-box;display:none;box-shadow:0 1px 3px rgba(0,0,0,.3);}' +
    '.sm-wc-frame{position:fixed;right:20px;bottom:88px;width:380px;max-width:calc(100vw - 40px);' +
    'height:600px;max-height:calc(100vh - 110px);border:0;border-radius:16px;z-index:' + (Z + 1) + ';' +
    'background:transparent;box-shadow:0 12px 40px rgba(0,0,0,.22),0 4px 12px rgba(0,0,0,.12);' +
    'opacity:0;visibility:hidden;pointer-events:none;transform:translateY(12px) scale(.97);' +
    'transform-origin:bottom right;' +
    'transition:opacity .22s ease,transform .22s cubic-bezier(.16,1,.3,1),visibility 0s linear .22s;}' +
    '.sm-wc-open .sm-wc-frame{opacity:1;visibility:visible;pointer-events:auto;' +
    'transform:translateY(0) scale(1);transition:opacity .22s ease,transform .22s cubic-bezier(.16,1,.3,1);}' +
    '@media (max-width:640px){' +
    '.sm-wc-frame{right:0;bottom:0;left:0;top:0;width:100%;height:100%;max-width:none;max-height:none;border-radius:0;}' +
    '.sm-wc-open .sm-wc-btn{opacity:0;pointer-events:none;}' +
    '}';

  // ------------------------------------------------------------------ monta UI
  function mount() {
    var style = document.createElement('style');
    style.type = 'text/css';
    if (style.styleSheet) style.styleSheet.cssText = css; // IE
    else style.appendChild(document.createTextNode(css));
    document.head.appendChild(style);

    var root = document.createElement('div');
    root.setAttribute('data-sm-webchat', '');

    var iframe = document.createElement('iframe');
    iframe.className = 'sm-wc-frame';
    // src é atribuído LAZY no primeiro clique na bolha: nenhum request ao chat
    // (nem criação de sessão) acontece por pageview — só quando o visitante
    // realmente abre o widget. Também melhora a performance da página host.
    iframe.title = 'Chat de atendimento';
    iframe.setAttribute('allow', 'autoplay');
    iframe.setAttribute('aria-hidden', 'true');

    var btn = document.createElement('button');
    btn.className = 'sm-wc-btn';
    btn.type = 'button';
    btn.setAttribute('aria-label', 'Abrir chat de atendimento');
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML =
      '<svg class="sm-wc-icon-chat" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>' +
      '<svg class="sm-wc-icon-close" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>' +
      '<span class="sm-wc-badge"></span>';

    root.appendChild(iframe);
    root.appendChild(btn);
    document.body.appendChild(root);

    var badge = btn.getElementsByTagName('span')[0];
    var isOpen = false;

    function notifyVisibility() {
      if (iframe.contentWindow) {
        try {
          iframe.contentWindow.postMessage({ type: 'sm-webchat:visibility', open: isOpen }, chatOrigin);
        } catch (e) { /* iframe ainda não navegou */ }
      }
    }

    function setBadge(count) {
      if (count > 0 && !isOpen) {
        badge.style.display = 'block';
        badge.innerHTML = count > 99 ? '99+' : String(count);
      } else {
        badge.style.display = 'none';
      }
    }

    function setOpen(next) {
      isOpen = next;
      if (isOpen && !iframe.getAttribute('src')) {
        iframe.src = widgetUrl; // lazy-load no primeiro open
      }
      if (isOpen) {
        root.className = 'sm-wc-open';
        iframe.setAttribute('aria-hidden', 'false');
        btn.setAttribute('aria-expanded', 'true');
        btn.setAttribute('aria-label', 'Fechar chat de atendimento');
        setBadge(0);
      } else {
        root.className = '';
        iframe.setAttribute('aria-hidden', 'true');
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('aria-label', 'Abrir chat de atendimento');
      }
      notifyVisibility();
    }

    btn.onclick = function () {
      setOpen(!isOpen);
    };

    iframe.onload = notifyVisibility;

    // Mensagens vindas do widget — valida SEMPRE o origin do iframe.
    window.addEventListener('message', function (event) {
      if (event.origin !== chatOrigin) return;
      var data = event.data;
      if (!data || typeof data.type !== 'string') return;
      if (data.type === 'sm-webchat:unread') {
        setBadge(typeof data.count === 'number' ? data.count : 0);
      } else if (data.type === 'sm-webchat:close') {
        setOpen(false);
      }
    });
  }

  if (document.body) mount();
  else if (document.addEventListener) document.addEventListener('DOMContentLoaded', mount);
  else window.onload = mount; // último recurso (navegadores muito antigos)
})();
