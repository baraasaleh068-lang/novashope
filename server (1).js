// ===== NOVASHOP BACKEND SERVER =====
// Node.js + Express + Nodemailer + JWT

require("dotenv").config();
const express     = require("express");
const bcrypt      = require("bcryptjs");
const jwt         = require("jsonwebtoken");
const cors        = require("cors");
const rateLimit   = require("express-rate-limit");
const fs          = require("fs");
const path        = require("path");

const app  = express();
const PORT = process.env.PORT || 3001;

// ===== MIDDLEWARE =====
app.use(cors({ origin: "*" }));           // في الإنتاج: حدد دومينك فقط
app.use(express.json());
app.use(express.static(__dirname, {
  setHeaders: (res, path) => {
    if (path.endsWith('.css') || path.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
})); // ملفات الموقع

// Rate limiting — يمنع Brute Force
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 دقيقة
  max: 10,
  message: { ok: false, msg: "طلبات كثيرة جداً، انتظر 15 دقيقة" }
});

const emailLimiter = rateLimit({
  windowMs: 60 * 1000, // دقيقة واحدة
  max: 3,
  message: { ok: false, msg: "انتظر قبل طلب كود جديد" }
});

// ===== JWT & AUTH MIDDLEWARE =====
function signToken(user) {
  return require("jsonwebtoken").sign(
    { id: user.id, email: user.email, role: user.role },
    process.env.JWT_SECRET || "novashop_secret_change_me",
    { expiresIn: "7d" }
  );
}

function authMiddleware(req, res, next) {
  const header = req.headers["authorization"] || "";
  const token  = header.replace("Bearer ", "").trim();
  if (!token) return res.status(401).json({ ok: false, msg: "يجب تسجيل الدخول" });
  try {
    const decoded = require("jsonwebtoken").verify(token, process.env.JWT_SECRET || "novashop_secret_change_me");
    const users   = readUsers();
    const user    = users.find(u => u.id === decoded.id);
    if (!user)       return res.status(401).json({ ok: false, msg: "الحساب غير موجود", force_logout: true });
    if (user.banned) return res.status(403).json({ ok: false, msg: "⛔ تم تقييد هذا الحساب", banned: true, force_logout: true });
    req.user = decoded;
    next();
  } catch {
    return res.status(401).json({ ok: false, msg: "انتهت الجلسة، سجّل دخولك مجدداً", force_logout: true });
  }
}

function adminMiddleware(req, res, next) {
  authMiddleware(req, res, () => {
    if (req.user.role !== "admin" && req.user.role !== "staff")
      return res.status(403).json({ ok: false, msg: "غير مصرح — للمدير والموظفين فقط" });
    next();
  });
}

// ===== DATABASE (JSON file - يمكن استبداله بـ MongoDB لاحقاً) =====
const DB_FILE      = path.join(__dirname, "data", "users.json");
const ORDER_FILE   = path.join(__dirname, "data", "orders.json");
const PRODUCT_FILE = path.join(__dirname, "data", "products.json");

function ensureDataDir() {
  const dir = path.join(__dirname, "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
  const defaultProducts = JSON.stringify([
    {id:1,name:"Smart Watch Pro",  price:29,image:"https://picsum.photos/300/200?random=1",category:"tech", discount:15},
    {id:2,name:"Wireless Earbuds", price:25,image:"https://picsum.photos/300/200?random=2",category:"audio",discount:0},
    {id:3,name:"LED Strip Lights", price:15,image:"https://picsum.photos/300/200?random=3",category:"home", discount:20},
    {id:4,name:"Bluetooth Speaker",price:45,image:"https://picsum.photos/300/200?random=4",category:"audio",discount:10},
    {id:5,name:"USB-C Hub 7-in-1", price:35,image:"https://picsum.photos/300/200?random=5",category:"tech", discount:0},
    {id:6,name:"Desk Lamp LED",    price:22,image:"https://picsum.photos/300/200?random=6",category:"home", discount:5},
  ], null, 2);
  const files = { [DB_FILE]: "[]", [ORDER_FILE]: "[]", [PRODUCT_FILE]: defaultProducts };
  const extras = ["notifications.json", "wishlists.json", "reviews.json", "sessions.json", "2fa_codes.json", "push_subscriptions.json", "chats.json"];
  extras.forEach(f => { files[path.join(dir, f)] = "{}"; });
  Object.entries(files).forEach(([fp, def]) => { if (!fs.existsSync(fp)) fs.writeFileSync(fp, def); });
}

function readUsers()     { return JSON.parse(fs.readFileSync(DB_FILE)); }
function saveUsers(u)    { fs.writeFileSync(DB_FILE, JSON.stringify(u, null, 2)); }
function readOrders()    { return JSON.parse(fs.readFileSync(ORDER_FILE)); }
function saveOrders(o)   { fs.writeFileSync(ORDER_FILE, JSON.stringify(o, null, 2)); }
function readProducts()  { return JSON.parse(fs.readFileSync(PRODUCT_FILE)); }
function saveProducts(p) { fs.writeFileSync(PRODUCT_FILE, JSON.stringify(p, null, 2)); }

// ===== NODEMAILER SETUP =====


// POST /api/auth/register
app.post("/api/auth/register", authLimiter, async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password)
    return res.json({ ok: false, msg: "يرجى تعبئة جميع الحقول" });
  if (password.length < 6)
    return res.json({ ok: false, msg: "كلمة المرور يجب أن تكون 6 أحرف على الأقل" });
  if (name.trim().length < 2)
    return res.json({ ok: false, msg: "الاسم يجب أن يكون حرفين على الأقل" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.json({ ok: false, msg: "صيغة البريد غير صحيحة" });

  const users = readUsers();
  if (users.find(u => u.email.toLowerCase() === email.toLowerCase()))
    return res.json({ ok: false, msg: "هذا البريد مسجّل مسبقاً" });

  const hashed = await bcrypt.hash(password, 12);
  const user   = {
    id:            Date.now(),
    name:          name.trim(),
    email:         email.toLowerCase().trim(),
    password:      hashed,
    role:          "customer",
    emailVerified: true,  // تأكيد فوري بدون بريد
    verifyCode:    null,
    createdAt:     new Date().toISOString(),
    orders:        [],
  };
  users.push(user);
  saveUsers(users);

  const token = signToken(user);
  createSession(user.id, token, req);
  res.json({ ok: true, token, user: { id: user.id, name: user.name, email: user.email, role: user.role },
    msg: "تم إنشاء الحساب بنجاح" });
});


// POST /api/auth/login
app.post("/api/auth/login", authLimiter, async (req, res) => {
  const { email, password } = req.body;
  const users = readUsers();
  // إذا في مستخدمان بنفس الإيميل (customer + admin) → يفضّل الأدمن
  const allMatches = users.filter(u => u.email === email.toLowerCase().trim());
  const user = allMatches.find(u => u.role === "admin") || allMatches[0];

  if (!user) return res.json({ ok: false, msg: "البريد أو كلمة المرور غير صحيحة" });

  const match = await bcrypt.compare(password, user.password);
  if (!match)  return res.json({ ok: false, msg: "البريد أو كلمة المرور غير صحيحة" });

  if (user.banned)
    return res.json({ ok: false, msg: "⛔ تم تقييد هذا الحساب. للمساعدة تواصل مع الدعم.", banned: true });

  const token = signToken(user);
  createSession(user.id, token, req);
  res.json({ ok: true, token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

// ============================================================
// ===== FORGOT PASSWORD ROUTES =====
// ============================================================

// POST /api/auth/forgot-password
app.post("/api/auth/forgot-password", authLimiter, (req, res) => {
  const { email } = req.body;
  if (!email) return res.json({ ok: false, msg: "يرجى إدخال البريد الإلكتروني" });

  const users = readUsers();
  const idx   = users.findIndex(u => u.email === email.toLowerCase().trim());
  if (idx === -1)
    return res.json({ ok: true, msg: "إذا كان البريد مسجّلاً ستظهر لك خطوة التحقق" });

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  users[idx].resetCode   = code;
  users[idx].resetExpiry = Date.now() + 10 * 60 * 1000;
  saveUsers(users);

  console.log(`🔐 كود إعادة تعيين كلمة المرور لـ ${email}: ${code}`);
  res.json({ ok: true, _devCode: code, msg: "تم إنشاء رمز التحقق" });
});


// POST /api/auth/verify-reset-code — الخطوة 2: التحقق من الرمز
app.post("/api/auth/verify-reset-code", authLimiter, (req, res) => {
  const { email, code } = req.body;
  if (!email || !code) return res.json({ ok: false, msg: "بيانات ناقصة" });

  const users = readUsers();
  const idx   = users.findIndex(u => u.email === email.toLowerCase().trim());
  if (idx === -1) return res.json({ ok: false, msg: "الرمز غير صحيح أو منتهي الصلاحية" });

  const user = users[idx];
  if (!user.resetCode || user.resetCode !== code.trim())
    return res.json({ ok: false, msg: "الرمز غير صحيح ❌" });
  if (Date.now() > user.resetExpiry)
    return res.json({ ok: false, msg: "انتهت صلاحية الرمز — اطلب رمزاً جديداً" });

  const crypto     = require("crypto");
  const resetToken = crypto.randomBytes(32).toString("hex");
  users[idx].resetToken       = resetToken;
  users[idx].resetTokenExpiry = Date.now() + 15 * 60 * 1000;
  users[idx].resetCode        = null;
  saveUsers(users);

  res.json({ ok: true, resetToken });
});

// POST /api/auth/reset-password — الخطوة 3: تعيين كلمة مرور جديدة
app.post("/api/auth/reset-password", authLimiter, async (req, res) => {
  const { email, resetToken, newPassword } = req.body;
  if (!email || !resetToken || !newPassword)
    return res.json({ ok: false, msg: "بيانات ناقصة" });
  if (newPassword.length < 6)
    return res.json({ ok: false, msg: "كلمة المرور يجب أن تكون 6 أحرف على الأقل" });

  const users = readUsers();
  const idx   = users.findIndex(u => u.email === email.toLowerCase().trim());
  if (idx === -1) return res.json({ ok: false, msg: "البريد غير موجود" });

  const user = users[idx];
  if (!user.resetToken || user.resetToken !== resetToken)
    return res.json({ ok: false, msg: "انتهت الجلسة — ابدأ من جديد" });
  if (Date.now() > user.resetTokenExpiry)
    return res.json({ ok: false, msg: "انتهت صلاحية الجلسة — ابدأ من جديد" });

  users[idx].password         = await bcrypt.hash(newPassword, 12);
  users[idx].resetToken       = null;
  users[idx].resetTokenExpiry = null;
  saveUsers(users);

  const token = signToken(users[idx]);
  res.json({
    ok: true, token,
    user: { id: users[idx].id, name: users[idx].name, email: users[idx].email, role: users[idx].role },
    msg: "تم تغيير كلمة المرور بنجاح"
  });
});

// ===========================
// ===== USER ROUTES =====
// ===========================

// GET /api/user/me
app.get("/api/user/me", authMiddleware, (req, res) => {
  const users = readUsers();
  const user  = users.find(u => u.id === req.user.id);
  if (!user) return res.json({ ok: false, msg: "المستخدم غير موجود" });
  const { password, verifyCode, ...safe } = user;
  res.json({ ok: true, user: safe });
});

// PUT /api/user/update — تعديل الاسم أو البريد
app.put("/api/user/update", authMiddleware, async (req, res) => {
  const { name, email } = req.body;
  const users = readUsers();
  const idx   = users.findIndex(u => u.id === req.user.id);
  if (idx === -1) return res.json({ ok: false, msg: "المستخدم غير موجود" });

  if (name) users[idx].name = name.trim();

  // تغيير البريد → يحتاج تحقق جديد
  if (email && email.toLowerCase() !== users[idx].email) {
    if (users.find(u => u.id !== req.user.id && u.email === email.toLowerCase()))
      return res.json({ ok: false, msg: "هذا البريد مستخدم من حساب آخر" });

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    users[idx].email         = email.toLowerCase().trim();
    users[idx].emailVerified = false;
    users[idx].verifyCode    = code;
    users[idx].verifyExpiry  = Date.now() + 10 * 60 * 1000;
    saveUsers(users);

    // تحديث البريد مباشرة بدون تأكيد
    users[idx].emailVerified = true;
    users[idx].verifyCode    = null;
    saveUsers(users);
    const newToken = signToken(users[idx]);
    return res.json({ ok: true, token: newToken, msg: "تم تحديث البريد الإلكتروني" });
  }

  saveUsers(users);
  const token = signToken(users[idx]);
  res.json({ ok: true, token, msg: "تم تحديث بياناتك" });
});

// PUT /api/user/change-password
app.put("/api/user/change-password", authMiddleware, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword)
    return res.json({ ok: false, msg: "يرجى تعبئة جميع الحقول" });
  if (newPassword.length < 6)
    return res.json({ ok: false, msg: "كلمة المرور الجديدة يجب 6 أحرف على الأقل" });

  const users = readUsers();
  const idx   = users.findIndex(u => u.id === req.user.id);
  const match = await bcrypt.compare(currentPassword, users[idx].password);
  if (!match) return res.json({ ok: false, msg: "كلمة المرور الحالية غير صحيحة" });

  users[idx].password = await bcrypt.hash(newPassword, 12);
  saveUsers(users);
  res.json({ ok: true, msg: "تم تغيير كلمة المرور بنجاح" });
});

// ===========================
// ===== ORDER ROUTES =====
// ===========================


// ===== PRODUCTS API =====

// GET /api/products — جلب المنتجات (للجميع)
app.get("/api/products", (req, res) => {
  res.json({ ok: true, products: readProducts() });
});

// POST /api/admin/products — إضافة منتج
app.post("/api/admin/products", adminMiddleware, (req, res) => {
  const { name, price, image, category, discount } = req.body;
  if (!name || !price) return res.json({ ok: false, msg: "اسم المنتج والسعر مطلوبان" });
  const products = readProducts();
  const product = {
    id: Date.now(), name, price: parseFloat(price),
    image: image || `https://picsum.photos/300/200?random=${Date.now()}`,
    category: category || "tech",
    discount: parseInt(discount) || 0
  };
  products.push(product);
  saveProducts(products);
  res.json({ ok: true, product });
});

// PUT /api/admin/products/:id — تعديل منتج
app.put("/api/admin/products/:id", adminMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  const products = readProducts();
  const idx = products.findIndex(p => p.id === id);
  if (idx === -1) return res.json({ ok: false, msg: "المنتج غير موجود" });
  const { name, price, image, category, discount } = req.body;
  products[idx] = { ...products[idx], name, price: parseFloat(price), image, category, discount: parseInt(discount)||0 };
  saveProducts(products);
  res.json({ ok: true, product: products[idx] });
});

// DELETE /api/admin/products/:id — حذف منتج
app.delete("/api/admin/products/:id", adminMiddleware, (req, res) => {
  const id = parseInt(req.params.id);
  const products = readProducts();
  const filtered = products.filter(p => p.id !== id);
  if (filtered.length === products.length) return res.json({ ok: false, msg: "المنتج غير موجود" });
  saveProducts(filtered);
  res.json({ ok: true });
});

// POST /api/orders/create
app.post("/api/orders/create", authMiddleware, (req, res) => {
  const { items, total, paymentRef } = req.body;
  const orders = readOrders();
  const order  = {
    id:         "ORD-" + Date.now(),
    userId:     req.user.id,
    items,
    total,
    paymentRef,
    status:     "pending",
    createdAt:  new Date().toISOString(),
    updatedAt:  new Date().toISOString(),
  };
  orders.push(order);
  saveOrders(orders);

  // ربط الطلب بالمستخدم
  const users = readUsers();
  const idx   = users.findIndex(u => u.id === req.user.id);
  if (idx !== -1) { users[idx].orders.push(order.id); saveUsers(users); }

  res.json({ ok: true, order });
});

// GET /api/orders/my
app.get("/api/orders/my", authMiddleware, (req, res) => {
  const orders = readOrders().filter(o => o.userId === req.user.id);
  res.json({ ok: true, orders });
});

// ===========================
// ===== ADMIN ROUTES =====
// ===========================

// GET /api/admin/orders
app.get("/api/admin/orders", adminMiddleware, (req, res) => {
  res.json({ ok: true, orders: readOrders() });
});

// PUT /api/admin/orders/:id/status
app.put("/api/admin/orders/:id/status", adminMiddleware, (req, res) => {
  const { status } = req.body;
  const validStatuses = ["pending","confirmed","shipped","delivered","rejected"];
  if (!validStatuses.includes(status))
    return res.json({ ok: false, msg: "حالة غير صحيحة" });

  const orders = readOrders();
  const idx    = orders.findIndex(o => o.id === req.params.id);
  if (idx === -1) return res.json({ ok: false, msg: "الطلب غير موجود" });

  orders[idx].status    = status;
  orders[idx].updatedAt = new Date().toISOString();
  saveOrders(orders);
  res.json({ ok: true, order: orders[idx] });
});


// DELETE /api/admin/users/:id
app.delete("/api/admin/users/:id", adminMiddleware,(req,res)=>{
  const id = parseInt(req.params.id);
  const users = readUsers();
  const user = users.find(u => u.id === id);
  if (!user) return res.json({ok:false, msg:"المستخدم غير موجود"});
  if (user.role === "admin") return res.json({ok:false, msg:"لا يمكن حذف الأدمن"});

  // حذف المستخدم
  saveUsers(users.filter(u => u.id !== id));

  // حذف طلباته أيضاً
  const orders = readOrders().filter(o => o.userId !== id);
  saveOrders(orders);

  res.json({ok:true, msg:"تم حذف المستخدم وطلباته"});
});

// GET /api/admin/users
app.get("/api/admin/users", adminMiddleware, (req, res) => {
  const users = readUsers().map(({ password, verifyCode, ...u }) => u);
  res.json({ ok: true, users });
});



// ===== EXTRA ADMIN FEATURES =====

// 🚫 Ban user
// ✅ Unban user
app.put("/api/admin/unban-user/:id", adminMiddleware,(req,res)=>{
  const users = readUsers();
  const id = parseInt(req.params.id);
  const idx = users.findIndex(u=>u.id===id);
  if(idx===-1) return res.json({ok:false,msg:"المستخدم غير موجود"});
  users[idx].banned = false;
  saveUsers(users);
  res.json({ok:true,msg:"تم رفع الحظر"});
});

app.put("/api/admin/ban-user/:id", adminMiddleware,(req,res)=>{
  const users = readUsers();
  const id = parseInt(req.params.id);
  const idx = users.findIndex(u=>u.id===id);

  if(idx === -1) return res.json({ok:false,msg:"المستخدم غير موجود"});

  users[idx].banned = true;
  saveUsers(users);

  res.json({ok:true,msg:"تم حظر المستخدم"});
});

// 👁 View user orders
app.get("/api/admin/user-orders/:id", adminMiddleware,(req,res)=>{
  const id = parseInt(req.params.id);
  const orders = readOrders().filter(o=>o.userId===id);

  res.json({
    ok:true,
    orders
  });
});

// GET /api/admin/stats
app.get("/api/admin/stats", adminMiddleware, (req, res) => {
  const orders  = readOrders();
  const users   = readUsers();
  const revenue = orders.filter(o => !["pending","rejected"].includes(o.status))
                        .reduce((s, o) => s + o.total, 0);
  res.json({
    ok: true,
    stats: {
      totalOrders: orders.length,
      totalUsers:  users.length,
      revenue,
      pending: orders.filter(o => o.status === "pending").length,
    }
  });
});



// ============================================================
// ===== NOTIFICATIONS ROUTES =====
// ============================================================

const NOTIF_FILE = path.join(__dirname, "data", "notifications.json");
function readNotifs() {
  if (!fs.existsSync(NOTIF_FILE)) fs.writeFileSync(NOTIF_FILE, "{}");
  try { return JSON.parse(fs.readFileSync(NOTIF_FILE)); } catch { return {}; }
}
function saveNotifs(n) { fs.writeFileSync(NOTIF_FILE, JSON.stringify(n, null, 2)); }

// GET /api/notifications — جلب إشعارات المستخدم
app.get("/api/notifications", authMiddleware, (req, res) => {
  const notifs = readNotifs();
  const userNotifs = (notifs[req.user.id] || []).slice(0, 50);
  res.json({ ok: true, notifications: userNotifs });
});

// PUT /api/notifications/read-all
app.put("/api/notifications/read-all", authMiddleware, (req, res) => {
  const notifs = readNotifs();
  notifs[req.user.id] = (notifs[req.user.id] || []).map(n => ({ ...n, read: true }));
  saveNotifs(notifs);
  res.json({ ok: true });
});

// DELETE /api/notifications/:id
app.delete("/api/notifications/:id", authMiddleware, (req, res) => {
  const notifs = readNotifs();
  notifs[req.user.id] = (notifs[req.user.id] || []).filter(n => n.id !== req.params.id);
  saveNotifs(notifs);
  res.json({ ok: true });
});

// POST /api/admin/send-notification — أدمن يرسل إشعار لمستخدم
app.post("/api/admin/send-notification", adminMiddleware, (req, res) => {
  const { userId, type, title, body, link } = req.body;
  const notifs = readNotifs();
  const icons = { order:"🛒", promo:"🎁", system:"⚙️", welcome:"👋", security:"🔐", shipping:"🚚", delivery:"📦" };
  const notif = {
    id: "srv_" + Date.now(),
    type, title, body, link,
    icon: icons[type] || "🔔",
    read: false,
    createdAt: new Date().toISOString()
  };
  if (userId === "all") {
    const users = readUsers();
    users.filter(u => u.role !== "admin").forEach(u => {
      if (!notifs[u.id]) notifs[u.id] = [];
      notifs[u.id].unshift(notif);
      if (notifs[u.id].length > 50) notifs[u.id].splice(50);
    });
  } else {
    const uid = parseInt(userId);
    if (!notifs[uid]) notifs[uid] = [];
    notifs[uid].unshift(notif);
  }
  saveNotifs(notifs);
  res.json({ ok: true, msg: "تم إرسال الإشعار" });
});

// ===== إضافة إشعار تلقائي عند تحديث حالة الطلب =====
function addOrderNotification(userId, orderId, status) {
  const notifs = readNotifs();
  if (!notifs[userId]) notifs[userId] = [];
  const msgs = {
    confirmed: { title: "طلبك تم تأكيده ✅", body: `طلب #${orderId} مؤكد ويُجهَّز للشحن.`, type: "order" },
    shipped:   { title: "طلبك في الطريق! 🚚", body: `طلب #${orderId} خرج للتوصيل. التوصيل خلال 2-3 أيام.`, type: "shipping" },
    delivered: { title: "تم التسليم! 📦", body: `طلب #${orderId} وصل بنجاح. نتمنى رضاك!`, type: "delivery" },
    rejected:  { title: "طلبك مرفوض ❌", body: `للأسف طلب #${orderId} تم رفضه. تواصل مع الدعم.`, type: "system" },
  };
  const m = msgs[status];
  if (!m) return;
  const icons = { order:"🛒", shipping:"🚚", delivery:"📦", system:"⚙️" };
  notifs[userId].unshift({
    id: "auto_" + Date.now(),
    type: m.type,
    title: m.title,
    body: m.body,
    link: "profile.html",
    icon: icons[m.type] || "🔔",
    read: false,
    createdAt: new Date().toISOString()
  });
  if (notifs[userId].length > 50) notifs[userId].splice(50);
  saveNotifs(notifs);
}

// ============================================================
// ===== PUSH NOTIFICATIONS ROUTES =====
// ============================================================
const PUSH_FILE = path.join(__dirname, "data", "push_subscriptions.json");
function readPushSubs()   { try { return JSON.parse(fs.readFileSync(PUSH_FILE)); } catch { return {}; } }
function savePushSubs(d)  { fs.writeFileSync(PUSH_FILE, JSON.stringify(d, null, 2)); }

// POST /api/push/subscribe — حفظ subscription المتصفح
app.post("/api/push/subscribe", authMiddleware, (req, res) => {
  const subscription = req.body;
  if (!subscription || !subscription.endpoint) {
    return res.json({ ok: false, msg: "subscription غير صالح" });
  }
  const subs = readPushSubs();
  if (!subs[req.user.id]) subs[req.user.id] = [];
  // تجنّب التكرار بناءً على endpoint
  const exists = subs[req.user.id].find(s => s.endpoint === subscription.endpoint);
  if (!exists) {
    subs[req.user.id].push(subscription);
    savePushSubs(subs);
  }
  res.json({ ok: true, msg: "تم حفظ الاشتراك" });
});

// DELETE /api/push/unsubscribe
app.delete("/api/push/unsubscribe", authMiddleware, (req, res) => {
  const { endpoint } = req.body;
  const subs = readPushSubs();
  if (subs[req.user.id]) {
    subs[req.user.id] = subs[req.user.id].filter(s => s.endpoint !== endpoint);
    savePushSubs(subs);
  }
  res.json({ ok: true });
});

// GET /api/push/vapid-public — إرسال المفتاح العام للـ frontend
app.get("/api/push/vapid-public", (req, res) => {
  const vapidPublic = process.env.VAPID_PUBLIC_KEY || null;
  res.json({ ok: !!vapidPublic, vapidPublicKey: vapidPublic });
});

// ============================================================
// ===== WISHLIST ROUTES =====
// ============================================================
const WISH_FILE = path.join(__dirname, "data", "wishlists.json");
function readWish()  { try { return JSON.parse(fs.readFileSync(WISH_FILE)); } catch { return {}; } }
function saveWish(w) { fs.writeFileSync(WISH_FILE, JSON.stringify(w, null, 2)); }

app.get("/api/wishlist", authMiddleware, (req, res) => {
  const wish = readWish();
  res.json({ ok: true, wishlist: wish[req.user.id] || [] });
});

app.post("/api/wishlist/toggle", authMiddleware, (req, res) => {
  const { productId } = req.body;
  const wish = readWish();
  if (!wish[req.user.id]) wish[req.user.id] = [];
  const idx = wish[req.user.id].indexOf(productId);
  let added;
  if (idx === -1) { wish[req.user.id].push(productId); added = true; }
  else            { wish[req.user.id].splice(idx, 1);  added = false; }
  saveWish(wish);
  res.json({ ok: true, added, wishlist: wish[req.user.id] });
});

// ============================================================
// ===== REVIEWS ROUTES =====
// ============================================================
const REVIEWS_FILE = path.join(__dirname, "data", "reviews.json");
function readReviews()  { try { return JSON.parse(fs.readFileSync(REVIEWS_FILE)); } catch { return {}; } }
function saveReviews(r) { fs.writeFileSync(REVIEWS_FILE, JSON.stringify(r, null, 2)); }

app.get("/api/reviews/:productId", (req, res) => {
  const reviews = readReviews();
  res.json({ ok: true, reviews: reviews[req.params.productId] || [] });
});

app.post("/api/reviews/:productId", authMiddleware, (req, res) => {
  const { rating, comment } = req.body;
  if (!rating || rating < 1 || rating > 5) return res.json({ ok: false, msg: "تقييم غير صالح" });
  const reviews = readReviews();
  if (!reviews[req.params.productId]) reviews[req.params.productId] = [];
  // مستخدم واحد = تقييم واحد لكل منتج
  const existing = reviews[req.params.productId].findIndex(r => r.userId === req.user.id);
  const review = { userId: req.user.id, userName: req.user.name, rating, comment: comment?.trim() || "", createdAt: new Date().toISOString() };
  if (existing !== -1) reviews[req.params.productId][existing] = review;
  else reviews[req.params.productId].push(review);
  saveReviews(reviews);
  res.json({ ok: true, msg: "شكراً على تقييمك!" });
});

// ============================================================
// ===== COUPONS ROUTES =====
// ============================================================
const COUPONS = {
  "NOVA20": { discount: 20, type: "percent", minOrder: 0 },
  "SAVE10": { discount: 10, type: "percent", minOrder: 30 },
  "FLAT5":  { discount: 5,  type: "fixed",   minOrder: 20 },
  "VIP30":  { discount: 30, type: "percent", minOrder: 50 },
};

app.post("/api/coupons/validate", authMiddleware, (req, res) => {
  const { code, total } = req.body;
  const coupon = COUPONS[code?.toUpperCase()];
  if (!coupon) return res.json({ ok: false, msg: "كود الخصم غير صحيح ❌" });
  if (total < coupon.minOrder) return res.json({ ok: false, msg: `الطلب يجب أن يكون فوق $${coupon.minOrder}` });
  const amount = coupon.type === "percent" ? (total * coupon.discount / 100) : coupon.discount;
  res.json({ ok: true, discount: amount, type: coupon.type, percent: coupon.discount, msg: `🎉 خصم ${coupon.type === "percent" ? coupon.discount + "%" : "$" + coupon.discount} مطبّق!` });
});

// ============================================================
// ===== SEARCH ROUTE =====
// ============================================================
app.get("/api/search", (req, res) => {
  const q = req.query.q?.toLowerCase() || "";
  if (!q) return res.json({ ok: true, results: [] });
  // البحث في المنتجات المحفوظة (للتوسع مستقبلاً)
  res.json({ ok: true, results: [], query: q });
});

// ============================================================
// ===== ANALYTICS ROUTE (Admin) =====
// ============================================================
app.get("/api/admin/analytics", adminMiddleware, (req, res) => {
  const orders = readOrders();
  const users  = readUsers();
  
  // الإيرادات اليومية (آخر 7 أيام)
  const dailyRevenue = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split("T")[0];
    const dayOrders = orders.filter(o => o.createdAt.startsWith(dateStr) && !["pending","rejected"].includes(o.status));
    dailyRevenue.push({ date: dateStr, revenue: dayOrders.reduce((s,o) => s+o.total, 0), count: dayOrders.length });
  }

  // توزيع الحالات
  const statusDist = {};
  orders.forEach(o => { statusDist[o.status] = (statusDist[o.status] || 0) + 1; });

  // مستخدمون جدد (آخر 7 أيام)
  const weekAgo = Date.now() - 7 * 86400000;
  const newUsers = users.filter(u => new Date(u.createdAt).getTime() > weekAgo).length;

  res.json({ ok: true, analytics: { dailyRevenue, statusDist, newUsers, totalUsers: users.filter(u=>u.role!=="admin").length } });
});

// Override order status to also send notification
app.put("/api/admin/orders/:id/status-v2", adminMiddleware, (req, res) => {
  const { status } = req.body;
  const validStatuses = ["pending","confirmed","shipped","delivered","rejected"];
  if (!validStatuses.includes(status)) return res.json({ ok: false, msg: "حالة غير صحيحة" });

  const orders = readOrders();
  const idx    = orders.findIndex(o => o.id === req.params.id);
  if (idx === -1) return res.json({ ok: false, msg: "الطلب غير موجود" });

  const oldStatus = orders[idx].status;
  orders[idx].status    = status;
  orders[idx].updatedAt = new Date().toISOString();
  saveOrders(orders);

  // إرسال إشعار تلقائي
  if (oldStatus !== status) {
    addOrderNotification(orders[idx].userId, orders[idx].id, status);
  }

  res.json({ ok: true, order: orders[idx] });
});

// GET /api/admin/reset-admin-account (مؤقت للطوارئ)
app.get("/api/admin/reset-admin-account", async (req, res) => {
  const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || "baraasaleh079@icloud.com";
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "omar2005";
  let users = readUsers();
  const adminIdx = users.findIndex(u => u.role === "admin");
  const hashed   = await bcrypt.hash(ADMIN_PASSWORD, 12);
  if (adminIdx !== -1) {
    users[adminIdx].email = ADMIN_EMAIL;
    users[adminIdx].password = hashed;
    users[adminIdx].emailVerified = true;
  } else {
    users.push({ id: 1, name: "المدير", email: ADMIN_EMAIL, password: hashed,
      role: "admin", emailVerified: true, verifyCode: null,
      createdAt: new Date().toISOString(), orders: [] });
  }
  saveUsers(users);
  res.json({ ok: true, msg: "تم إعادة ضبط حساب الأدمن: " + ADMIN_EMAIL });
});


// ===== START =====
ensureDataDir();

// إنشاء حساب الأدمن تلقائياً من .env فقط
(async () => {
  const ADMIN_EMAIL    = process.env.ADMIN_EMAIL    || "baraasaleh079@icloud.com";
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "omar2005";

  let users = readUsers();
  const adminIdx = users.findIndex(u => u.role === "admin");
  const hashed   = await bcrypt.hash(ADMIN_PASSWORD, 12);

  if (adminIdx === -1) {
    users.push({
      id: 1, name: "المدير",
      email: ADMIN_EMAIL,
      password: hashed,
      role: "admin",
      emailVerified: true,
      verifyCode: null,
      createdAt: new Date().toISOString(),
      orders: [],
    });
    saveUsers(users);
    console.log("👤 حساب الأدمن:", ADMIN_EMAIL);
  } else if (users[adminIdx].email !== ADMIN_EMAIL) {
    users[adminIdx].email    = ADMIN_EMAIL;
    users[adminIdx].password = hashed;
    saveUsers(users);
    console.log("👤 تم تحديث حساب الأدمن:", ADMIN_EMAIL);
  }

  app.listen(PORT, () => {
    console.log(`\n🚀 NovaShop Server يعمل على: http://localhost:${PORT}`);
    console.log(`📦 API: http://localhost:${PORT}/api`);
  });
})();


// ============================================================
// ===== SESSION MANAGEMENT (ميزة 9) =====
// ============================================================
const SESSIONS_FILE = path.join(__dirname, "data", "sessions.json");
function readSessions()    { try { return JSON.parse(fs.readFileSync(SESSIONS_FILE)); } catch { return {}; } }
function saveSessions(s)   { fs.writeFileSync(SESSIONS_FILE, JSON.stringify(s, null, 2)); }

// تسجيل جلسة جديدة عند كل login
function createSession(userId, token, req) {
  const sessions = readSessions();
  if (!sessions[userId]) sessions[userId] = [];

  const ua        = req.headers["user-agent"] || "";
  const ip        = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket?.remoteAddress || "unknown";
  const deviceType = /mobile|android|iphone|ipad/i.test(ua) ? "mobile" : "desktop";
  const browser    = ua.match(/(Chrome|Firefox|Safari|Edge|Opera)/)?.[1] || "Unknown";
  const os         = ua.match(/(Windows|Mac OS|Linux|Android|iOS)/)?.[1] || "Unknown";

  const session = {
    id:        "sess_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7),
    tokenHash: require("crypto").createHash("sha256").update(token).digest("hex").slice(0, 16),
    deviceType,
    browser,
    os,
    ip,
    createdAt:  new Date().toISOString(),
    lastActive: new Date().toISOString(),
    current:    false, // سيُحدَّد من الـ client
  };

  // احتفظ بأحدث 10 جلسات فقط
  sessions[userId].unshift(session);
  if (sessions[userId].length > 10) sessions[userId] = sessions[userId].slice(0, 10);
  saveSessions(sessions);
  return session.id;
}

// تحديث lastActive للجلسة الحالية
function touchSession(userId, tokenHash) {
  const sessions = readSessions();
  if (!sessions[userId]) return;
  const idx = sessions[userId].findIndex(s => s.tokenHash === tokenHash);
  if (idx !== -1) {
    sessions[userId][idx].lastActive = new Date().toISOString();
    saveSessions(sessions);
  }
}

// GET /api/sessions — جلب جلسات المستخدم
app.get("/api/sessions", authMiddleware, (req, res) => {
  const sessions  = readSessions();
  const userSess  = sessions[req.user.id] || [];
  const curHash   = (req.headers["authorization"] || "").replace("Bearer ","").trim();
  const curShort  = require("crypto").createHash("sha256").update(curHash).digest("hex").slice(0,16);
  // ضع علامة الجلسة الحالية
  const result = userSess.map(s => ({ ...s, current: s.tokenHash === curShort }));
  res.json({ ok: true, sessions: result });
});

// DELETE /api/sessions/:sessionId — إنهاء جلسة معينة
app.delete("/api/sessions/:sessionId", authMiddleware, (req, res) => {
  const { sessionId } = req.params;
  const sessions = readSessions();
  if (!sessions[req.user.id]) return res.json({ ok: false, msg: "لا توجد جلسات" });
  const before = sessions[req.user.id].length;
  sessions[req.user.id] = sessions[req.user.id].filter(s => s.id !== sessionId);
  if (sessions[req.user.id].length === before)
    return res.json({ ok: false, msg: "الجلسة غير موجودة" });
  saveSessions(sessions);
  res.json({ ok: true, msg: "تم إنهاء الجلسة" });
});

// DELETE /api/sessions/all/others — إنهاء كل الجلسات ما عدا الحالية
app.delete("/api/sessions/all/others", authMiddleware, (req, res) => {
  const sessions = readSessions();
  if (!sessions[req.user.id]) return res.json({ ok: true });
  const curHash  = (req.headers["authorization"] || "").replace("Bearer ","").trim();
  const curShort = require("crypto").createHash("sha256").update(curHash).digest("hex").slice(0,16);
  sessions[req.user.id] = sessions[req.user.id].filter(s => s.tokenHash === curShort);
  saveSessions(sessions);
  res.json({ ok: true, msg: "تم إنهاء جميع الجلسات الأخرى" });
});

// ============================================================
// ===== TWO-FACTOR AUTH — 2FA (ميزة 7) =====
// ============================================================
const TFA_FILE = path.join(__dirname, "data", "2fa_codes.json");
function read2FA()    { try { return JSON.parse(fs.readFileSync(TFA_FILE)); } catch { return {}; } }
function save2FA(d)   { fs.writeFileSync(TFA_FILE, JSON.stringify(d, null, 2)); }

// إرسال كود 2FA بالبريد

// POST /api/auth/2fa/send — إرسال كود 2FA (يُعرض في الـ console بدلاً من الإيميل)
app.post("/api/auth/2fa/send", authLimiter, async (req, res) => {
  const { email, password } = req.body;
  const users      = readUsers();
  const allMatches = users.filter(u => u.email === email.toLowerCase().trim());
  const user       = allMatches.find(u => u.role === "admin") || allMatches[0];

  if (!user) return res.json({ ok: false, msg: "البريد أو كلمة المرور غير صحيحة" });
  const match = await bcrypt.compare(password, user.password);
  if (!match)  return res.json({ ok: false, msg: "البريد أو كلمة المرور غير صحيحة" });
  if (user.banned) return res.json({ ok: false, msg: "⛔ تم تقييد هذا الحساب", banned: true });

  if (user.skip2FA) {
    const token = signToken(user);
    createSession(user.id, token, req);
    return res.json({ ok: true, token, user: { id: user.id, name: user.name, email: user.email, role: user.role }, twoFA: false });
  }

  const code    = Math.floor(100000 + Math.random() * 900000).toString();
  const tfaData = read2FA();
  tfaData[user.id] = { code, expiry: Date.now() + 5 * 60 * 1000, attempts: 0 };
  save2FA(tfaData);

  console.log(`[2FA] كود التحقق لـ ${user.email}: ${code}`);
  res.json({ ok: true, twoFA: true, userId: user.id, _devCode: code,
    msg: "تم إنشاء كود التحقق — تحقق من الـ console" });
});


// POST /api/auth/2fa/verify — التحقق من الكود وإتمام الدخول
app.post("/api/auth/2fa/verify", authLimiter, async (req, res) => {
  const { userId, code } = req.body;
  if (!userId || !code) return res.json({ ok: false, msg: "بيانات ناقصة" });

  const tfaData = read2FA();
  const entry   = tfaData[userId];
  if (!entry) return res.json({ ok: false, msg: "لم يتم طلب كود لهذا الحساب — سجّل دخولك مجدداً" });
  if (Date.now() > entry.expiry) return res.json({ ok: false, msg: "انتهت صلاحية الكود ⏰ — حاول مجدداً" });

  entry.attempts = (entry.attempts || 0) + 1;
  if (entry.attempts > 5) return res.json({ ok: false, msg: "تجاوزت عدد المحاولات — حاول بعد قليل" });

  if (entry.code !== code.trim()) {
    save2FA(tfaData);
    return res.json({ ok: false, msg: `الكود غير صحيح ❌ (${5 - entry.attempts} محاولة متبقية)` });
  }

  // ✅ الكود صحيح
  delete tfaData[userId];
  save2FA(tfaData);

  const users = readUsers();
  const user  = users.find(u => u.id == userId);
  if (!user) return res.json({ ok: false, msg: "حساب غير موجود" });

  const token = signToken(user);
  createSession(user.id, token, req);
  res.json({ ok: true, token, user: { id: user.id, name: user.name, email: user.email, role: user.role } });
});

// POST /api/auth/2fa/toggle — تفعيل/إيقاف 2FA
app.post("/api/auth/2fa/toggle", authMiddleware, async (req, res) => {
  const { enable, password } = req.body;
  const users = readUsers();
  const idx   = users.findIndex(u => u.id === req.user.id);
  if (idx === -1) return res.json({ ok: false, msg: "حساب غير موجود" });

  const match = await bcrypt.compare(password, users[idx].password);
  if (!match) return res.json({ ok: false, msg: "كلمة المرور غير صحيحة ❌" });

  users[idx].twoFA = !!enable;
  saveUsers(users);
  res.json({ ok: true, twoFA: users[idx].twoFA, msg: enable ? "✅ تم تفعيل التحقق بخطوتين" : "⚠️ تم إيقاف التحقق بخطوتين" });
});

// GET /api/auth/2fa/status — حالة 2FA للمستخدم الحالي
app.get("/api/auth/2fa/status", authMiddleware, (req, res) => {
  const users = readUsers();
  const user  = users.find(u => u.id === req.user.id);
  res.json({ ok: true, twoFA: !!(user && user.twoFA) });
});

// Patch login to create session + touchSession middleware
const _origAuth = authMiddleware;



// ============================================================
// ===== SET ROLE (admin / staff / customer) =====
// ============================================================
app.put("/api/admin/set-role/:id", adminMiddleware, async (req, res) => {
  const { role } = req.body;
  const validRoles = ["admin", "staff", "customer"];
  if (!validRoles.includes(role))
    return res.json({ ok: false, msg: "دور غير صالح" });

  const users  = readUsers();
  const idx    = users.findIndex(u => u.id == req.params.id);
  if (idx === -1) return res.json({ ok: false, msg: "المستخدم غير موجود" });

  // لا يمكن إزالة آخر أدمن
  if (users[idx].role === "admin" && role !== "admin") {
    const adminCount = users.filter(u => u.role === "admin").length;
    if (adminCount <= 1)
      return res.json({ ok: false, msg: "لا يمكن إزالة المدير الوحيد" });
  }

  users[idx].role = role;
  if (role !== "customer") users[idx].emailVerified = true;
  saveUsers(users);
  res.json({ ok: true, msg: `تم تغيير الدور إلى ${role}`, user: { id: users[idx].id, role } });
});

// ============================================================
// ===== LIVE CHAT SYSTEM =====
// ============================================================
const CHAT_FILE = path.join(__dirname, "data", "chats.json");
function readChats()    { try { return JSON.parse(fs.readFileSync(CHAT_FILE)); } catch { return {}; } }
function saveChats(d)   { fs.writeFileSync(CHAT_FILE, JSON.stringify(d, null, 2)); }

// GET /api/chat/staff — يجلب قائمة الموظفين والأدمن المتاحين
app.get("/api/chat/staff", authMiddleware, (req, res) => {
  const users = readUsers();
  const staff = users
    .filter(u => u.role === "admin" || u.role === "staff")
    .map(u => ({
      id:     u.id,
      name:   u.name,
      role:   u.role,
      avatar: u.name[0].toUpperCase(),
      online: true, // يمكن تطويره لاحقاً
    }));
  res.json({ ok: true, staff });
});

// GET /api/chat/my — محادثات المستخدم الحالي
app.get("/api/chat/my", authMiddleware, (req, res) => {
  const chats  = readChats();
  const userId = req.user.id;
  const myChats = Object.values(chats)
    .filter(c => c.userId == userId || c.staffId == userId)
    .map(c => {
      const users    = readUsers();
      const other    = users.find(u => u.id == (c.userId == userId ? c.staffId : c.userId));
      const lastMsg  = c.messages[c.messages.length - 1];
      const unread   = c.messages.filter(m => m.senderId != userId && !m.read).length;
      return {
        chatId:     c.chatId,
        otherId:    other?.id,
        otherName:  other?.name || "مستخدم",
        otherRole:  other?.role || "customer",
        lastMsg:    lastMsg?.text || "",
        lastTime:   lastMsg?.createdAt || c.createdAt,
        unread,
        status:     c.status || "open",
      };
    })
    .sort((a, b) => new Date(b.lastTime) - new Date(a.lastTime));
  res.json({ ok: true, chats: myChats });
});

// POST /api/chat/start — بدء محادثة جديدة مع موظف/أدمن
app.post("/api/chat/start", authMiddleware, (req, res) => {
  const { staffId } = req.body;
  const users  = readUsers();
  const staff  = users.find(u => u.id == staffId && (u.role === "staff" || u.role === "admin"));
  if (!staff) return res.json({ ok: false, msg: "الموظف غير موجود" });

  const chats  = readChats();
  // تحقق هل توجد محادثة مفتوحة بالفعل
  const existing = Object.values(chats).find(
    c => c.userId == req.user.id && c.staffId == staffId && c.status === "open"
  );
  if (existing) return res.json({ ok: true, chatId: existing.chatId, existing: true });

  const chatId = "chat_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
  chats[chatId] = {
    chatId,
    userId:    req.user.id,
    staffId:   staff.id,
    status:    "open",
    createdAt: new Date().toISOString(),
    messages:  [],
  };
  saveChats(chats);
  res.json({ ok: true, chatId });
});

// POST /api/chat/random — بدء محادثة مع موظف عشوائي
app.post("/api/chat/random", authMiddleware, (req, res) => {
  const users  = readUsers();
  const staff  = users.filter(u => u.role === "staff" || u.role === "admin");
  if (staff.length === 0)
    return res.json({ ok: false, msg: "لا يوجد موظفون متاحون حالياً" });

  const chats  = readChats();
  // هل توجد محادثة مفتوحة مع أي موظف؟
  const existing = Object.values(chats).find(
    c => c.userId == req.user.id && c.status === "open"
  );
  if (existing) return res.json({ ok: true, chatId: existing.chatId, existing: true });

  // اختر موظف عشوائي
  const chosen = staff[Math.floor(Math.random() * staff.length)];
  const chatId = "chat_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6);
  chats[chatId] = {
    chatId,
    userId:    req.user.id,
    staffId:   chosen.id,
    status:    "open",
    createdAt: new Date().toISOString(),
    messages:  [],
  };
  saveChats(chats);
  res.json({ ok: true, chatId, staffName: chosen.name, staffRole: chosen.role });
});

// GET /api/chat/:chatId — جلب رسائل محادثة
app.get("/api/chat/:chatId", authMiddleware, (req, res) => {
  const chats  = readChats();
  const chat   = chats[req.params.chatId];
  if (!chat) return res.json({ ok: false, msg: "المحادثة غير موجودة" });

  const isParticipant = chat.userId == req.user.id || chat.staffId == req.user.id;
  if (!isParticipant) return res.status(403).json({ ok: false, msg: "غير مصرح" });

  // علّم الرسائل كمقروءة
  let updated = false;
  chat.messages.forEach(m => {
    if (m.senderId != req.user.id && !m.read) { m.read = true; updated = true; }
  });
  if (updated) saveChats(chats);

  const users    = readUsers();
  const other    = users.find(u => u.id == (chat.userId == req.user.id ? chat.staffId : chat.userId));
  res.json({ ok: true, chat, otherName: other?.name || "مستخدم", otherRole: other?.role });
});

// POST /api/chat/:chatId/send — إرسال رسالة
app.post("/api/chat/:chatId/send", authMiddleware, (req, res) => {
  const { text } = req.body;
  if (!text || !text.trim()) return res.json({ ok: false, msg: "الرسالة فارغة" });

  const chats = readChats();
  const chat  = chats[req.params.chatId];
  if (!chat) return res.json({ ok: false, msg: "المحادثة غير موجودة" });

  const isParticipant = chat.userId == req.user.id || chat.staffId == req.user.id;
  if (!isParticipant) return res.status(403).json({ ok: false, msg: "غير مصرح" });
  if (chat.status === "closed") return res.json({ ok: false, msg: "المحادثة مغلقة" });

  const msg = {
    id:        "msg_" + Date.now(),
    senderId:  req.user.id,
    text:      text.trim().slice(0, 1000),
    createdAt: new Date().toISOString(),
    read:      false,
  };
  chat.messages.push(msg);
  saveChats(chats);

  // إشعار للطرف الآخر
  const recipientId = chat.userId == req.user.id ? chat.staffId : chat.userId;
  const notifs = readNotifs();
  if (!notifs[recipientId]) notifs[recipientId] = [];
  const users = readUsers();
  const sender = users.find(u => u.id == req.user.id);
  notifs[recipientId].unshift({
    id: "notif_chat_" + Date.now(),
    type: "system",
    icon: "💬",
    title: `رسالة جديدة من ${sender?.name || "مستخدم"}`,
    body:  text.trim().slice(0, 80),
    link:  "chat.html?id=" + req.params.chatId,
    read:  false,
    createdAt: new Date().toISOString(),
  });
  if (notifs[recipientId].length > 50) notifs[recipientId].splice(50);
  saveNotifs(notifs);

  res.json({ ok: true, msg });
});

// PUT /api/chat/:chatId/close — إغلاق المحادثة (موظف أو أدمن)
app.put("/api/chat/:chatId/close", authMiddleware, (req, res) => {
  const chats = readChats();
  const chat  = chats[req.params.chatId];
  if (!chat) return res.json({ ok: false, msg: "المحادثة غير موجودة" });

  const canClose = chat.staffId == req.user.id || req.user.role === "admin";
  if (!canClose) return res.status(403).json({ ok: false, msg: "غير مصرح" });

  chat.status = "closed";
  saveChats(chats);
  res.json({ ok: true });
});


// DELETE /api/chat/:chatId/message/:msgId — حذف رسالة
app.delete("/api/chat/:chatId/message/:msgId", authMiddleware, (req, res) => {
  const chats = readChats();
  const chat  = chats[req.params.chatId];
  if (!chat) return res.json({ ok: false, msg: "المحادثة غير موجودة" });

  const isParticipant = chat.userId == req.user.id || chat.staffId == req.user.id;
  if (!isParticipant) return res.status(403).json({ ok: false, msg: "غير مصرح" });

  const msgIdx = chat.messages.findIndex(m => m.id === req.params.msgId);
  if (msgIdx === -1) return res.json({ ok: false, msg: "الرسالة غير موجودة" });

  // المستخدم العادي يحذف رسائله فقط، الموظف/الأدمن يحذف أي رسالة
  const isStaff = req.user.role === "admin" || req.user.role === "staff";
  if (!isStaff && chat.messages[msgIdx].senderId != req.user.id) {
    return res.status(403).json({ ok: false, msg: "يمكنك حذف رسائلك فقط" });
  }

  chat.messages.splice(msgIdx, 1);
  saveChats(chats);
  res.json({ ok: true });
});

// DELETE /api/chat/:chatId — حذف دردشة كاملة
app.delete("/api/chat/:chatId", authMiddleware, (req, res) => {
  const chats = readChats();
  const chat  = chats[req.params.chatId];
  if (!chat) return res.json({ ok: false, msg: "المحادثة غير موجودة" });

  // المستخدم يحذف محادثاته، الموظف/الأدمن يحذف أي محادثة
  const isStaff = req.user.role === "admin" || req.user.role === "staff";
  const isOwner = chat.userId == req.user.id;
  if (!isStaff && !isOwner) return res.status(403).json({ ok: false, msg: "غير مصرح" });

  delete chats[req.params.chatId];
  saveChats(chats);
  res.json({ ok: true });
});

// GET /api/admin/chats — جميع المحادثات للأدمن والموظف
app.get("/api/admin/chats", authMiddleware, (req, res) => {
  const isStaff = req.user.role === "admin" || req.user.role === "staff";
  if (!isStaff) return res.status(403).json({ ok: false, msg: "غير مصرح" });

  const chats = readChats();
  const users = readUsers();
  const result = Object.values(chats)
    .filter(c => req.user.role === "admin" ? true : c.staffId == req.user.id)
    .map(c => {
      const customer = users.find(u => u.id == c.userId);
      const staff    = users.find(u => u.id == c.staffId);
      const lastMsg  = c.messages[c.messages.length - 1];
      const unread   = c.messages.filter(m => m.senderId != req.user.id && !m.read).length;
      return {
        chatId:       c.chatId,
        customerName: customer?.name || "مستخدم",
        customerId:   c.userId,
        staffName:    staff?.name || "موظف",
        staffId:      c.staffId,
        lastMsg:      lastMsg?.text || "",
        lastTime:     lastMsg?.createdAt || c.createdAt,
        unread,
        status:       c.status || "open",
        msgCount:     c.messages.length,
      };
    })
    .sort((a, b) => new Date(b.lastTime) - new Date(a.lastTime));

  res.json({ ok: true, chats: result });
});

