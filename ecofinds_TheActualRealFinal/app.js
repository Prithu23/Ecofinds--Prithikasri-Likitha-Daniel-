/* EcoFinds localStorage 'backend' */
const storeKey = {
  users: 'ecf_users',
  session: 'ecf_session',
  products: 'ecf_products',
  carts: 'ecf_carts',   // {userId: [{productId, qty}]}
  orders: 'ecf_orders'  // {userId: [order]}
};

function read(key, def){
  try{ const v = JSON.parse(localStorage.getItem(key)); return v ?? def; }catch(e){ return def; }
}
function write(key, val){ localStorage.setItem(key, JSON.stringify(val)); }

function uid(){ return Math.random().toString(36).slice(2) + Date.now().toString(36); }

// Money (store/display in rupees)
function money(c){ return '₹' + Number(c || 0).toFixed(2); }

// Eco helpers
function isEco(p){ return Number(p.years_used||0) >= 2; }
function discountRate(ecoCredits){
  if(ecoCredits >= 10) return 0.15;
  if(ecoCredits >= 6)  return 0.10;
  if(ecoCredits >= 3)  return 0.05;
  return 0;
}
function nextTierInfo(ecoCredits){
  if(ecoCredits < 3)  return {nextAt: 3,  rate: 0.05};
  if(ecoCredits < 6)  return {nextAt: 6,  rate: 0.10};
  if(ecoCredits < 10) return {nextAt: 10, rate: 0.15};
  return {nextAt: null, rate: 0.15}; // maxed
}

function seedIfEmpty(){
  const users = read(storeKey.users, []);
  const products = read(storeKey.products, []);
  if(users.length===0){
    const demoUsers = [
      { email:'demo@ecofinds.dev', username:'demouser', password:'demo123', points:120, rating:4.4, eco_credits:0 }
    ];
    demoUsers.forEach(d => users.push({ id: uid(), ...d }));
    write(storeKey.users, users);
    write(storeKey.session, {userId: users[0].id}); // auto-login for demo
  }
  if(products.length===0){
    // Mix of ECO and non-eco; image filenames must exist in your project folder
    const demo = [
      {title:'Vintage Denim Jacket',            price:  999, cat:'Clothing',    img:'jacket.jpg',      years_used:3}, // ECO
      {title:'Refurbished Laptop i5 (2019)',    price:18999, cat:'Electronics', img:'laptop.jpg',      years_used:4}, // ECO
      {title:'Solid Wood Study Table',          price: 4999, cat:'Furniture',   img:'table.jpg',       years_used:2}, // ECO
      {title:'Set of 5 Novels',                 price:  799, cat:'Books',       img:'book.jpg',        years_used:1},
      {title:'Hybrid Bicycle (M)',              price: 6999, cat:'Sports',      img:'bike.jpg',        years_used:2}, // ECO
      {title:'Kids Toy Bundle',                 price:  499, cat:'Kids',        img:'toy.jpg',         years_used:0},
      {title:'Bluetooth Headphones',            price: 1299, cat:'Electronics', img:'headphones.jpg',  years_used:2}, // ECO
      {title:'Office Chair - Mesh',             price: 2499, cat:'Furniture',   img:'chair.jpg',       years_used:1}
    ];
    write(storeKey.products, demo.map(d=>({ 
      id: uid(),
      sellerId: read(storeKey.session,{}).userId, 
      title:d.title,
      description:'Gently used. Pickup preferred.',
      price_cents:d.price,            // stored in rupees (name kept for compatibility)
      category:d.cat,
      cover_image_url:d.img,          // images should be in the same folder (or adjust paths)
      years_used: d.years_used || 0,
      created_at: Date.now(),
      is_active:true
    })));
  }
  if(read(storeKey.carts,null)===null) write(storeKey.carts, {});
  if(read(storeKey.orders,null)===null) write(storeKey.orders, {});
}

function currentUser(){
  const s = read(storeKey.session,null);
  if(!s) return null;
  const users = read(storeKey.users,[]);
  return users.find(u=>u.id===s.userId) || null;
}
function saveUser(u){
  const users = read(storeKey.users, []);
  const i = users.findIndex(x=>x.id===u.id);
  if(i!==-1){ users[i] = u; write(storeKey.users, users); }
}

function requireAuth(redirectTo = 'login.html'){
  const u = currentUser();
  if(!u){ window.location.href = redirectTo; return null; }
  return u;
}
function signOut(){
  localStorage.removeItem(storeKey.session);
  window.location.href = 'login.html';
}

/* Products API (local) */
const Product = {
  all(){ return read(storeKey.products, []); },
  find(id){ return Product.all().find(p=>p.id===id); },
  bySeller(sellerId){ return Product.all().filter(p=>p.sellerId===sellerId); },
  create(data){
    const p = {id: uid(), ...data, created_at: Date.now(), is_active:true};
    const all = Product.all(); all.unshift(p); write(storeKey.products, all); return p;
  },
  update(id, patch){
    const all = Product.all();
    const i = all.findIndex(p=>p.id===id); if(i===-1) return null;
    all[i] = {...all[i], ...patch}; write(storeKey.products, all); return all[i];
  },
  remove(id){
    write(storeKey.products, Product.all().filter(p=>p.id!==id));
  }
};

/* Cart + Orders */
const Cart = {
  _all(){ return read(storeKey.carts, {}); },
  _save(obj){ write(storeKey.carts, obj); },
  items(userId){
    const all = Cart._all(); return all[userId] || [];
  },
  setItems(userId, items){
    const all = Cart._all(); all[userId] = items; Cart._save(all);
  },
  add(userId, productId, qty=1){
    const items = Cart.items(userId);
    const i = items.findIndex(x=>x.productId===productId);
    if(i===-1) items.push({productId, qty}); else items[i].qty += qty;
    Cart.setItems(userId, items);
  },
  update(userId, productId, qty){
    let items = Cart.items(userId);
    items = items.map(x=> x.productId===productId ? {...x, qty:Number(qty)} : x).filter(x=>x.qty>0);
    Cart.setItems(userId, items);
  },
  clear(userId){ Cart.setItems(userId, []); }
};

const Orders = {
  _all(){ return read(storeKey.orders, {}); },
  _save(o){ write(storeKey.orders, o); },
  list(userId){ const o = Orders._all(); return o[userId] || []; },
  createFromCart(userId){
    const cartItems = Cart.items(userId);
    const prodMap = Object.fromEntries(Product.all().map(p=>[p.id,p]));
    let total = 0;
    let ecoCreditsEarned = 0;
    
    const lineItems = cartItems.map(ci=>{
      const p = prodMap[ci.productId];
      const price = p?.price_cents || 0;
      total += price*ci.qty;
      
      // Award eco credits for eco products
      if(isEco(p)) {
        ecoCreditsEarned += ci.qty; // 1 credit per eco item
      }
      
      return {product_id:ci.productId, title_snapshot:p?.title||'Unknown', price_cents_snapshot:price, qty:ci.qty, is_eco:isEco(p)};
    });
    
    // Apply discount based on current eco credits
    const user = currentUser();
    const currentCredits = user?.eco_credits || 0;
    const discountRateValue = discountRate(currentCredits);
    const discountAmount = total * discountRateValue;
    const finalTotal = total - discountAmount;
    
    const order = {
      id: uid(), 
      buyer_id:userId, 
      subtotal_cents:total,
      discount_cents:discountAmount,
      total_cents:finalTotal, 
      eco_credits_earned:ecoCreditsEarned,
      created_at:Date.now(), 
      items:lineItems
    };
    
    const all = Orders._all();
    all[userId] = [order].concat(all[userId]||[]);
    Orders._save(all);
    
    // Update user's eco credits
    if(ecoCreditsEarned > 0) {
      const users = read(storeKey.users, []);
      const userIndex = users.findIndex(u => u.id === userId);
      if(userIndex !== -1) {
        users[userIndex].eco_credits = (users[userIndex].eco_credits || 0) + ecoCreditsEarned;
        write(storeKey.users, users);
      }
    }
    
    Cart.clear(userId);
    return order;
  }
};

/* Search + filter */
function filterProducts(q='', category='All'){
  q = (q||'').trim().toLowerCase();
  const all = Product.all().filter(p=>p.is_active);
  return all.filter(p=>{
    const passQ = !q || p.title.toLowerCase().includes(q);
    const passC = category==='All' || p.category===category;
    return passQ && passC;
  });
}

/* Utilities for DOM */
function el(sel){ return document.querySelector(sel); }
function els(sel){ return [...document.querySelectorAll(sel)]; }

/* Init seeds on first load */
seedIfEmpty();
