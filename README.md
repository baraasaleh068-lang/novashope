# 🚀 NovaShop — دليل التشغيل الكامل

## المتطلبات
- Node.js v16 أو أحدث → https://nodejs.org
- حساب Gmail (أو أي بريد SMTP)

---

## الخطوة 1 — تجهيز مجلد السيرفر

```
novashop-server/
├── server.js          ← السيرفر الرئيسي
├── package.json
├── .env               ← إعداداتك السرية
└── public/            ← انسخ ملفات الموقع هنا
    ├── index.html
    ├── login.html
    ├── products.html
    ├── cart.html
    ├── checkout.html
    ├── profile.html
    ├── admin.html
    ├── styles.css
    ├── store.js
    ├── db.js
    ├── api.js
    └── admin.js
```

---

## الخطوة 2 — إعداد Gmail App Password

1. افتح: https://myaccount.google.com/security
2. فعّل **التحقق بخطوتين** أولاً
3. افتح: https://myaccount.google.com/apppasswords
4. اختر "Mail" ثم "Windows Computer" (أو أي اسم)
5. انسخ الـ Password المكوّن من 16 حرف

---

## الخطوة 3 — إعداد ملف .env

```bash
# في مجلد novashop-server أنشئ ملف اسمه .env
cp .env.example .env
```

عدّل القيم:
```env
SMTP_USER=your_gmail@gmail.com
SMTP_PASS=xxxx xxxx xxxx xxxx    # App Password من الخطوة 2
JWT_SECRET=any_long_random_string_here_32_chars_min
PORT=3001
```

---

## الخطوة 4 — تثبيت المكتبات وتشغيل السيرفر

```bash
cd novashop-server
npm install
npm start
```

يجب أن ترى:
```
✅ البريد الإلكتروني متصل ويعمل
🚀 NovaShop Server يعمل على: http://localhost:3001
👤 حساب الأدمن: admin@novashop.com / admin123
```

---

## الخطوة 5 — تشغيل الموقع

افتح المتصفح على: **http://localhost:3001**

---

## API Endpoints

| Method | Path | الوصف |
|--------|------|-------|
| POST | /api/auth/register | تسجيل مستخدم جديد |
| POST | /api/auth/verify-email | تأكيد رمز البريد |
| POST | /api/auth/resend-code | إعادة إرسال الرمز |
| POST | /api/auth/login | تسجيل الدخول |
| GET  | /api/user/me | بيانات المستخدم |
| PUT  | /api/user/update | تعديل الاسم/البريد |
| PUT  | /api/user/change-password | تغيير كلمة المرور |
| POST | /api/orders/create | إنشاء طلب جديد |
| GET  | /api/orders/my | طلبات المستخدم |
| GET  | /api/admin/orders | كل الطلبات (أدمن) |
| PUT  | /api/admin/orders/:id/status | تحديث حالة طلب |
| GET  | /api/admin/users | كل المستخدمين |
| GET  | /api/admin/stats | إحصائيات |

---

## بيانات الأدمن الافتراضية
- **البريد:** admin@novashop.com
- **كلمة المرور:** admin123
- ⚠️ غيّرها في ملف data/users.json بعد أول تشغيل

---

## للرفع على الإنترنت (Render / Railway)

1. ارفع مجلد `novashop-server` على GitHub
2. أنشئ Web Service جديد
3. أضف متغيرات البيئة (SMTP_USER, SMTP_PASS, JWT_SECRET)
4. في `api.js` غيّر:
   ```js
   BASE: "https://your-app.onrender.com/api"
   ```
