// ===== NOVASHOP ADMIN ENGINE =====

// Sanitize user input before innerHTML insertion
function _esc(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

const defaultProducts = [
  {id:1, name:"Smart Watch Pro",  price:29, image:"https://picsum.photos/300/200?random=1", category:"tech",  discount:15},
  {id:2, name:"Wireless Earbuds", price:25, image:"https://picsum.photos/300/200?random=2", category:"audio", discount:0},
  {id:3, name:"LED Strip Lights", price:15, image:"https://picsum.photos/300/200?random=3", category:"home",  discount:20},
  {id:4, name:"Bluetooth Speaker",price:45, image:"https://picsum.photos/300/200?random=4", category:"audio", discount:10},
  {id:5, name:"USB-C Hub 7-in-1", price:35, image:"https://picsum.photos/300/200?random=5", category:"tech",  discount:0},
  {id:6, name:"Desk Lamp LED",    price:22, image:"https://picsum.photos/300/200?random=6", category:"home",  discount:5},
];

let products = JSON.parse(localStorage.getItem("products")) || defaultProducts;
function save() { localStorage.setItem("products", JSON.stringify(products)); }

function showToast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg; t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3000);
}

function addProduct() {
  const name     = document.getElementById("name").value.trim();
  const price    = parseFloat(document.getElementById("price").value);
  const image    = document.getElementById("image").value.trim();
  const category = document.getElementById("category").value;
  const discount = parseInt(document.getElementById("discount").value) || 0;

  if (!name)            { showToast("⚠️ أدخل اسم المنتج"); return; }
  if (!price || price<=0){ showToast("⚠️ أدخل سعراً صحيحاً"); return; }

  products.push({
    id: Date.now(), name, price,
    image: image || `https://picsum.photos/300/200?random=${Date.now()}`,
    category, discount
  });
  save();
  showToast("✅ تم إضافة المنتج!");
  ["name","price","image","discount"].forEach(id => { document.getElementById(id).value = ""; });
  renderAdmin(); renderStats();
}

function deleteProduct(id) {
  if (!confirm("هل أنت متأكد من حذف هذا المنتج؟")) return;
  products = products.filter(p => p.id !== id);
  save();
  showToast("🗑️ تم حذف المنتج");
  renderAdmin(); renderStats();
}

// ===== STATS =====
function renderStats() {
  const container = document.getElementById("adminStats");
  if (!container) return;
  const stats = DB.getStats();
  const pending = DB.getAllOrders().filter(o => o.status === "pending").length;

  container.innerHTML = `
    <div class="stat-card"><div class="stat-card-icon">📦</div><div class="stat-card-num">${products.length}</div><div class="stat-card-label">المنتجات</div></div>
    <div class="stat-card"><div class="stat-card-icon">👥</div><div class="stat-card-num">${stats.totalUsers}</div><div class="stat-card-label">المستخدمين</div></div>
    <div class="stat-card"><div class="stat-card-icon">🛒</div><div class="stat-card-num">${stats.totalOrders}</div><div class="stat-card-label">الطلبات</div></div>
    <div class="stat-card" style="border-color:${pending>0?'var(--gold)':'var(--border)'}">
      <div class="stat-card-icon">⏳</div>
      <div class="stat-card-num" style="color:var(--gold)">${pending}</div>
      <div class="stat-card-label">تنتظر ClickPay</div>
    </div>
    <div class="stat-card"><div class="stat-card-icon">💰</div><div class="stat-card-num">$${stats.revenue.toFixed(0)}</div><div class="stat-card-label">الإيرادات</div></div>
    <div class="stat-card"><div class="stat-card-icon">✅</div><div class="stat-card-num">${stats.totalOrders - pending}</div><div class="stat-card-label">طلبات مؤكدة</div></div>
  `;
}

// ===== ORDERS =====
const statusMap = {
  pending:   {label:"⏳ قيد المراجعة", cls:"status-pending"},
  confirmed: {label:"✅ مؤكد",          cls:"status-confirmed"},
  shipped:   {label:"🚚 تم الشحن",      cls:"status-shipped"},
  delivered: {label:"📦 تم التسليم",   cls:"status-delivered"},
  rejected:  {label:"❌ مرفوض",         cls:"status-rejected"},
};

function renderOrders() {
  const container = document.getElementById("adminOrders");
  if (!container) return;
  const orders = DB.getAllOrders().slice().reverse();
  const users  = DB.getUsers();

  if (orders.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:60px;color:var(--muted)">لا توجد طلبات بعد</div>`;
    return;
  }

  container.innerHTML = "";
  orders.forEach(order => {
    const st   = statusMap[order.status] || statusMap.pending;
    const user = users.find(u => u.id === order.userId);
    const date = new Date(order.createdAt).toLocaleDateString("ar-JO",{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"});

    const div = document.createElement("div");
    div.className = "order-admin-card";
    div.innerHTML = `
      <div class="order-admin-top">
        <div>
          <div class="order-admin-id">${_esc(order.id)}</div>
          <div class="order-admin-meta">👤 ${user ? user.name + " · " + user.email : "زائر"} · ${date}</div>
        </div>
        <div class="status-badge ${st.cls}">${st.label}</div>
      </div>
      <div class="order-admin-info">
        <div class="order-info-row"><span>💰 المبلغ</span><strong style="color:var(--accent);font-family:'Space Mono',monospace">$${order.total.toFixed(2)}</strong></div>
        <div class="order-info-row"><span>📋 رقم ClickPay</span><strong style="font-family:'Space Mono',monospace;font-size:0.85rem">${order.paymentRef||"—"}</strong></div>
        <div class="order-info-row"><span>🛍️ المنتجات</span><strong>${(order.items||[]).length} منتج</strong></div>
      </div>
      <div class="order-admin-actions">
        ${order.status==="pending" ? `
          <button class="confirm-btn" onclick="changeStatus('${_esc(order.id)}','confirmed')">✅ قبول التحويل وتأكيد الطلب</button>
          <button class="reject-btn"  onclick="changeStatus('${_esc(order.id)}','rejected')">❌ رفض</button>` : ""}
        ${order.status==="confirmed" ? `<button class="ship-btn"    onclick="changeStatus('${_esc(order.id)}','shipped')">🚚 تم الشحن</button>` : ""}
        ${order.status==="shipped"   ? `<button class="deliver-btn" onclick="changeStatus('${_esc(order.id)}','delivered')">📦 تم التسليم</button>` : ""}
        ${["delivered","rejected"].includes(order.status) ? `<span style="color:var(--muted);font-size:0.85rem">✓ مكتمل</span>` : ""}
      </div>`;
    container.appendChild(div);
  });
}

function changeStatus(id, status) {
  DB.updateOrderStatus(id, status);
  const msgs = { confirmed:"✅ تم قبول الطلب!", rejected:"❌ تم رفض الطلب", shipped:"🚚 تم الشحن", delivered:"📦 تم التسليم" };
  showToast(msgs[status] || "تم التحديث");
  renderOrders(); renderStats();
}

// ===== USERS =====
function renderUsers() {
  const container = document.getElementById("adminUsers");
  if (!container) return;
  const users = DB.getUsers().filter(u => u.role !== "admin");

  if (users.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:60px;color:var(--muted)">لا يوجد مستخدمون مسجّلون بعد</div>`;
    return;
  }

  container.innerHTML = "";
  users.forEach(u => {
    const orders = DB.getUserOrders(u.id);
    const spent  = orders.filter(o => !["pending","rejected"].includes(o.status)).reduce((s,o) => s+o.total, 0);
    const div = document.createElement("div");
    div.className = "user-card";
    div.innerHTML = `
      <div class="user-avatar">${u.name[0]}</div>
      <div class="user-info">
        <div class="user-name">${_esc(u.name)}</div>
        <div class="user-email">${_esc(u.email)}</div>
        <div style="margin-top:5px;display:flex;gap:8px;align-items:center">
          <span class="user-role-badge role-customer">عميل</span>
          <span style="font-size:0.72rem;color:${u.emailVerified?'#22c55e':'var(--gold)'}">
            ${u.emailVerified ? '✓ بريد مؤكد' : '⚠ بريد غير مؤكد'}
          </span>
        </div>
        <div style="color:var(--muted);font-size:0.75rem;margin-top:4px">
          انضم: ${new Date(u.createdAt).toLocaleDateString("ar-JO")}
        </div>
      </div>
      <div class="user-stats">
        <div class="user-stat-item"><div>${orders.length}</div><small>طلب</small></div>
        <div class="user-stat-item"><div style="color:var(--accent)">$${spent.toFixed(0)}</div><small>مشتريات</small></div>
      </div>`;
    container.appendChild(div);
  });
}

// ===== TABS =====
function showAdminTab(tab, btn) {
  document.querySelectorAll(".admin-nav-btn").forEach(b => b.classList.remove("active"));
  btn.classList.add("active");
  document.querySelectorAll(".admin-tab-content").forEach(t => t.style.display = "none");
  document.getElementById("tab-" + tab).style.display = "block";
  if (tab === "orders") renderOrders();
  if (tab === "users")  renderUsers();
}

// ===== PRODUCTS =====
function renderAdmin() {
  const container = document.getElementById("admin-products");
  if (!container) return;
  container.innerHTML = "";

  if (products.length === 0) {
    container.innerHTML = `<div style="text-align:center;padding:60px;color:var(--muted);grid-column:1/-1">لا توجد منتجات. أضف منتجاً!</div>`;
    return;
  }

  products.forEach(p => {
    const fp = p.discount ? (p.price*(1-p.discount/100)).toFixed(2) : p.price;
    const div = document.createElement("div");
    div.className = "admin-product-card";
    div.innerHTML = `
      <img src="${p.image}" alt="${_esc(p.name)}" loading="lazy">
      <div class="admin-product-card-info">
        <h3>${_esc(p.name)}</h3>
        <div class="price">
          $${fp}
          ${p.discount ? `<span style="color:var(--muted);font-size:0.8rem;text-decoration:line-through;margin-right:4px">$${p.price}</span><span style="color:#22c55e;font-size:0.78rem"> -${p.discount}%</span>` : ""}
        </div>
        <div style="color:var(--muted);font-size:0.78rem;margin-bottom:12px">${getCategoryName(p.category)}</div>
        <button class="delete-btn" onclick="deleteProduct(${p.id})">🗑️ حذف</button>
      </div>`;
    container.appendChild(div);
  });
}

function getCategoryName(cat) {
  return {tech:"📱 تقنية", audio:"🎧 صوتيات", home:"🏠 منزل", fashion:"👟 أزياء"}[cat] || cat;
}

function updateCartCount() {
  const b = document.getElementById("cartCount");
  if (b) b.textContent = (JSON.parse(localStorage.getItem("cart"))||[]).length;
}

document.addEventListener("DOMContentLoaded", () => {
  updateCartCount();
  renderAdmin();
  renderStats();
});
