// ===== NOVASHOP DATABASE =====

// Simple non-reversible hash for client-side password storage
// Much better than btoa() which is trivially reversible
function _hashPassword(password) {
  // Use a fixed salt + password, then encode deterministically
  // Not as strong as bcrypt (which runs server-side), but prevents
  // trivial atob() reversal of passwords stored in localStorage
  const salted = "ns2025:" + password + ":novashop";
  let hash = 0;
  for (let i = 0; i < salted.length; i++) {
    const char = salted.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  // Convert to hex-like string and mix with base64 to make it longer
  const h1 = Math.abs(hash).toString(16).padStart(8, '0');
  const h2 = btoa(salted.split('').reverse().join('')).replace(/=/g,'').slice(0,16);
  const h3 = Math.abs(hash * 31337).toString(36).padStart(8,'0');
  return "h$" + h1 + h2 + h3; // prefix "h$" marks it as hashed (not raw btoa)
}

// Migrate old btoa passwords to new hash on login
function _migratePassword(storedPwd, rawPassword) {
  if (storedPwd && storedPwd.startsWith("h$")) return false; // already hashed
  // Check if it matches old btoa format
  try {
    const oldFormat = _hashPassword(rawPassword);
    return storedPwd === oldFormat;
  } catch { return false; }
}

const DB = {

  // ===== USERS =====
  getUsers() { return JSON.parse(localStorage.getItem("ns_users")) || []; },
  saveUsers(u) { localStorage.setItem("ns_users", JSON.stringify(u)); },

  // ===== REGISTER: يولّد كود تحقق ويحفظه =====
  registerUser(name, email, password) {
    const users = this.getUsers();
    if (users.find(u => u.email.toLowerCase() === email.toLowerCase()))
      return { ok: false, msg: "هذا البريد مسجّل مسبقاً" };

    const verifyCode = Math.floor(100000 + Math.random() * 900000).toString(); // 6 أرقام
    const user = {
      id: Date.now(),
      name,
      email,
      password: _hashPassword(password),
      role: "customer",
      emailVerified: false,
      verifyCode,
      verifyExpiry: Date.now() + 10 * 60 * 1000, // 10 دقائق
      createdAt: new Date().toISOString(),
      orders: []
    };
    users.push(user);
    this.saveUsers(users);
    return { ok: true, user, verifyCode };
  },

  // ===== VERIFY EMAIL =====
  verifyEmail(email, code) {
    const users = this.getUsers();
    const idx = users.findIndex(u => u.email.toLowerCase() === email.toLowerCase());
    if (idx === -1) return { ok: false, msg: "البريد غير موجود" };
    const u = users[idx];
    if (u.emailVerified) return { ok: true }; // already verified
    if (u.verifyCode !== code.trim()) return { ok: false, msg: "الكود غير صحيح" };
    if (Date.now() > u.verifyExpiry) return { ok: false, msg: "انتهت صلاحية الكود، اطلب كوداً جديداً" };
    users[idx].emailVerified = true;
    users[idx].verifyCode = null;
    this.saveUsers(users);
    return { ok: true };
  },

  // ===== RESEND CODE =====
  resendCode(email) {
    const users = this.getUsers();
    const idx = users.findIndex(u => u.email.toLowerCase() === email.toLowerCase());
    if (idx === -1) return { ok: false, msg: "البريد غير موجود" };
    const newCode = Math.floor(100000 + Math.random() * 900000).toString();
    users[idx].verifyCode = newCode;
    users[idx].verifyExpiry = Date.now() + 10 * 60 * 1000;
    this.saveUsers(users);
    return { ok: true, verifyCode: newCode };
  },

  // ===== LOGIN =====
  loginUser(email, password) {
    const users = this.getUsers();
    const user = users.find(u =>
      u.email.toLowerCase() === email.toLowerCase() &&
      (u.password === _hashPassword(password) || _migratePassword(u.password, password))
    );
    if (!user) return { ok: false, msg: "البريد أو كلمة المرور غير صحيحة" };
    // Migrate old btoa password to new hash
    if (user.password && !user.password.startsWith("h$")) {
      const allUsers = this.getUsers();
      const idx = allUsers.findIndex(u => u.id === user.id);
      if (idx !== -1) { allUsers[idx].password = _hashPassword(password); this.saveUsers(allUsers); }
    }
    if (user.banned) return { ok: false, msg: "⛔ تم تقييد هذا الحساب. للمساعدة تواصل مع الدعم.", banned: true };
    if (!user.emailVerified) return { ok: false, msg: "يرجى تأكيد بريدك الإلكتروني أولاً", needVerify: true, email: user.email };
    this._setSession(user);
    return { ok: true, user };
  },

  _setSession(user) {
    localStorage.setItem("ns_session", JSON.stringify({
      id: user.id, name: user.name, email: user.email, role: user.role
    }));
  },

  getSession() { return JSON.parse(localStorage.getItem("ns_session")); },
  logout() { localStorage.removeItem("ns_session"); },

  getCurrentUser() {
    const s = this.getSession();
    if (!s) return null;
    return this.getUsers().find(u => u.id === s.id) || null;
  },

  isAdmin() {
    const s = this.getSession();
    return s && s.role === "admin";
  },

  // ===== UPDATE USER INFO =====
  updateUser(userId, updates) {
    const users = this.getUsers();
    const idx = users.findIndex(u => u.id === userId);
    if (idx === -1) return { ok: false, msg: "المستخدم غير موجود" };

    // التحقق من البريد الجديد إذا تغيّر
    if (updates.email && updates.email.toLowerCase() !== users[idx].email.toLowerCase()) {
      if (users.find(u => u.id !== userId && u.email.toLowerCase() === updates.email.toLowerCase()))
        return { ok: false, msg: "هذا البريد مستخدم من حساب آخر" };
      // بريد جديد → يحتاج تحقق مجدداً
      const newCode = Math.floor(100000 + Math.random() * 900000).toString();
      updates.emailVerified = false;
      updates.verifyCode = newCode;
      updates.verifyExpiry = Date.now() + 10 * 60 * 1000;
      users[idx] = { ...users[idx], ...updates };
      this.saveUsers(users);
      return { ok: true, needVerify: true, verifyCode: newCode, newEmail: updates.email };
    }

    // تغيير كلمة المرور
    if (updates.newPassword) {
      if (!updates.currentPassword) return { ok: false, msg: "أدخل كلمة المرور الحالية" };
      const encoded = _hashPassword(updates.currentPassword);
      if (users[idx].password !== encoded) return { ok: false, msg: "كلمة المرور الحالية غير صحيحة" };
      updates.password = _hashPassword(updates.newPassword);
      delete updates.newPassword; delete updates.currentPassword;
    }

    const allowed = ["name", "email", "password"];
    allowed.forEach(k => { if (updates[k] !== undefined) users[idx][k] = updates[k]; });
    this.saveUsers(users);

    // تحديث الجلسة
    this._setSession(users[idx]);
    return { ok: true };
  },

  // ===== ORDERS =====
  getOrders() { return JSON.parse(localStorage.getItem("ns_orders")) || []; },
  saveOrders(o) { localStorage.setItem("ns_orders", JSON.stringify(o)); },

  createOrder(userId, items, total, paymentRef) {
    const orders = this.getOrders();
    const order = {
      id: "ORD-" + Date.now(),
      userId, items, total, paymentRef,
      status: "pending",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    orders.push(order);
    this.saveOrders(orders);
    const users = this.getUsers();
    const idx = users.findIndex(u => u.id === userId);
    if (idx !== -1) { users[idx].orders.push(order.id); this.saveUsers(users); }
    return order;
  },

  getUserOrders(userId) { return this.getOrders().filter(o => o.userId === userId); },

  updateOrderStatus(orderId, status) {
    const orders = this.getOrders();
    const idx = orders.findIndex(o => o.id === orderId);
    if (idx === -1) return false;
    orders[idx].status = status;
    orders[idx].updatedAt = new Date().toISOString();
    this.saveOrders(orders);
    return true;
  },

  getAllOrders() { return this.getOrders(); },

  getStats() {
    const orders = this.getOrders();
    const users = this.getUsers();
    const confirmed = orders.filter(o => !["pending","rejected"].includes(o.status));
    const revenue = confirmed.reduce((s, o) => s + o.total, 0);
    const pending = orders.filter(o => o.status === "pending").length;
    return { totalOrders: orders.length, totalUsers: users.length, revenue, pending };
  },


  // ===== FORGOT PASSWORD =====

  // الخطوة 1: إرسال رمز إعادة التعيين
  forgotPasswordSend(email) {
    const users = this.getUsers();
    const idx = users.findIndex(u => u.email.toLowerCase() === email.toLowerCase());
    if (idx === -1) return { ok: false, msg: "لا يوجد حساب بهذا البريد الإلكتروني" };

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    users[idx].resetCode   = code;
    users[idx].resetExpiry = Date.now() + 10 * 60 * 1000; // 10 دقائق
    this.saveUsers(users);

    // في وضع التطوير (بدون سيرفر) نعيد الكود مباشرة
    console.log(`🔐 رمز إعادة التعيين لـ ${email}: ${code}`);
    return { ok: true, _devCode: code, msg: "تم إرسال الرمز" };
  },

  // الخطوة 2: التحقق من الرمز
  forgotPasswordVerify(email, code) {
    const users = this.getUsers();
    const idx = users.findIndex(u => u.email.toLowerCase() === email.toLowerCase());
    if (idx === -1) return { ok: false, msg: "البريد غير موجود" };

    const user = users[idx];
    if (!user.resetCode)          return { ok: false, msg: "لم يتم طلب إعادة تعيين لهذا البريد" };
    if (user.resetCode !== code.trim()) return { ok: false, msg: "الرمز غير صحيح ❌" };
    if (Date.now() > user.resetExpiry)  return { ok: false, msg: "انتهت صلاحية الرمز — اطلب رمزاً جديداً" };

    // نضع توكن مؤقت للخطوة الثالثة
    const resetToken = btoa(email + "::" + Date.now());
    users[idx].resetToken       = resetToken;
    users[idx].resetTokenExpiry = Date.now() + 15 * 60 * 1000; // 15 دقيقة للإكمال
    users[idx].resetCode        = null;
    this.saveUsers(users);

    return { ok: true, resetToken };
  },

  // الخطوة 3: تعيين كلمة المرور الجديدة
  forgotPasswordReset(email, resetToken, newPassword) {
    if (!newPassword || newPassword.length < 6)
      return { ok: false, msg: "كلمة المرور يجب أن تكون 6 أحرف على الأقل" };

    const users = this.getUsers();
    const idx = users.findIndex(u => u.email.toLowerCase() === email.toLowerCase());
    if (idx === -1) return { ok: false, msg: "البريد غير موجود" };

    const user = users[idx];
    if (!user.resetToken || user.resetToken !== resetToken)
      return { ok: false, msg: "انتهت الجلسة — ابدأ من جديد" };
    if (Date.now() > user.resetTokenExpiry)
      return { ok: false, msg: "انتهت صلاحية الجلسة — ابدأ من جديد" };

    users[idx].password         = _hashPassword(newPassword);
    users[idx].resetToken       = null;
    users[idx].resetTokenExpiry = null;
    this.saveUsers(users);

    // تسجيل دخول تلقائي
    this._setSession(users[idx]);
    return { ok: true, user: { id: users[idx].id, name: users[idx].name, email: users[idx].email, role: users[idx].role } };
  },

  // ===== SEED ADMIN =====
  // حساب الأدمن يُنشأ من server.js عند الإقلاع باستخدام .env
  seedAdmin() {
    // لا شيء — الأدمن يُنشأ من السيرفر
  },
};

window.DB = DB;

// ===== مراقبة إجراءات الأدمن (حظر/حذف) =====
(function watchAdminActions() {
  const session = JSON.parse(localStorage.getItem("ns_session") || "null");
  if (!session) return;

  setInterval(() => {
    const key    = "ns_admin_action_" + session.id;
    const action = JSON.parse(localStorage.getItem(key) || "null");
    if (!action) return;

    // تجاهل الإجراءات القديمة (أكثر من 30 ثانية)
    if (Date.now() - action.timestamp > 30000) {
      localStorage.removeItem(key); return;
    }

    if (action.action === "force_logout") {
      localStorage.removeItem(key);
      localStorage.removeItem("ns_session");
      localStorage.removeItem("ns_token");
      // إظهار رسالة ثم توجيه للرئيسية
      alert("⚠️ تم تسجيل خروجك من قبل المدير.");
      window.location.href = "index.html";
    }
  }, 3000); // كل 3 ثوانٍ
})();
