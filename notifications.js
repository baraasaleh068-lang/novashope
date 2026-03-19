// ===== NOVASHOP NOTIFICATIONS SYSTEM =====
// يقرأ من السيرفر أولاً (notifications.json) ثم localStorage كـ fallback

const NS_Notifications = {

  // ===== KEY المحلي =====
  _key() {
    const s = JSON.parse(localStorage.getItem("ns_session") || "null");
    return s ? "ns_notif_" + s.id : "ns_notif_guest";
  },
  _token() {
    return localStorage.getItem("ns_token") || "";
  },
  _origin() {
    const o = window.location.origin;
    return (o.startsWith("file") || o === "null") ? "http://localhost:3001" : o;
  },

  // ===== قراءة من السيرفر =====
  async fetchFromServer() {
    const token = this._token();
    if (!token) return null;
    try {
      const res = await fetch(this._origin() + "/api/notifications", {
        headers: { "Authorization": "Bearer " + token },
        signal: AbortSignal.timeout(4000)
      });
      const data = await res.json();
      if (data.ok) {
        // احفظ محلياً كـ cache
        localStorage.setItem(this._key(), JSON.stringify(data.notifications));
        return data.notifications;
      }
    } catch {}
    return null;
  },

  // ===== STORAGE المحلي =====
  getAll() {
    return JSON.parse(localStorage.getItem(this._key()) || "[]");
  },
  save(notifs) {
    localStorage.setItem(this._key(), JSON.stringify(notifs));
  },
  getUnreadCount() {
    return this.getAll().filter(n => !n.read).length;
  },

  // ===== قراءة الكل وتحديث =====
  async loadAndRender() {
    const fromServer = await this.fetchFromServer();
    if (fromServer !== null) {
      this.updateBadge();
      this.renderPanel();
    }
  },

  // ===== Mark All Read =====
  async markAllRead() {
    // محلياً
    this.save(this.getAll().map(n => ({ ...n, read: true })));
    this.updateBadge();
    this.renderPanel();
    // سيرفر
    try {
      await fetch(this._origin() + "/api/notifications/read-all", {
        method: "PUT",
        headers: { "Authorization": "Bearer " + this._token() },
        signal: AbortSignal.timeout(4000)
      });
    } catch {}
  },

  // ===== Delete One =====
  async deleteOne(id) {
    this.save(this.getAll().filter(n => n.id !== id));
    this.updateBadge();
    this.renderPanel();
    try {
      await fetch(this._origin() + "/api/notifications/" + id, {
        method: "DELETE",
        headers: { "Authorization": "Bearer " + this._token() },
        signal: AbortSignal.timeout(4000)
      });
    } catch {}
  },

  // ===== Clear All =====
  clearAll() {
    this.save([]);
    this.updateBadge();
    this.renderPanel();
  },

  // ===== ADD (محلي فقط — للإشعارات التلقائية) =====
  add(type, title, body, link = null, icon = null) {
    const notif = this._buildNotif(type, title, body, link, icon);
    const notifs = this.getAll();
    notifs.unshift(notif);
    if (notifs.length > 50) notifs.splice(50);
    this.save(notifs);
    this.updateBadge();
    this.showPopup(notif);
    return notif;
  },

  // ===== بناء كائن الإشعار =====
  _buildNotif(type, title, body, link = null, icon = null) {
    const icons = {
      order:"🛒", promo:"🎁", system:"⚙️", welcome:"👋",
      security:"🔐", shipping:"🚚", delivery:"📦",
    };
    return {
      id:        "notif_" + Date.now() + "_" + Math.random().toString(36).slice(2),
      type, title, body, link,
      icon:      icon || icons[type] || "🔔",
      read:      false,
      createdAt: new Date().toISOString(),
    };
  },

  // ===== writeToUser (يُستخدم من admin) =====
  writeToUser(userId, type, title, body, link = null, icon = null) {
    // كتابة محلية كـ fallback
    const key    = "ns_notif_" + userId;
    const notifs = JSON.parse(localStorage.getItem(key) || "[]");
    const notif  = this._buildNotif(type, title, body, link, icon);
    notifs.unshift(notif);
    if (notifs.length > 50) notifs.splice(50);
    localStorage.setItem(key, JSON.stringify(notifs));
    // إذا المستخدم الحالي هو المُرسَل إليه
    const session = JSON.parse(localStorage.getItem("ns_session") || "null");
    if (session && String(session.id) === String(userId)) {
      this.updateBadge();
      this.showPopup(notif);
    }
    return notif;
  },

  // ===== POLLING: تحقق من إشعارات جديدة كل 5 ثوانٍ =====
  _lastCount: -1,
  startPolling() {
    setInterval(async () => {
      // تحقق من حالة الحساب - محظور أو محذوف
      const token = this._token();
      if (token) {
        try {
          const res = await fetch(this._origin() + "/api/user/me", {
            headers: {"Authorization":"Bearer "+token},
            signal: AbortSignal.timeout(4000)
          }).then(r => r.json());
          if (res.force_logout || res.banned) {
            localStorage.removeItem("ns_session");
            localStorage.removeItem("ns_token");
            alert(res.banned ? "⛔ تم حظر حسابك من قبل المدير." : "⚠️ تم حذف حسابك.");
            window.location.href = "index.html";
            return;
          }
        } catch {}
      }

      const fromServer = await this.fetchFromServer();
      const count = this.getUnreadCount();
      if (count !== this._lastCount) {
        this._lastCount = count;
        this.updateBadge();
        // إذا وصل إشعار جديد — أظهره كـ popup
        if (count > 0 && fromServer) {
          const newest = fromServer.find(n => !n.read);
          if (newest) {
            const lastShown = localStorage.getItem("ns_last_shown_notif");
            if (lastShown !== newest.id) {
              localStorage.setItem("ns_last_shown_notif", newest.id);
              this.showPopup(newest);
            }
          }
        }
        const panel = document.getElementById("notifPanel");
        if (panel && panel.classList.contains("open")) this.renderPanel();
      }
    }, 5000);
  },

  // ===== BADGE =====
  updateBadge() {
    const count = this.getUnreadCount();
    this._lastCount = count;
    // Update App Badge (PWA)
    navigator.setAppBadge?.(count).catch?.(() => {});
    // Update mobile menu count
    const mobileCount = document.getElementById("notifMobileCount");
    if (mobileCount) {
      mobileCount.textContent = count > 9 ? "9+" : count;
      mobileCount.style.display = count > 0 ? "inline" : "none";
    }
    document.querySelectorAll(".notif-badge").forEach(b => {
      b.textContent = count > 9 ? "9+" : count;
      b.style.display = count > 0 ? "flex" : "none";
    });
  },

  // ===== POPUP =====
  showPopup(notif) {
    const existing = document.getElementById("notif-popup");
    if (existing) existing.remove();
    const popup = document.createElement("div");
    popup.id = "notif-popup";
    popup.style.cssText = `
      position:fixed;bottom:90px;right:16px;left:16px;z-index:99999;
      background:#111827;border:1px solid rgba(99,102,241,0.35);
      border-radius:16px;padding:16px 20px;
      display:flex;align-items:flex-start;gap:12px;
      box-shadow:0 20px 60px rgba(0,0,0,0.6);
      max-width:380px;min-width:0;
      margin:0 auto;
      animation:notifSlideIn 0.4s cubic-bezier(0.34,1.56,0.64,1);
      cursor:${notif.link ? "pointer" : "default"};
    `;
    popup.innerHTML = `
      <span style="font-size:1.8rem;flex-shrink:0;line-height:1">${notif.icon}</span>
      <div style="flex:1;min-width:0">
        <div style="font-weight:700;font-size:0.9rem;color:#f1f5f9;margin-bottom:3px">${notif.title}</div>
        <div style="color:#94a3b8;font-size:0.82rem;line-height:1.5;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical">${notif.body}</div>
      </div>
      <button onclick="event.stopPropagation();this.parentElement.remove()"
        style="background:none;border:none;color:#64748b;cursor:pointer;font-size:1.1rem;padding:0;flex-shrink:0">✕</button>
    `;
    if (notif.link) popup.addEventListener("click", () => window.location.href = notif.link);
    document.body.appendChild(popup);
    setTimeout(() => { if (popup.isConnected) popup.style.animation = "notifSlideOut 0.3s ease forwards"; }, 5000);
    setTimeout(() => { if (popup.isConnected) popup.remove(); }, 5300);
  },

  // ===== RENDER PANEL =====
  renderPanel() {
    const panel = document.getElementById("notifPanel");
    if (!panel) return;
    const notifs = this.getAll();
    const listEl = panel.querySelector(".notif-list");
    if (!listEl) return;

    if (notifs.length === 0) {
      listEl.innerHTML = `
        <div style="text-align:center;padding:60px 20px;color:#64748b">
          <div style="font-size:3rem;margin-bottom:12px">🔔</div>
          <div style="font-weight:600;color:#94a3b8;margin-bottom:6px">لا توجد إشعارات</div>
          <div style="font-size:0.82rem">ستظهر هنا جميع التحديثات</div>
        </div>`;
      return;
    }
    listEl.innerHTML = "";
    notifs.forEach(n => {
      const ago = this.timeAgo(n.createdAt);
      const div = document.createElement("div");
      div.style.cssText = `
        padding:16px;border-bottom:1px solid rgba(99,102,241,0.08);
        display:flex;gap:12px;align-items:flex-start;
        background:${n.read ? "transparent" : "rgba(99,102,241,0.04)"};
        cursor:pointer;transition:background 0.2s;position:relative;
      `;
      div.innerHTML = `
        ${!n.read ? `<div style="position:absolute;top:18px;right:14px;width:8px;height:8px;background:#6366f1;border-radius:50%"></div>` : ""}
        <span style="font-size:1.8rem;flex-shrink:0;line-height:1;margin-top:2px">${n.icon}</span>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:0.88rem;color:#f1f5f9;margin-bottom:4px;padding-left:${n.read?0:14}px">${n.title}</div>
          <div style="color:#94a3b8;font-size:0.8rem;line-height:1.6;margin-bottom:6px">${n.body}</div>
          <div style="color:#64748b;font-size:0.72rem">${ago}</div>
        </div>
        <button onclick="event.stopPropagation();NS_Notifications.deleteOne('${n.id}')"
          style="background:none;border:none;color:#475569;cursor:pointer;font-size:0.85rem;padding:4px;border-radius:6px;flex-shrink:0"
          onmouseover="this.style.color='#ef4444'" onmouseout="this.style.color='#475569'">✕</button>
      `;
      div.addEventListener("click", () => {
        const list = this.getAll().map(x => x.id === n.id ? {...x, read:true} : x);
        this.save(list);
        this.updateBadge();
        div.style.background = "transparent";
        if (n.link) window.location.href = n.link;
      });
      listEl.appendChild(div);
    });
  },

  // ===== TIME AGO =====
  timeAgo(dateStr) {
    const diff = (Date.now() - new Date(dateStr)) / 1000;
    if (diff < 60)     return "الآن";
    if (diff < 3600)   return `منذ ${Math.floor(diff/60)} دقيقة`;
    if (diff < 86400)  return `منذ ${Math.floor(diff/3600)} ساعة`;
    if (diff < 604800) return `منذ ${Math.floor(diff/86400)} يوم`;
    return new Date(dateStr).toLocaleDateString("ar-JO");
  },

  // ===== STYLES =====
  injectStyles() {
    if (document.getElementById("notif-styles")) return;
    const style = document.createElement("style");
    style.id = "notif-styles";
    style.textContent = `
      @keyframes notifSlideIn  { from{opacity:0;transform:translateX(40px) scale(0.9)} to{opacity:1;transform:translateX(0) scale(1)} }
      @keyframes notifSlideOut { from{opacity:1;transform:translateX(0)} to{opacity:0;transform:translateX(40px)} }
      @keyframes panelSlideIn  { from{opacity:0;transform:translateY(-10px) scale(0.97)} to{opacity:1;transform:translateY(0) scale(1)} }
      .notif-btn { position:relative;background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.2);border-radius:12px;padding:8px 12px;cursor:pointer;display:flex;align-items:center;gap:6px;color:#94a3b8;font-size:1.1rem;transition:all 0.2s;text-decoration:none; }
      .notif-btn:hover { background:rgba(99,102,241,0.15);color:#f1f5f9;border-color:rgba(99,102,241,0.4); }
      .notif-badge { position:absolute;top:-6px;right:-6px;background:linear-gradient(135deg,#ef4444,#dc2626);color:white;font-size:0.6rem;font-weight:800;min-width:18px;height:18px;border-radius:50px;display:flex;align-items:center;justify-content:center;padding:0 4px;border:2px solid #080b14; }
      #notifPanel {
        position:fixed;
        top:72px;
        left:24px;
        width:380px;
        max-height:560px;
        background:#111827;
        border:1px solid rgba(99,102,241,0.2);
        border-radius:20px;
        box-shadow:0 30px 80px rgba(0,0,0,0.7);
        z-index:9998;
        display:none;
        flex-direction:column;
        overflow:hidden;
        animation:panelSlideIn 0.25s ease;
      }
      #notifPanel.open { display:flex; }
      @media (max-width: 480px) {
        #notifPanel {
          top: 0 !important;
          left: 0 !important;
          right: 0 !important;
          bottom: 0 !important;
          width: 100% !important;
          max-height: 100% !important;
          border-radius: 0 !important;
          border: none !important;
          animation: panelSlideUp 0.3s ease !important;
        }
      }
      @keyframes panelSlideUp { from{opacity:0;transform:translateY(100%)} to{opacity:1;transform:translateY(0)} }
      .notif-panel-head { padding:18px 20px;border-bottom:1px solid rgba(99,102,241,0.1);display:flex;align-items:center;justify-content:space-between;flex-shrink:0; }
      .notif-list { overflow-y:auto;flex:1;scrollbar-width:thin;scrollbar-color:#1e293b transparent; }
      .notif-list::-webkit-scrollbar { width:4px; }
      .notif-list::-webkit-scrollbar-thumb { background:#1e293b;border-radius:4px; }
      .notif-list > div:hover { background:rgba(99,102,241,0.06) !important; }
    `;
    document.head.appendChild(style);
  },

  // ===== PANEL =====
  createPanel() {
    if (document.getElementById("notifPanel")) return;
    const panel = document.createElement("div");
    panel.id = "notifPanel";
    panel.innerHTML = `
      <div class="notif-panel-head">
        <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
          <span style="font-size:1.2rem">🔔</span>
          <span style="font-weight:700;font-size:1rem;color:#f1f5f9">الإشعارات</span>
          <span id="notifCountBadge" style="background:rgba(99,102,241,0.15);color:#6366f1;font-size:0.72rem;font-weight:700;padding:2px 8px;border-radius:50px"></span>
        </div>
        <div style="display:flex;gap:4px;align-items:center;flex-shrink:0">
          <button onclick="NS_Notifications.markAllRead()"
            style="background:none;border:none;color:#6366f1;font-size:0.78rem;cursor:pointer;font-family:'Tajawal',sans-serif;font-weight:600;padding:6px 8px;border-radius:6px;white-space:nowrap"
            onmouseover="this.style.background='rgba(99,102,241,0.1)'" onmouseout="this.style.background='none'">
            قراءة الكل
          </button>
          <button onclick="NS_Notifications.clearAll()"
            style="background:none;border:none;color:#64748b;font-size:0.78rem;cursor:pointer;font-family:'Tajawal',sans-serif;padding:6px 8px;border-radius:6px;white-space:nowrap"
            onmouseover="this.style.color='#ef4444';this.style.background='rgba(239,68,68,0.08)'" onmouseout="this.style.color='#64748b';this.style.background='none'">
            مسح
          </button>
          <button onclick="NS_Notifications.togglePanel()"
            id="notifPanelClose"
            style="background:rgba(255,255,255,0.05);border:none;color:#94a3b8;cursor:pointer;font-size:1.1rem;padding:6px 10px;border-radius:8px;line-height:1;display:none"
            onmouseover="this.style.background='rgba(255,255,255,0.1)'" onmouseout="this.style.background='rgba(255,255,255,0.05)'">✕</button>
        </div>
      </div>
      <div class="notif-list"></div>
    `;
    document.body.appendChild(panel);
    document.addEventListener("click", e => {
      if (!panel.contains(e.target) && !e.target.closest(".notif-btn"))
        panel.classList.remove("open");
    });
  },

  togglePanel() {
    const panel = document.getElementById("notifPanel");
    if (!panel) return;
    const isOpen = panel.classList.toggle("open");
    // Show close button on mobile (full-screen mode)
    const closeBtn = document.getElementById("notifPanelClose");
    if (closeBtn) {
      closeBtn.style.display = window.innerWidth <= 480 ? "block" : "none";
    }
    if (isOpen) {
      this.loadAndRender();
      const badge = document.getElementById("notifCountBadge");
      const count = this.getUnreadCount();
      if (badge) badge.textContent = count > 0 ? `${count} جديد` : "";
      // Prevent body scroll on mobile when panel is open
      if (window.innerWidth <= 480) document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
  },

  // ================================================================
  // PUSH NOTIFICATIONS — Browser Notification API + Service Worker
  // ================================================================

  isPushSupported() {
    return "Notification" in window && "serviceWorker" in navigator;
  },

  getPushPermission() {
    if (!this.isPushSupported()) return "unsupported";
    return Notification.permission;
  },

  async requestPushPermission() {
    if (!this.isPushSupported()) return false;
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") { this._showPushDeniedHint(); return false; }
    const result = await Notification.requestPermission();
    if (result === "granted") {
      localStorage.setItem("ns_push_granted", "1");
      this._showPushSuccessToast();
      await this._subscribeToPush();
      return true;
    }
    return false;
  },

  // إرسال Push عبر Service Worker (يصل حتى بدون فتح الموقع)
  async sendBrowserPush(title, body, options = {}) {
    if (Notification.permission !== "granted") {
      const ok = await this.requestPushPermission();
      if (!ok) return false;
    }
    try {
      const sw = await navigator.serviceWorker.ready;
      await sw.showNotification(title, {
        body,
        icon:    options.icon    || "/icon-192.png",
        badge:   options.badge   || "/icon-96.png",
        dir:     "rtl",
        lang:    "ar",
        vibrate: [100, 50, 100],
        tag:     options.tag     || "novashop-" + Date.now(),
        data:    { url: options.url || "/" },
        actions: options.actions || [
          { action: "open",    title: "فتح" },
          { action: "dismiss", title: "إغلاق" },
        ],
      });
      return true;
    } catch {
      try {
        const n = new Notification(title, {
          body, dir: "rtl", lang: "ar", icon: "/icon-192.png",
          tag: options.tag || "novashop",
        });
        if (options.url) n.onclick = () => { window.focus(); window.location.href = options.url; n.close(); };
        setTimeout(() => n.close(), 6000);
        return true;
      } catch { return false; }
    }
  },

  async _subscribeToPush() {
    try {
      const sw = await navigator.serviceWorker.ready;
      // جلب VAPID key من السيرفر إذا لم يكن محفوظاً
      let VAPID_PUBLIC = localStorage.getItem("ns_vapid_public");
      if (!VAPID_PUBLIC) {
        try {
          const r = await fetch(this._origin() + "/api/push/vapid-public", { signal: AbortSignal.timeout(3000) });
          const d = await r.json();
          if (d.ok && d.vapidPublicKey) {
            VAPID_PUBLIC = d.vapidPublicKey;
            localStorage.setItem("ns_vapid_public", VAPID_PUBLIC);
          }
        } catch {}
      }
      if (!VAPID_PUBLIC) return;
      const subscription = await sw.pushManager.subscribe({
        userVisibleOnly:      true,
        applicationServerKey: this._urlBase64ToUint8Array(VAPID_PUBLIC),
      });
      const token = this._token();
      if (token) {
        await fetch(this._origin() + "/api/push/subscribe", {
          method:  "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
          body:    JSON.stringify(subscription),
          signal:  AbortSignal.timeout(5000),
        });
      }
    } catch (e) { console.warn("[Push] Subscribe:", e.message); }
  },

  _urlBase64ToUint8Array(b64) {
    const padding = "=".repeat((4 - b64.length % 4) % 4);
    const base64  = (b64 + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw     = atob(base64);
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
  },

  _showPushSuccessToast() {
    if (window.showToast) showToast("🔔 تم تفعيل الإشعارات! ستصلك تنبيهات العروض والطلبات.", "success");
  },

  _showPushDeniedHint() {
    if (window.showToast) showToast("⚠️ الإشعارات محظورة. افتح إعدادات المتصفح وأعد تفعيلها.", "error");
  },

  // بطاقة تفعيل الإشعارات تظهر للمستخدمين المسجّلين
  injectPushButton() {
    if (!this.isPushSupported()) return;
    if (document.getElementById("ns-push-btn")) return;
    const session = JSON.parse(localStorage.getItem("ns_session") || "null");
    if (!session) return;
    if (localStorage.getItem("ns_push_granted") && Notification.permission === "granted") return;

    const btn = document.createElement("div");
    btn.id = "ns-push-btn";
    btn.style.cssText = `
      position:fixed;bottom:24px;left:16px;right:16px;z-index:9990;
      background:#111827;border:1px solid rgba(99,102,241,0.35);
      border-radius:16px;padding:14px 18px;
      display:flex;align-items:center;gap:12px;
      box-shadow:0 12px 40px rgba(0,0,0,0.5);
      cursor:pointer;max-width:400px;margin:0 auto;
      animation:notifSlideIn 0.5s cubic-bezier(0.34,1.56,0.64,1) 2s both;
    `;
    btn.innerHTML = `
      <span style="font-size:1.8rem;flex-shrink:0">🔔</span>
      <div style="flex:1">
        <div style="font-weight:700;font-size:0.88rem;color:#f1f5f9;margin-bottom:2px">فعّل الإشعارات</div>
        <div style="color:#94a3b8;font-size:0.76rem;line-height:1.4">كن أول من يعرف بالعروض والطلبات</div>
      </div>
      <button id="ns-push-dismiss"
        style="background:none;border:none;color:#475569;cursor:pointer;font-size:1.1rem;padding:0;flex-shrink:0"
        onclick="event.stopPropagation();document.getElementById('ns-push-btn').remove()">&#x2715;</button>
    `;
    btn.addEventListener("click", async e => {
      if (e.target.id === "ns-push-dismiss") return;
      btn.remove();
      const ok = await NS_Notifications.requestPushPermission();
      if (ok) {
        NS_Notifications.sendBrowserPush("NovaShop 🎉",
          "أهلاً! الإشعارات مفعّلة. ستصلك آخر العروض والتحديثات.",
          { url: "/products.html", tag: "novashop-welcome-push" });
      }
    });

    document.body.appendChild(btn);
    setTimeout(() => { if (btn.isConnected) btn.remove(); }, 15000);
  },

  // ================================================================
  // PWA — Service Worker Registration
  // ================================================================
  registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", async () => {
      try {
        const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        console.log("[PWA] Service Worker registered:", reg.scope);

        reg.addEventListener("updatefound", () => {
          const newSW = reg.installing;
          if (!newSW) return;
          newSW.addEventListener("statechange", () => {
            if (newSW.state === "installed" && navigator.serviceWorker.controller) {
              this._showUpdateBanner(newSW);
            }
          });
        });

        const count = this.getUnreadCount();
        if (count > 0) navigator.setAppBadge?.(count).catch(() => {});

      } catch (e) {
        console.warn("[PWA] Service Worker failed:", e.message);
      }
    });
  },

  _showUpdateBanner(newSW) {
    if (document.getElementById("ns-update-banner")) return;
    const banner = document.createElement("div");
    banner.id = "ns-update-banner";
    banner.style.cssText = `
      position:fixed;bottom:0;left:0;right:0;z-index:99999;
      background:linear-gradient(135deg,#6366f1,#8b5cf6);
      color:white;padding:14px 20px;
      display:flex;align-items:center;justify-content:space-between;gap:12px;
      box-shadow:0 -4px 20px rgba(99,102,241,0.4);
      font-family:'Tajawal',sans-serif;
      font-size:clamp(0.8rem,3vw,1rem);
    `;
    banner.innerHTML = `
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:1.4rem">&#x1F680;</span>
        <div>
          <div style="font-weight:700;font-size:0.9rem">تحديث جديد متاح!</div>
          <div style="font-size:0.78rem;opacity:0.85">تحسينات جديدة لـ NovaShop</div>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-shrink:0">
        <button onclick="document.getElementById('ns-update-banner').remove()"
          style="padding:7px 14px;border-radius:8px;border:1px solid rgba(255,255,255,0.3);background:none;color:white;cursor:pointer;font-family:'Tajawal',sans-serif;font-size:0.85rem">
          لاحقاً
        </button>
        <button id="ns-update-btn"
          style="padding:7px 16px;border-radius:8px;border:none;background:white;color:#6366f1;cursor:pointer;font-weight:700;font-family:'Tajawal',sans-serif;font-size:0.85rem">
          تحديث الآن &#x21BA;
        </button>
      </div>
    `;
    document.body.appendChild(banner);
    document.getElementById("ns-update-btn")?.addEventListener("click", () => {
      newSW.postMessage("SKIP_WAITING");
      window.location.reload();
    });
  },

  // PWA Install Prompt
  _deferredInstallPrompt: null,

  listenForInstallPrompt() {
    window.addEventListener("beforeinstallprompt", e => {
      e.preventDefault();
      this._deferredInstallPrompt = e;
      setTimeout(() => this._showInstallButton(), 5000);
    });
    window.addEventListener("appinstalled", () => {
      this._deferredInstallPrompt = null;
      const btn = document.getElementById("ns-install-btn");
      if (btn) btn.remove();
      if (window.showToast) showToast("تم تنصيب NovaShop على جهازك!", "success");
    });
  },

  _showInstallButton() {
    if (!this._deferredInstallPrompt) return;
    if (document.getElementById("ns-install-btn")) return;
    if (window.matchMedia("(display-mode: standalone)").matches) return;

    const btn = document.createElement("div");
    btn.id = "ns-install-btn";
    btn.style.cssText = `
      position:fixed;bottom:100px;left:16px;right:16px;z-index:9989;
      background:#111827;border:1px solid rgba(34,197,94,0.35);
      border-radius:16px;padding:14px 18px;
      display:flex;align-items:center;gap:12px;
      box-shadow:0 12px 40px rgba(0,0,0,0.5);
      cursor:pointer;max-width:400px;margin:0 auto;
      animation:notifSlideIn 0.5s cubic-bezier(0.34,1.56,0.64,1) both;
    `;
    btn.innerHTML = `
      <span style="font-size:1.8rem;flex-shrink:0">&#x1F4F2;</span>
      <div style="flex:1">
        <div style="font-weight:700;font-size:0.88rem;color:#f1f5f9;margin-bottom:2px">نصّب التطبيق</div>
        <div style="color:#94a3b8;font-size:0.76rem;line-height:1.4">أضف NovaShop للشاشة الرئيسية</div>
      </div>
      <button
        style="background:none;border:none;color:#475569;cursor:pointer;font-size:1.1rem;padding:0;flex-shrink:0"
        onclick="event.stopPropagation();document.getElementById('ns-install-btn').remove()">&#x2715;</button>
    `;
    btn.addEventListener("click", async e => {
      if (e.target.tagName === "BUTTON") return;
      if (!this._deferredInstallPrompt) return;
      btn.remove();
      this._deferredInstallPrompt.prompt();
      const { outcome } = await this._deferredInstallPrompt.userChoice;
      this._deferredInstallPrompt = null;
      if (outcome === "accepted" && window.showToast) showToast("يتم تنصيب التطبيق...", "success");
    });

    document.body.appendChild(btn);
    setTimeout(() => { if (btn.isConnected) btn.remove(); }, 20000);
  },

  // ===== INIT =====
  init() {
    this.injectStyles();
    this.createPanel();
    this.loadAndRender().then(() => this.updateBadge());
    this.startPolling();

    // تسجيل Service Worker (PWA) + مستمع التنصيب
    this.registerServiceWorker();
    this.listenForInstallPrompt();

    const session = JSON.parse(localStorage.getItem("ns_session") || "null");
    if (!session) return;

    const welcomed = localStorage.getItem("ns_welcomed_" + session.id);
    if (!welcomed) {
      setTimeout(() => {
        this.add("welcome", "أهلاً " + session.name + "! 👋", "شكراً لانضمامك لـ NovaShop. اكتشف أحدث المنتجات والعروض الحصرية.", "products.html");
        localStorage.setItem("ns_welcomed_" + session.id, "1");
      }, 1500);
    }

    // اعرض زر تفعيل Push بعد 3 ثوانٍ
    setTimeout(() => this.injectPushButton(), 3000);
  },

  // ===== HELPERS =====
  notifyOrderPlaced(orderId)    { this.add("order",    "تم استلام طلبك! 🎉",  "طلبك #" + orderId + " في قيد المراجعة.", "profile.html"); },
  notifyOrderConfirmed(orderId) { this.add("order",    "طلبك تم تأكيده ✅",   "طلب #" + orderId + " مؤكد ويُجهَّز للشحن.", "profile.html"); },
  notifyOrderShipped(orderId)   { this.add("shipping", "طلبك في الطريق! 🚚",  "طلب #" + orderId + " خرج للتوصيل.", "profile.html"); },
  notifyOrderDelivered(orderId) { this.add("delivery", "تم التسليم! 📦",       "طلب #" + orderId + " وصل بنجاح.", "profile.html"); },

  notifyAndPush(type, title, body, url) {
    this.add(type, title, body, url || null);
    if (Notification.permission === "granted") {
      this.sendBrowserPush(title, body, { url: url || "/", tag: "novashop-" + type });
    }
  },
};

window.NS_Notifications = NS_Notifications;
