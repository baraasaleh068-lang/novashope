// ===== NOVASHOP STORE ENGINE =====

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
  {id:1, name:"Smart Watch Pro", price:29, image:"https://picsum.photos/300/200?random=1", category:"tech", discount:15},
  {id:2, name:"Wireless Earbuds", price:25, image:"https://picsum.photos/300/200?random=2", category:"audio", discount:0},
  {id:3, name:"LED Strip Lights", price:15, image:"https://picsum.photos/300/200?random=3", category:"home", discount:20},
  {id:4, name:"Bluetooth Speaker", price:45, image:"https://picsum.photos/300/200?random=4", category:"audio", discount:10},
  {id:5, name:"USB-C Hub 7-in-1", price:35, image:"https://picsum.photos/300/200?random=5", category:"tech", discount:0},
  {id:6, name:"Desk Lamp LED", price:22, image:"https://picsum.photos/300/200?random=6", category:"home", discount:5},
];

let products = JSON.parse(localStorage.getItem("products")) || defaultProducts;
let currentFilter = "all";

// جلب المنتجات من السيرفر عند البداية
async function loadProductsFromServer() {
  try {
    const origin = window.location.origin.startsWith("file") ? "http://localhost:3001" : window.location.origin;
    const res = await fetch(origin + "/api/products", {signal: AbortSignal.timeout(5000)}).then(r=>r.json());
    if (res.ok && res.products && res.products.length > 0) {
      products = res.products;
      localStorage.setItem("products", JSON.stringify(products));
      renderProducts(); renderCart();
    }
  } catch(e) {
    console.warn("⚠️ استخدام المنتجات المحلية:", e.message);
  }
}
let currentSort = "default";
let searchQuery = "";

// ===== CART =====
function getCart() { return JSON.parse(localStorage.getItem("cart")) || []; }
function saveCart(cart) { localStorage.setItem("cart", JSON.stringify(cart)); updateCartCount(); }

function addToCart(id) {
  const cart = getCart();
  cart.push(id);
  saveCart(cart);
  showToast("✅ تمت الإضافة للسلة!");
}

function removeFromCart(index) {
  const cart = getCart();
  cart.splice(index, 1);
  saveCart(cart);
  renderCart();
  showToast("🗑️ تم الحذف من السلة");
}

function updateCartCount() {
  const badge = document.getElementById("cartCount");
  if (badge) badge.textContent = getCart().length;
}

// ===== PRODUCTS RENDER =====
function getFilteredProducts() {
  let list = [...products];
  if (currentFilter !== "all") list = list.filter(p => p.category === currentFilter);
  if (searchQuery) list = list.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()));
  if (currentSort === "price-asc") list.sort((a, b) => a.price - b.price);
  else if (currentSort === "price-desc") list.sort((a, b) => b.price - a.price);
  else if (currentSort === "name") list.sort((a, b) => a.name.localeCompare(b.name));
  return list;
}

function renderProducts() {
  const container = document.getElementById("product-list");
  if (!container) return;

  const list = getFilteredProducts();
  container.innerHTML = "";

  if (list.length === 0) {
    container.innerHTML = `
      <div style="grid-column:1/-1; text-align:center; padding:80px 0; color:var(--muted)">
        <div style="font-size:4rem; margin-bottom:16px">🔍</div>
        <h3 style="font-size:1.3rem; margin-bottom:8px">لم يتم إيجاد منتجات</h3>
        <p>جرب البحث بكلمات مختلفة</p>
      </div>`;
    return;
  }

  list.forEach((p, i) => {
    const finalPrice = p.discount ? (p.price * (1 - p.discount / 100)).toFixed(2) : p.price;
    const div = document.createElement("div");
    div.className = "product-card";
    div.style.animationDelay = (i * 0.07) + "s";
    div.innerHTML = `
      <div class="product-img-wrap">
        <img src="${p.image}" alt="${_esc(p.name)}" loading="lazy">
        <div class="product-overlay">
          <button onclick="addToCart(${p.id})" class="quick-add">+ أضف للسلة</button>
        </div>
        ${p.discount ? `<span class="product-badge">-${p.discount}%</span>` : ""}
      </div>
      <div class="product-info">
        <h3>${_esc(p.name)}</h3>
        <div class="product-meta">
          <div>
            <span class="product-price">$${finalPrice}</span>
            ${p.discount ? `<span style="color:var(--muted);font-size:0.8rem;text-decoration:line-through;margin-right:6px">$${p.price}</span>` : ""}
          </div>
          <span class="product-rating">⭐ 4.${7 + (p.id % 3)}</span>
        </div>
        <button onclick="addToCart(${p.id})" class="add-cart-btn">أضف للسلة 🛒</button>
      </div>
    `;
    container.appendChild(div);
  });
}

function setFilter(filter, btn) {
  currentFilter = filter;
  document.querySelectorAll(".filter-tab").forEach(t => t.classList.remove("active"));
  btn.classList.add("active");
  renderProducts();
}

function sortProducts(val) {
  currentSort = val;
  renderProducts();
}

function filterProducts() {
  searchQuery = document.getElementById("searchInput")?.value || "";
  renderProducts();
}

// ===== CART RENDER =====
function renderCart() {
  const wrapper = document.getElementById("cartWrapper");
  if (!wrapper) return;

  const cart = getCart();

  if (cart.length === 0) {
    wrapper.innerHTML = `
      <div class="empty-cart">
        <div class="empty-icon">🛒</div>
        <h2>سلتك فارغة</h2>
        <p>ابدأ التسوق الآن وأضف منتجاتك المفضلة</p>
        <a href="products.html" class="btn-primary" style="display:inline-flex">تصفّح المنتجات ←</a>
      </div>`;
    updateCartCount();
    return;
  }

  const cartProducts = cart.map(id => products.find(p => p.id === id)).filter(Boolean);
  const subtotal = cartProducts.reduce((sum, p) => {
    const fp = p.discount ? p.price * (1 - p.discount / 100) : p.price;
    return sum + fp;
  }, 0);
  const shipping = subtotal > 50 ? 0 : 5;
  const total = subtotal + shipping;

  wrapper.innerHTML = `
    <h1>🛒 سلة التسوق <span style="color:var(--muted);font-size:1rem;font-weight:400">(${cart.length} منتج)</span></h1>
    <div id="cart-items"></div>
    <div class="cart-summary">
      <h3>ملخص الطلب</h3>
      <div class="summary-row"><span>المجموع الجزئي</span><span>$${subtotal.toFixed(2)}</span></div>
      <div class="summary-row"><span>الشحن</span><span>${shipping === 0 ? '<span style="color:#22c55e">مجاني</span>' : '$' + shipping}</span></div>
      ${shipping > 0 ? `<div class="summary-row" style="color:var(--accent);font-size:0.85rem"><span>أضف $${(50 - subtotal).toFixed(2)} للشحن المجاني</span></div>` : ''}
      <div class="summary-row total"><span>الإجمالي</span><span>$${total.toFixed(2)}</span></div>
      <button class="checkout-btn" onclick="checkout()">إتمام الشراء ✓</button>
      <a href="products.html" style="display:block;text-align:center;color:var(--muted);text-decoration:none;margin-top:12px;font-size:0.9rem">← متابعة التسوق</a>
    </div>
  `;

  const itemsContainer = document.getElementById("cart-items");
  cartProducts.forEach((p, i) => {
    if (!p) return;
    const finalPrice = p.discount ? (p.price * (1 - p.discount / 100)).toFixed(2) : p.price;
    const div = document.createElement("div");
    div.className = "cart-item";
    div.innerHTML = `
      <img src="${p.image}" alt="${_esc(p.name)}">
      <div class="cart-item-info">
        <div class="cart-item-name">${_esc(p.name)}</div>
        <div class="cart-item-price">$${finalPrice}</div>
        ${p.discount ? `<div style="color:var(--muted);font-size:0.8rem">وفّرت $${(p.price - finalPrice).toFixed(2)}</div>` : ""}
      </div>
      <button class="cart-item-remove" onclick="removeFromCart(${i})">🗑️ حذف</button>
    `;
    itemsContainer.appendChild(div);
  });

  updateCartCount();
}

function checkout() {
  const session = typeof DB !== "undefined" ? DB.getSession() : null;
  if (!session) {
    window.location.href = "login.html?redirect=checkout.html";
  } else {
    window.location.href = "checkout.html";
  }
}

// ===== TOAST =====
function showToast(msg) {
  let t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3000);
}

// ===== INIT =====
document.addEventListener("DOMContentLoaded", () => {
  updateCartCount();
  renderProducts();
  renderCart();
  loadProductsFromServer(); // جلب من السيرفر
});
