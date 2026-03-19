// ===== NOVASHOP API CLIENT =====
// يتصل بالـ Backend — يرجع لـ DB المحلي تلقائياً إذا السيرفر غير متاح

const API = {
  // يكتشف الـ IP تلقائياً — يعمل من الكمبيوتر والهاتف على نفس الشبكة
  get BASE() {
    if (typeof window === "undefined") return "http://localhost:3001/api";
    const o = window.location.origin;
    if (o.startsWith("file://") || o === "null") return "http://localhost:3001/api";
    return o + "/api";
  },

  // ===== TOKEN & SESSION =====
  getToken()       { return localStorage.getItem("ns_token"); },
  setToken(t)      { localStorage.setItem("ns_token", t); },
  removeToken()    { localStorage.removeItem("ns_token"); },
  getSession()     { return JSON.parse(localStorage.getItem("ns_session") || "null"); },
  setSession(user) { localStorage.setItem("ns_session", JSON.stringify(user)); },
  clearSession()   { localStorage.removeItem("ns_session"); localStorage.removeItem("ns_token"); },
  isAdmin()        { const s = this.getSession(); return s && s.role === "admin"; },

  // ===== HTTP HELPER =====
  async req(method, path, body = null, auth = false) {
    const headers = { "Content-Type": "application/json" };
    if (auth) {
      const token = this.getToken();
      if (!token) return { ok: false, msg: "يجب تسجيل الدخول", _offline: true };
      headers["Authorization"] = "Bearer " + token;
    }
    try {
      const res = await fetch(this.BASE + path, {
        method,
        headers,
        body: body ? JSON.stringify(body) : null,
        signal: AbortSignal.timeout(4000),  // timeout 4 ثواني
      });
      return await res.json();
    } catch {
      return { ok: false, _offline: true };
    }
  },

  // ===== AUTH =====

  async register(name, email, password) {
    const res = await this.req("POST", "/auth/register", { name, email, password });
    if (!res._offline) {
      // السيرفر شغّال — احفظ نسخة محلية أيضاً حتى يراها admin.html
      if (res.ok) {
        const local = DB.registerUser(name, email, password);
        // إذا البريد مسجّل محلياً مسبقاً تجاهل الخطأ
      }
      return res;
    }
    // === OFFLINE FALLBACK ===
    const local = DB.registerUser(name, email, password);
    if (!local.ok) return local;
    return { ok: true, msg: "تم إنشاء الحساب", _devCode: local.verifyCode, _offline: true };
  },

  async verifyEmail(email, code) {
    const res = await this.req("POST", "/auth/verify-email", { email, code });
    if (!res._offline) {
      // السيرفر أكّد البريد — حدّث الـ localStorage أيضاً
      if (res.ok) {
        DB.verifyEmail(email, code); // لا يضر لو فشل
      }
      return res;
    }
    // === OFFLINE FALLBACK ===
    const local = DB.verifyEmail(email, code);
    if (!local.ok) return local;
    const user = DB.getUsers().find(u => u.email.toLowerCase() === email.toLowerCase());
    if (!user) return { ok: false, msg: "خطأ في التحقق" };
    DB._setSession(user);
    return { ok: true, token: "local", user: { id: user.id, name: user.name, email: user.email, role: user.role } };
  },

  async resendCode(email) {
    const res = await this.req("POST", "/auth/resend-code", { email });
    if (!res._offline) return res;
    // === OFFLINE FALLBACK ===
    const local = DB.resendCode(email);
    return { ok: local.ok, msg: local.ok ? "تم إعادة إرسال الكود" : local.msg, _devCode: local.verifyCode };
  },

  async login(email, password) {
    const res = await this.req("POST", "/auth/login", { email, password });
    if (!res._offline) {
      if (res.ok) { this.setToken(res.token); this.setSession(res.user); }
      return res;
    }
    // === OFFLINE FALLBACK ===
    const local = DB.loginUser(email, password);
    if (!local.ok) return local;
    this.setSession(local.user);
    return { ok: true, user: local.user };
  },

  logout() {
    this.clearSession();
    DB.logout();
  },

  // ===== USER =====
  async getMe() {
    const res = await this.req("GET", "/user/me", null, true);
    if (!res._offline) return res;
    const user = DB.getCurrentUser();
    if (!user) return { ok: false, msg: "غير مسجّل" };
    return { ok: true, user };
  },

  async updateProfile(data) {
    const res = await this.req("PUT", "/user/update", data, true);
    if (!res._offline) return res;
    const session = DB.getSession();
    if (!session) return { ok: false, msg: "غير مسجّل" };
    return DB.updateUser(session.id, data);
  },

  async changePassword(cur, newP) {
    const res = await this.req("PUT", "/user/change-password", { currentPassword: cur, newPassword: newP }, true);
    if (!res._offline) return res;
    const session = DB.getSession();
    if (!session) return { ok: false, msg: "غير مسجّل" };
    return DB.updateUser(session.id, { currentPassword: cur, newPassword: newP });
  },

  // ===== ORDERS =====
  async createOrder(items, total, paymentRef) {
    const res = await this.req("POST", "/orders/create", { items, total, paymentRef }, true);
    if (!res._offline) return res;
    const session = DB.getSession();
    if (!session) return { ok: false, msg: "يجب تسجيل الدخول" };
    const order = DB.createOrder(session.id, items, total, paymentRef);
    return { ok: true, order };
  },

  async getMyOrders() {
    const res = await this.req("GET", "/orders/my", null, true);
    if (!res._offline) return res;
    const session = DB.getSession();
    if (!session) return { ok: false, msg: "يجب تسجيل الدخول" };
    return { ok: true, orders: DB.getUserOrders(session.id) };
  },

  // ===== ADMIN =====
  adminGetOrders()              { return this.req("GET", "/admin/orders",              null,     true); },
  adminUpdateStatus(id, status) { return this.req("PUT", `/admin/orders/${id}/status`, {status}, true); },
  adminGetUsers()               { return this.req("GET", "/admin/users",               null,     true); },
  adminGetStats()               { return this.req("GET", "/admin/stats",               null,     true); },

  // ===== FORGOT PASSWORD =====
  async forgotPassword(email) {
    const res = await this.req("POST", "/auth/forgot-password", { email });
    if (!res._offline) return res;
    return DB.forgotPasswordSend(email);
  },

  async verifyResetCode(email, code) {
    const res = await this.req("POST", "/auth/verify-reset-code", { email, code });
    if (!res._offline) return res;
    return DB.forgotPasswordVerify(email, code);
  },

  async resetPassword(email, resetToken, newPassword) {
    const res = await this.req("POST", "/auth/reset-password", { email, resetToken, newPassword });
    if (!res._offline) return res;
    return DB.forgotPasswordReset(email, resetToken, newPassword);
  },
};

window.API = API;
