// 1. ตั้งค่า Supabase
const SUPABASE_URL = 'https://qsuqfuhjpzbkgcdyougc.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFzdXFmdWhqcHpia2djZHlvdWdjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM2MzYwNjEsImV4cCI6MjA4OTIxMjA2MX0.REZMDahsqAKSAfexEpu6bWIuqaow0OGtOOwSQACf_WI';

// สร้าง Supabase Client
const _supabase = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

const loginForm = document.getElementById('loginForm');
const messageDiv = document.getElementById('message');
const loginBtn = document.getElementById('loginBtn');

let currentUser = null;
let inventoryData = [];
let userMasterData = [];
let categoryData = [];
let itemMasterData = [];
let transactionData = [];
let currentView = 'inventory';
let editingTransactionItem = null;

// --- Pagination Settings ---
const PAGE_SIZE = 500;
let currentInventoryPage = 0;
let currentItemPage = 0;
let currentCategoryPage = 0;
let currentTransactionPage = 0;
let currentUserPage = 0;

// Helper: สร้างปุ่ม Pagination
function renderPagination(containerId, totalCount, currentPage, onPageChange) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const totalPages = Math.ceil(totalCount / PAGE_SIZE);
    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    let html = `
        <button class="pagination-btn" ${currentPage === 0 ? 'disabled' : ''} onclick="${onPageChange}(0)">First</button>
        <button class="pagination-btn" ${currentPage === 0 ? 'disabled' : ''} onclick="${onPageChange}(${currentPage - 1})">Prev</button>
        <span class="pagination-info">หน้า ${currentPage + 1} จาก ${totalPages} (ทั้งหมด ${totalCount.toLocaleString()} รายการ)</span>
        <button class="pagination-btn" ${currentPage >= totalPages - 1 ? 'disabled' : ''} onclick="${onPageChange}(${currentPage + 1})">Next</button>
        <button class="pagination-btn" ${currentPage >= totalPages - 1 ? 'disabled' : ''} onclick="${onPageChange}(${totalPages - 1})">Last</button>
    `;
    container.innerHTML = html;
}

function initLoading() {
    if (!document.getElementById('loadingOverlay')) {
        const loading = document.createElement('div');
        loading.id = 'loadingOverlay';
        loading.className = 'loading-overlay';
        loading.innerHTML = `
            <div class="spinner"></div>
            <p style="font-weight: 700; color: #3A2E5B; letter-spacing: 1px; text-transform: uppercase; font-size: 0.85rem;">กำลังประมวลผลข้อมูล...</p>
        `;
        document.body.appendChild(loading);
    }
}

function showLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.style.display = 'flex';
}

function hideLoading() {
    const overlay = document.getElementById('loadingOverlay');
    if (overlay) overlay.style.display = 'none';
}

// Helper: เจน Code ตามวันเวลา
function generateTransactionCode(prefix = "") {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const ss = String(now.getSeconds()).padStart(2, '0');
    return `${prefix}${dd}${mm}${yyyy}${hh}${min}${ss}`;
}

// ฟังก์ชันทดสอบการเชื่อมต่อเบื้องต้น
async function testConnection() {
    const { data, error } = await _supabase.from('User Master').select('count', { count: 'exact', head: true });
    if (error) {
        console.error("Connection Error:", error);
    } else {
        console.log("เชื่อมต่อฐานข้อมูลสำเร็จ!");
    }
}
testConnection();

// ฟังก์ชันอัปเดตเวลา Login ในฐานข้อมูล
async function updateLoginTime(userId) {
    const now = new Date().toLocaleString('th-TH');
    try {
        const { error } = await _supabase
            .from('User Master')
            .update({ login_at: now })
            .eq('id', userId);
        
        if (error) console.error("Update Login Time Error:", error);
    } catch (err) {
        console.error("Failed to update login time:", err);
    }
}

if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value.trim();
        loginBtn.innerText = 'กำลังตรวจสอบ...';
        loginBtn.disabled = true;
        messageDiv.innerText = '';
        try {
            const { data, error } = await _supabase.from('User Master').select('*').eq('user_id', username).single();
            if (error) {
                if (error.code === 'PGRST116') throw new Error('ไม่พบ User ID นี้ในระบบ');
                throw new Error(`ข้อผิดพลาด: ${error.message}`);
            }
            if (String(data.password) === String(password)) {
                if (data.status === false) throw new Error('บัญชีนี้ถูกระงับการใช้งาน');
                currentUser = data;
                localStorage.setItem('wms_user', JSON.stringify(data));
                await updateLoginTime(data.id);
                showDashboard(data);
            } else { throw new Error('รหัสผ่านไม่ถูกต้อง'); }
        } catch (err) { messageDiv.innerText = err.message; } finally { loginBtn.innerText = 'เข้าสู่ระบบ'; loginBtn.disabled = false; }
    });
}

window.onload = async () => {
    initLoading();
    const savedUser = localStorage.getItem('wms_user');
    if (savedUser) {
        currentUser = JSON.parse(savedUser);
        await updateLoginTime(currentUser.id);
        showDashboard(currentUser);
    }
};

function showDashboard(user) {
    document.body.style.display = 'block'; 
    document.body.innerHTML = `
    <div class="bg-shape shape-1"></div>
    <div class="bg-shape shape-2"></div>

    <!-- 1. ปุ่ม 3 ขีด (ลอยอยู่บนสุด) -->
    <div id="menuToggle" class="menu-toggle" onclick="toggleSidebar()">
        <span></span><span></span><span></span>
    </div>

    <!-- 2. พื้นหลังดำจางๆ (Overlay) -->
    <div id="sidebarOverlay" class="sidebar-overlay" onclick="toggleSidebar()"></div>

    <!-- 3. ตัวเมนู (Sidebar) -->
    <div id="sidebar" class="sidebar">
        <div class="logout-top" onclick="logout()">
            <span>🚪</span> ออกจากระบบ
        </div>
        <div class="sidebar-header">
            <h2 class="scrolling-text">Warehouse Management System</h2>
            <p>Bangkok University</p>
        </div>
        <nav>
            <div class="nav-item ${currentView === 'inventory' ? 'active' : ''}" onclick="switchView('inventory')"><span>📦</span> Inventory Master</div>
            <div class="nav-item ${currentView === 'category' ? 'active' : ''}" onclick="switchView('category')"><span>📁</span> Category Master</div>
            <div class="nav-item ${currentView === 'items' ? 'active' : ''}" onclick="switchView('items')"><span>🛠️</span> Item Master</div>
            <div class="nav-item ${currentView === 'transactions' ? 'active' : ''}" onclick="switchView('transactions')"><span>🔄</span> Transaction Master</div>
            ${user.rank === 'Master' ? `<div class="nav-item ${currentView === 'users' ? 'active' : ''}" onclick="switchView('users')"><span>👥</span> User Master</div>` : ''}
            <div class="nav-item ${currentView === 'dashboard' ? 'active' : ''}" onclick="switchView('dashboard')"><span>📊</span> Dashboard</div>
        </nav>
        <div class="sidebar-footer">
            <div class="sidebar-user-info">
                <strong>คุณ ${user.name}</strong>
                <span>สิทธิ์: ${user.rank}</span>
            </div>
        </div>
    </div>

    <!-- 4. เนื้อหาหลัก (Dashboard) -->
    <div class="dashboard-container">
        <div class="dashboard-header">
            <h2 id="viewTitle">📦 Inventory Master</h2>
            <div class="user-info-brief">
                <strong>คุณ ${user.name}</strong>
                <span>สิทธิ์: ${user.rank}</span>
            </div>
        </div>
        <div id="mainContent"></div>
    </div>

    <!-- Modals ต่างๆ -->
    <div id="inventoryModal" class="modal-overlay"></div>
    <div id="userModal" class="modal-overlay"></div>
    <div id="categoryModal" class="modal-overlay"></div>
    <div id="itemModal" class="modal-overlay"></div>
    <div id="transactionModal" class="modal-overlay"></div>

    <!-- Side Popup Dashboard -->
    <div id="popupOverlay" class="popup-overlay" onclick="closeZonePopup()"></div>
    <div id="sidePopup" class="side-popup">
        <div class="side-popup-header">
            <h3 id="popupZoneName">Zone Detail</h3>
            <button class="close-popup-btn" onclick="closeZonePopup()">✕</button>
        </div>
        <div class="side-popup-content" id="popupContent">
            <!-- Content dynamic -->
        </div>
    </div>
    `;
    initLoading();
    renderCurrentView();
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const menuToggle = document.getElementById('menuToggle');
    
    sidebar.classList.toggle('open');
    overlay.classList.toggle('show');
    menuToggle.classList.toggle('active');
}

function switchView(view) {
    currentView = view;
    // ปรับชื่อ Title
    const titles = { 'dashboard': '📊 Dashboard', 'inventory': '📦 Inventory Master', 'category': '📁 Category Master', 'items': '🛠️ Item Master', 'transactions': '🔄 Transaction Master', 'users': '👥 User Master' };
    if (document.getElementById('viewTitle')) {
        document.getElementById('viewTitle').innerHTML = titles[view];
    }

    // อัปเดตสถานะ Active ใน Sidebar
    const navItems = document.querySelectorAll('.nav-item');
    navItems.forEach(item => {
        item.classList.remove('active');
        if (item.getAttribute('onclick').includes(`'${view}'`)) {
            item.classList.add('active');
        }
    });
    
    // ปิดเมนูอัตโนมัติเมื่อเลือกหน้า
    toggleSidebar();
    renderCurrentView();
}

function renderCurrentView() {
    if (currentView === 'dashboard') renderDashboardView();
    else if (currentView === 'inventory') renderInventoryView();
    else if (currentView === 'users') renderUserView();
    else if (currentView === 'category') renderCategoryView();
    else if (currentView === 'items') renderItemView();
    else if (currentView === 'transactions') renderTransactionView();
}

// --- Inventory Master View ---
function renderInventoryView() {
    const mainContent = document.getElementById('mainContent');
    const hasPermission = currentUser.rank === 'Master' || currentUser.rank === 'Admin';
    mainContent.innerHTML = `
        <div class="controls-row">
            <div class="search-filters">
                <input type="text" id="searchZone" class="search-input" placeholder="🔍 ค้นหาด้วย Zone..." oninput="filterInventoryTable()">
                <input type="text" id="searchDesc" class="search-input" placeholder="🔍 ค้นหาด้วย Description..." oninput="filterInventoryTable()">
            </div>
            ${hasPermission ? `<button class="btn-add" onclick="openInventoryModal(null, 'add')"><span>➕</span> Add Inventory</button>` : ''}
        </div>
        <div class="table-wrapper">
            <table>
                <thead><tr><th>ID</th><th>Zone</th><th>Description</th><th>Quantity</th><th>Image</th><th>Status</th><th>Remark</th><th>Actions</th></tr></thead>
                <tbody id="inventoryTableBody"></tbody>
            </table>
        </div>
        <div id="inventoryPagination" class="pagination-container"></div>
    `;
    loadInventoryData(0);
}

async function loadInventoryData(page = 0) {
    currentInventoryPage = page;
    const tableBody = document.getElementById('inventoryTableBody');
    if (!tableBody) return;

    const searchZone = document.getElementById('searchZone')?.value || '';
    const searchDesc = document.getElementById('searchDesc')?.value || '';

    tableBody.innerHTML = '<tr><td colspan="8" style="text-align:center;">กำลังโหลดข้อมูล...</td></tr>';
    try {
        let query = _supabase.from('Inventory Master').select('*', { count: 'exact' });
        
        if (searchZone) query = query.ilike('zone', `%${searchZone}%`);
        if (searchDesc) query = query.ilike('descriprion', `%${searchDesc}%`);

        const { data, error, count } = await query
            .order('id', { ascending: true })
            .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

        if (error) throw error;
        renderInventoryTable(data, count);
    } catch (err) {
        console.error("Error loading data:", err);
        tableBody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:red;">โหลดข้อมูลล้มเหลว</td></tr>';
    }
}

// Helper: เช็คว่ามีการลากเมาส์เลือกตัวหนังสืออยู่หรือไม่
function isTextSelected() {
    const selection = window.getSelection();
    return selection.toString().length > 0;
}

function renderInventoryTable(data, totalCount) {
    const tableBody = document.getElementById('inventoryTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = '';
    
    data.forEach(item => {
        const tr = document.createElement('tr');
        tr.onclick = () => {
            if (!isTextSelected()) openInventoryModal(item, 'view');
        };
        const hasPermission = currentUser.rank === 'Master' || currentUser.rank === 'Admin';
        tr.innerHTML = `
            <td>${item.id}</td><td>${item.zone || '-'}</td><td>${item.descriprion || '-'}</td><td>${item.quantity || 0}</td>
            <td>${item.image ? `<img src="${item.image}" alt="Inventory" style="width: 50px; height: 50px; object-fit: cover; border-radius: 8px;">` : '-'}</td>
            <td><span class="status-badge ${item.active ? 'status-active' : 'status-inactive'}">${item.active ? 'Active' : 'Inactive'}</span></td>
            <td>${item.remark || '-'}</td>
            <td onclick="event.stopPropagation()"><div class="action-icons">${hasPermission ? `<button class="icon-btn edit-icon" onclick="openInventoryModal(${JSON.stringify(item).replace(/"/g, '&quot;')}, 'edit')">✎</button><button class="icon-btn delete-icon" onclick="deleteInventoryItem('${item.id}')">🗑</button>` : '-'}</div></td>
        `;
        tableBody.appendChild(tr);
    });

    renderPagination('inventoryPagination', totalCount, currentInventoryPage, 'loadInventoryData');
}

let inventoryFilterTimeout;
function filterInventoryTable() {
    clearTimeout(inventoryFilterTimeout);
    inventoryFilterTimeout = setTimeout(() => {
        loadInventoryData(0);
    }, 500);
}

function updateImagePreview(url) {
    const container = document.getElementById('imagePreviewContainer');
    if (!container) return;
    if (url && url.trim() !== '') container.innerHTML = `<img src="${url}" style="max-width: 100%; max-height: 250px; border-radius: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); border: 3px solid #fff;">`;
    else container.innerHTML = `<div style="padding: 2rem; background: #f8f9fa; border-radius: 15px; color: #adb5bd; font-size: 0.9rem;">(ไม่มีรูปภาพพรีวิว)</div>`;
}

function openInventoryModal(item, mode) {
    const modal = document.getElementById('inventoryModal');
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>${mode === 'add' ? 'Add New Inventory' : (mode === 'edit' ? 'Edit Inventory' : 'Inventory Detail')}</h3>
                <button class="close-modal-btn" onclick="closeModal('inventoryModal')">✕</button>
            </div>
            <form id="inventoryForm">
                <div class="modal-grid">
                    <div class="form-group full-width" style="text-align: center;"><label>Image Preview</label><div id="imagePreviewContainer" style="margin-top: 10px;">${item && item.image ? `<img src="${item.image}" style="max-width: 100%; max-height: 250px; border-radius: 15px; box-shadow: 0 10px 30px rgba(0,0,0,0.1); border: 3px solid #fff;">` : `<div style="padding: 2rem; background: #f8f9fa; border-radius: 15px; color: #adb5bd; font-size: 0.9rem;">(ไม่มีรูปภาพพรีวิว)</div>`}</div></div>
                    <div class="form-group"><label>ID</label><input type="text" id="inv_id" value="${item ? item.id : ''}" ${mode !== 'add' ? 'disabled' : ''} required></div>
                    <div class="form-group"><label>Zone</label><input type="text" id="inv_zone" value="${item ? (item.zone || '') : ''}" ${mode === 'view' ? 'disabled' : ''}></div>
                    <div class="form-group"><label>Category ID</label><input type="text" id="inv_category" value="${item ? (item.id_category || '') : ''}" ${mode === 'view' ? 'disabled' : ''}></div>
                    <div class="form-group full-width"><label>Description</label><input type="text" id="inv_description" value="${item ? (item.descriprion || '') : ''}" ${mode === 'view' ? 'disabled' : ''} required></div>
                    <div class="form-group"><label>Quantity</label><input type="number" id="inv_quantity" value="${item ? (item.quantity || 0) : 0}" ${mode === 'view' ? 'disabled' : ''}></div>
                    <div class="form-group"><label>Status</label><select id="inv_active" ${mode === 'view' ? 'disabled' : ''}><option value="true" ${item && item.active ? 'selected' : ''}>Active</option><option value="false" ${item && !item.active ? 'selected' : ''}>Inactive</option></select></div>
                    <div class="form-group full-width"><label>Image URL</label><input type="text" id="inv_image" value="${item ? (item.image || '') : ''}" ${mode === 'view' ? 'disabled' : ''} placeholder="https://example.com/image.jpg" oninput="updateImagePreview(this.value)"></div>
                    <div class="form-group full-width"><label>Remark</label><textarea id="inv_remark" rows="2" ${mode === 'view' ? 'disabled' : ''}>${item ? (item.remark || '') : ''}</textarea></div>
                    <div class="form-group"><label>Owner</label><input type="text" id="inv_owner" value="${item ? (item.owner || '') : ''}" ${mode === 'view' ? 'disabled' : ''}></div>
                    <div class="form-group"><label>Created By</label><input type="text" value="${item ? (item.create_id || '') : currentUser.id}" disabled></div>
                    <div class="form-group"><label>Created At</label><input type="text" value="${item ? (item.created_at || '') : new Date().toLocaleString('th-TH')}" disabled></div>
                    <div class="form-group"><label>Last Edited By</label><input type="text" value="${mode === 'edit' ? currentUser.id : (item ? (item.edit_id || '') : '')}" disabled></div>
                    <div class="form-group"><label>Last Edited At</label><input type="text" value="${mode === 'edit' ? new Date().toLocaleString('th-TH') : (item ? (item.edit_at || '') : '')}" disabled></div>
                </div>
                <div class="modal-footer">${mode === 'view' ? `<button type="button" class="btn-cancel" onclick="closeModal('inventoryModal')">ปิดหน้าต่าง</button>` : `<button type="button" class="btn-cancel" onclick="closeModal('inventoryModal')">ยกเลิก</button><button type="button" class="btn-save" onclick="saveInventoryItem('${mode}')">${mode === 'add' ? 'บันทึกรายการใหม่' : 'บันทึกการแก้ไข'}</button>`}</div>
            </form>
        </div>
    `;
}

async function saveInventoryItem(mode) {
    showLoading();
    const id = document.getElementById('inv_id').value;
    const itemData = { zone: document.getElementById('inv_zone').value, id_category: document.getElementById('inv_category').value, descriprion: document.getElementById('inv_description').value, quantity: parseInt(document.getElementById('inv_quantity').value), image: document.getElementById('inv_image').value, active: document.getElementById('inv_active').value === 'true', remark: document.getElementById('inv_remark').value, owner: document.getElementById('inv_owner').value, edit_id: currentUser.id, edit_at: new Date().toLocaleString('th-TH') };
    try {
        if (mode === 'add') { itemData.id = id; itemData.create_id = currentUser.id; itemData.created_at = new Date().toLocaleString('th-TH'); const { error } = await _supabase.from('Inventory Master').insert([itemData]); if (error) throw error; alert('เพิ่มรายการใหม่สำเร็จ!'); }
        else { const { error } = await _supabase.from('Inventory Master').update(itemData).eq('id', id); if (error) throw error; alert('แก้ไขข้อมูลสำเร็จ!'); }
        closeModal('inventoryModal'); loadInventoryData();
    } catch (err) { alert('เกิดข้อผิดพลาด: ' + err.message); } finally { hideLoading(); }
}

async function deleteInventoryItem(id) {
    if (!confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบรายการ ID: ${id}?`)) return;
    showLoading();
    try { const { error } = await _supabase.from('Inventory Master').delete().eq('id', id); if (error) throw error; alert('ลบข้อมูลสำเร็จ!'); loadInventoryData(); }
    catch (err) { alert('ลบข้อมูลไม่สำเร็จ: ' + err.message); } finally { hideLoading(); }
}

// --- Item Master View ---
function renderItemView() {
    const mainContent = document.getElementById('mainContent');
    const hasPermission = currentUser.rank === 'Master' || currentUser.rank === 'Admin';
    mainContent.innerHTML = `
        <div class="controls-row">
            <div class="search-filters">
                <input type="text" id="searchAssetInventory" class="search-input" placeholder="🔍 Asset or Inventory Code..." oninput="filterItemTable()">
                <input type="text" id="searchItemDescCat" class="search-input" placeholder="🔍 Desc or Category ID..." oninput="filterItemTable()">
            </div>
            ${hasPermission ? `<button class="btn-add" onclick="openItemModal(null, 'add')"><span>➕</span> Add Item</button>` : ''}
        </div>
        <div class="table-wrapper">
            <table>
                <thead><tr><th>Asset Code</th><th>Inventory Code</th><th>Category ID</th><th>Description</th><th>Location Zone</th><th>Status</th>${hasPermission ? '<th>Actions</th>' : ''}</tr></thead>
                <tbody id="itemTableBody"></tbody>
            </table>
        </div>
        <div id="itemPagination" class="pagination-container"></div>
    `;
    loadItemData(0);
}

async function loadItemData(page = 0) {
    currentItemPage = page;
    const tableBody = document.getElementById('itemTableBody');
    if (!tableBody) return;

    const searchCode = document.getElementById('searchAssetInventory')?.value || '';
    const searchDescCat = document.getElementById('searchItemDescCat')?.value || '';

    tableBody.innerHTML = '<tr><td colspan="7" style="text-align:center;">กำลังโหลดข้อมูล...</td></tr>';
    try {
        let query = _supabase.from('Item Master').select('*', { count: 'exact' });
        
        if (searchCode) {
            query = query.or(`asset_code.ilike.%${searchCode}%,inventory_code.ilike.%${searchCode}%`);
        }
        if (searchDescCat) {
            query = query.or(`description.ilike.%${searchDescCat}%,category_id.ilike.%${searchDescCat}%`);
        }

        const { data, error, count } = await query
            .order('asset_code', { ascending: true })
            .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

        if (error) throw error;
        renderItemTable(data, count);
    } catch (err) { console.error("Error loading item data:", err); tableBody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:red;">โหลดข้อมูลล้มเหลว</td></tr>'; }
}

function renderItemTable(data, totalCount) {
    const tableBody = document.getElementById('itemTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = '';
    const hasPermission = currentUser.rank === 'Master' || currentUser.rank === 'Admin';
    
    data.forEach(item => {
        const tr = document.createElement('tr');
        tr.onclick = () => {
            if (!isTextSelected()) openItemModal(item, 'view');
        };
        tr.innerHTML = `
            <td>${item.asset_code}</td><td>${item.inventory_code || '-'}</td><td>${item.category_id || '-'}</td><td>${item.description || '-'}</td><td>${item.location_zone || '-'}</td><td><span class="status-badge ${item.active ? 'status-active' : 'status-inactive'}">${item.active ? 'Active' : 'Inactive'}</span></td>
            ${hasPermission ? `<td onclick="event.stopPropagation()"><div class="action-icons"><button class="icon-btn edit-icon" onclick="openItemModal(${JSON.stringify(item).replace(/"/g, '&quot;')}, 'edit')">✎</button><button class="icon-btn delete-icon" onclick="deleteItemRecord('${item.asset_code}')">🗑</button></div></td>` : ''}
        `;
        tableBody.appendChild(tr);
    });

    renderPagination('itemPagination', totalCount, currentItemPage, 'loadItemData');
}

let itemFilterTimeout;
function filterItemTable() {
    clearTimeout(itemFilterTimeout);
    itemFilterTimeout = setTimeout(() => {
        loadItemData(0);
    }, 500);
}

function openItemModal(item, mode) {
    const modal = document.getElementById('itemModal');
    modal.style.display = 'flex';
    const hasPermission = currentUser.rank === 'Master' || currentUser.rank === 'Admin';
    const isEditMode = (mode === 'add' || mode === 'edit') && hasPermission;
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>${mode === 'add' ? 'Add New Item' : (mode === 'edit' ? 'Edit Item' : 'Item Detail')}</h3>
                <button class="close-modal-btn" onclick="closeModal('itemModal')">✕</button>
            </div>
            <form id="itemForm">
                <div class="modal-grid">
                    <div class="form-group"><label>Asset Code</label><input type="text" id="itm_asset" value="${item ? item.asset_code : ''}" ${mode !== 'add' ? 'disabled' : ''} required></div>
                    <div class="form-group"><label>Inventory Code</label><input type="text" id="itm_inv" value="${item ? (item.inventory_code || '') : ''}" ${!isEditMode ? 'disabled' : ''}></div>
                    <div class="form-group"><label>Category ID</label><input type="text" id="itm_cat" value="${item ? (item.category_id || '') : ''}" ${!isEditMode ? 'disabled' : ''}></div>
                    <div class="form-group full-width"><label>Description</label><input type="text" id="itm_desc" value="${item ? (item.description || '') : ''}" ${!isEditMode ? 'disabled' : ''} required></div>
                    <div class="form-group"><label>Location Zone</label><input type="text" id="itm_zone" value="${item ? (item.location_zone || '') : ''}" ${!isEditMode ? 'disabled' : ''}></div>
                    <div class="form-group"><label>Status</label><select id="itm_active" ${!isEditMode ? 'disabled' : ''}><option value="true" ${item && item.active ? 'selected' : ''}>Active</option><option value="false" ${item && !item.active ? 'selected' : ''}>Inactive</option></select></div>
                    <div class="form-group"><label>Created By (ID)</label><input type="text" value="${item ? (item.create_id || '') : currentUser.id}" disabled></div>
                    <div class="form-group"><label>Created At</label><input type="text" value="${item ? (item.created_at || '') : new Date().toLocaleString('th-TH')}" disabled></div>
                    <div class="form-group"><label>Last Edited By (ID)</label><input type="text" value="${mode === 'edit' ? currentUser.id : (item ? (item.edit_id || '') : '')}" disabled></div>
                    <div class="form-group"><label>Last Edited At</label><input type="text" value="${mode === 'edit' ? new Date().toLocaleString('th-TH') : (item ? (item.edit_at || '') : '')}" disabled></div>
                </div>
                <div class="modal-footer">${!isEditMode ? `<button type="button" class="btn-cancel" onclick="closeModal('itemModal')">ปิดหน้าต่าง</button>` : `<button type="button" class="btn-cancel" onclick="closeModal('itemModal')">ยกเลิก</button><button type="button" class="btn-save" onclick="saveItemRecord('${mode}')">${mode === 'add' ? 'บันทึกไอเทมใหม่' : 'บันทึกการแก้ไข'}</button>`}</div>
            </form>
        </div>
    `;
}

async function saveItemRecord(mode) {
    showLoading();
    const assetCode = document.getElementById('itm_asset').value;
    const itemData = { inventory_code: document.getElementById('itm_inv').value, category_id: document.getElementById('itm_cat').value, description: document.getElementById('itm_desc').value, location_zone: document.getElementById('itm_zone').value, active: document.getElementById('itm_active').value === 'true', edit_id: currentUser.id, edit_at: new Date().toLocaleString('th-TH') };
    try {
        if (mode === 'add') {
            itemData.asset_code = assetCode;
            itemData.create_id = currentUser.id;
            itemData.created_at = new Date().toLocaleString('th-TH');
            const { error } = await _supabase.from('Item Master').insert([itemData]);
            if (error) throw error;
            
            // Sync with Inventory Master
            if (itemData.location_zone && itemData.description) {
                await updateInventoryStock(itemData.location_zone, itemData.description, 1, itemData.category_id);
            }
            
            alert('เพิ่มไอเทมใหม่สำเร็จ!');
        } else {
            const { error } = await _supabase.from('Item Master').update(itemData).eq('asset_code', assetCode);
            if (error) throw error;
            alert('แก้ไขไอเทมสำเร็จ!');
        }
        closeModal('itemModal'); loadItemData();
    } catch (err) { alert('เกิดข้อผิดพลาด: ' + err.message); } finally { hideLoading(); }
}

async function deleteItemRecord(assetCode) {
    if (!confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบไอเทม Asset Code: ${assetCode}?`)) return;
    showLoading();
    try {
        // Fetch item details before deletion to update inventory
        const { data: item, error: fetchError } = await _supabase.from('Item Master').select('location_zone, description, category_id').eq('asset_code', assetCode).single();
        if (fetchError) throw fetchError;

        const { error } = await _supabase.from('Item Master').delete().eq('asset_code', assetCode);
        if (error) throw error;

        // Sync with Inventory Master (subtract 1)
        if (item && item.location_zone && item.description) {
            await updateInventoryStock(item.location_zone, item.description, -1, item.category_id);
        }

        alert('ลบไอเทมสำเร็จ!');
        loadItemData();
    } catch (err) { alert('ลบไอเทมไม่สำเร็จ: ' + err.message); } finally { hideLoading(); }
}

// --- Category Master View ---
function renderCategoryView() {
    const mainContent = document.getElementById('mainContent');
    const hasPermission = currentUser.rank === 'Master' || currentUser.rank === 'Admin';
    mainContent.innerHTML = `
        <div class="controls-row">
            <div class="search-filters">
                <input type="text" id="searchCatId" class="search-input" placeholder="🔍 ค้นหาด้วย ID..." oninput="filterCategoryTable()">
                <input type="text" id="searchCatName" class="search-input" placeholder="🔍 ค้นหาด้วยชื่อหมวดหมู่..." oninput="filterCategoryTable()">
            </div>
            ${hasPermission ? `<button class="btn-add" onclick="openCategoryModal(null, 'add')"><span>➕</span> Add Category</button>` : ''}
        </div>
        <div class="table-wrapper">
            <table>
                <thead><tr><th>ID</th><th>Category Name</th>${hasPermission ? '<th>Actions</th>' : ''}</tr></thead>
                <tbody id="categoryTableBody"></tbody>
            </table>
        </div>
        <div id="categoryPagination" class="pagination-container"></div>
    `;
    loadCategoryData(0);
}

async function loadCategoryData(page = 0) {
    currentCategoryPage = page;
    const tableBody = document.getElementById('categoryTableBody');
    if (!tableBody) return;

    const searchId = document.getElementById('searchCatId')?.value || '';
    const searchName = document.getElementById('searchCatName')?.value || '';

    tableBody.innerHTML = '<tr><td colspan="3" style="text-align:center;">กำลังโหลดข้อมูล...</td></tr>';
    try {
        let query = _supabase.from('Category Master').select('*', { count: 'exact' });
        
        if (searchId) query = query.ilike('id', `%${searchId}%`);
        if (searchName) query = query.ilike('category_name', `%${searchName}%`);

        const { data, error, count } = await query
            .order('id', { ascending: true })
            .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

        if (error) throw error;
        renderCategoryTable(data, count);
    } catch (err) { console.error("Error loading category data:", err); tableBody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:red;">โหลดข้อมูลล้มเหลว</td></tr>'; }
}

function renderCategoryTable(data, totalCount) {
    const tableBody = document.getElementById('categoryTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = '';
    const hasPermission = currentUser.rank === 'Master' || currentUser.rank === 'Admin';
    
    data.forEach(item => {
        const tr = document.createElement('tr');
        tr.onclick = () => {
            if (!isTextSelected()) openCategoryModal(item, 'view');
        };
        tr.innerHTML = `<td>${item.id}</td><td>${item.category_name || '-'}</td>
            ${hasPermission ? `<td onclick="event.stopPropagation()"><div class="action-icons"><button class="icon-btn edit-icon" onclick="openCategoryModal(${JSON.stringify(item).replace(/"/g, '&quot;')}, 'edit')">✎</button><button class="icon-btn delete-icon" onclick="deleteCategoryItem('${item.id}')">🗑</button></div></td>` : ''}
        `;
        tableBody.appendChild(tr);
    });

    renderPagination('categoryPagination', totalCount, currentCategoryPage, 'loadCategoryData');
}

let categoryFilterTimeout;
function filterCategoryTable() {
    clearTimeout(categoryFilterTimeout);
    categoryFilterTimeout = setTimeout(() => {
        loadCategoryData(0);
    }, 500);
}

function openCategoryModal(item, mode) {
    const modal = document.getElementById('categoryModal');
    modal.style.display = 'flex';
    const hasPermission = currentUser.rank === 'Master' || currentUser.rank === 'Admin';
    const isEditMode = (mode === 'add' || mode === 'edit') && hasPermission;
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>${mode === 'add' ? 'Add New Category' : (mode === 'edit' ? 'Edit Category' : 'Category Detail')}</h3>
                <button class="close-modal-btn" onclick="closeModal('categoryModal')">✕</button>
            </div>
            <form id="categoryForm">
                <div class="modal-grid">
                    <div class="form-group"><label>ID</label><input type="text" id="cat_id" value="${item ? item.id : ''}" ${mode !== 'add' ? 'disabled' : ''} required></div>
                    <div class="form-group"><label>Category Name</label><input type="text" id="cat_name" value="${item ? (item.category_name || '') : ''}" ${!isEditMode ? 'disabled' : ''} required></div>
                    <div class="form-group"><label>Created By (ID)</label><input type="text" value="${item ? (item.create_id || '') : currentUser.id}" disabled></div>
                    <div class="form-group"><label>Created At</label><input type="text" value="${item ? (item.created_at || '') : new Date().toLocaleString('th-TH')}" disabled></div>
                    <div class="form-group"><label>Last Edited By (ID)</label><input type="text" value="${mode === 'edit' ? currentUser.id : (item ? (item.edit_id || '') : '')}" disabled></div>
                    <div class="form-group"><label>Last Edited At</label><input type="text" value="${mode === 'edit' ? new Date().toLocaleString('th-TH') : (item ? (item.edit_at || '') : '')}" disabled></div>
                </div>
                <div class="modal-footer">${!isEditMode ? `<button type="button" class="btn-cancel" onclick="closeModal('categoryModal')">ปิดหน้าต่าง</button>` : `<button type="button" class="btn-cancel" onclick="closeModal('categoryModal')">ยกเลิก</button><button type="button" class="btn-save" onclick="saveCategoryItem('${mode}')">${mode === 'add' ? 'บันทึกหมวดหมู่ใหม่' : 'บันทึกการแก้ไข'}</button>`}</div>
            </form>
        </div>
    `;
}

async function saveCategoryItem(mode) {
    showLoading();
    const id = document.getElementById('cat_id').value;
    const catData = { category_name: document.getElementById('cat_name').value, edit_id: currentUser.id, edit_at: new Date().toLocaleString('th-TH') };
    try {
        if (mode === 'add') { catData.id = id; catData.create_id = currentUser.id; catData.created_at = new Date().toLocaleString('th-TH'); const { error } = await _supabase.from('Category Master').insert([catData]); if (error) throw error; alert('เพิ่มหมวดหมู่ใหม่สำเร็จ!'); }
        else { const { error } = await _supabase.from('Category Master').update(catData).eq('id', id); if (error) throw error; alert('แก้ไขหมวดหมู่สำเร็จ!'); }
        closeModal('categoryModal'); loadCategoryData();
    } catch (err) { alert('เกิดข้อผิดพลาด: ' + err.message); } finally { hideLoading(); }
}

async function deleteCategoryItem(id) {
    if (!confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบหมวดหมู่ ID: ${id}?`)) return;
    showLoading();
    try { const { error } = await _supabase.from('Category Master').delete().eq('id', id); if (error) throw error; alert('ลบหมวดหมู่สำเร็จ!'); loadCategoryData(); }
    catch (err) { alert('ลบหมวดหมู่ไม่สำเร็จ: ' + err.message); } finally { hideLoading(); }
}

// --- Transection Master View ---
function renderTransactionView() {
    const mainContent = document.getElementById('mainContent');
    const hasPermission = currentUser.rank === 'Master' || currentUser.rank === 'Admin';
    mainContent.innerHTML = `
        <div class="controls-row">
            <div class="search-filters">
                <input type="text" id="searchTransCode" class="search-input" placeholder="🔍 Search Code..." oninput="filterTransactionTable()">
                <input type="text" id="searchTransAsset" class="search-input" placeholder="🔍 Asset or Inventory Code..." oninput="filterTransactionTable()">
            </div>
            <div style="display: flex; gap: 10px;">
                ${hasPermission ? `<button class="btn-add" style="background: linear-gradient(135deg, #0984e3 0%, #3a7bd5 100%);" onclick="openTransactionModal(null, 'transfer')"><span>🔄</span> ย้ายของ</button><button class="btn-add" onclick="openTransactionModal(null, 'add')"><span>➕</span> Add Transection</button>` : ''}
            </div>
        </div>
        <div class="table-wrapper">
            <table>
                <thead><tr><th>ID</th><th>Code</th><th>Category ID</th><th>Asset Code</th><th>Inventory Code</th><th>Description</th><th>Type</th><th>To Location</th><th>Status</th>${hasPermission ? '<th>Actions</th>' : ''}</tr></thead>
                <tbody id="transactionTableBody"></tbody>
            </table>
        </div>
        <div id="transactionPagination" class="pagination-container"></div>
    `;
    loadTransactionData(0);
}

async function loadTransactionData(page = 0) {
    currentTransactionPage = page;
    const tableBody = document.getElementById('transactionTableBody');
    if (!tableBody) return;

    const searchCode = document.getElementById('searchTransCode')?.value || '';
    const searchAsset = document.getElementById('searchTransAsset')?.value || '';

    tableBody.innerHTML = '<tr><td colspan="10" style="text-align:center;">กำลังโหลดข้อมูล...</td></tr>';
    try {
        let query = _supabase.from('Transection Inventory').select('*', { count: 'exact' });
        
        if (searchCode) query = query.ilike('code', `%${searchCode}%`);
        if (searchAsset) {
            query = query.or(`asset_code.ilike.%${searchAsset}%,inventory_code.ilike.%${searchAsset}%`);
        }

        const { data, error, count } = await query
            .order('id', { ascending: false })
            .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

        if (error) throw error;
        renderTransactionTable(data, count);
    } catch (err) { console.error("Error loading transaction data:", err); tableBody.innerHTML = '<tr><td colspan="10" style="text-align:center; color:red;">โหลดข้อมูลล้มเหลว</td></tr>'; }
}

function renderTransactionTable(data, totalCount) {
    const tableBody = document.getElementById('transactionTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = '';
    const hasPermission = currentUser.rank === 'Master' || currentUser.rank === 'Admin';
    
    data.forEach(item => {
        const tr = document.createElement('tr');
        tr.onclick = () => {
            if (!isTextSelected()) openTransactionModal(item, 'view');
        };
        tr.innerHTML = `
            <td>${item.id}</td><td><strong>${item.code || '-'}</strong></td><td>${item.id_category || '-'}</td><td>${item.asset_code || '-'}</td><td>${item.inventory_code || '-'}</td><td>${item.description || '-'}</td><td><span class="status-badge ${item.movement_type === 'ยืม' ? 'status-active' : (item.movement_type === 'จัดสรร' ? 'status-inactive' : (item.movement_type === 'ย้ายของ' ? 'status-active' : ''))}">${item.movement_type || '-'}</span></td><td>${item.to_location || '-'}</td><td>${item.status || '-'}</td>
            ${hasPermission ? `<td onclick="event.stopPropagation()"><div class="action-icons"><button class="icon-btn edit-icon" onclick="openTransactionModal(${JSON.stringify(item).replace(/"/g, '&quot;')}, 'edit')">✎</button><button class="icon-btn delete-icon" onclick="deleteTransactionRecord('${item.id}')">🗑</button></div></td>` : ''}
        `;
        tableBody.appendChild(tr);
    });

    renderPagination('transactionPagination', totalCount, currentTransactionPage, 'loadTransactionData');
}

let transactionFilterTimeout;
function filterTransactionTable() {
    clearTimeout(transactionFilterTimeout);
    transactionFilterTimeout = setTimeout(() => {
        loadTransactionData(0);
    }, 500);
}

function handleQuantityChange(qty) {
    const container = document.getElementById('transactionItemsContainer');
    if (!container) return;
    container.innerHTML = '';
    const num = parseInt(qty) || 0;
    for(let i=0; i<num; i++) { addTransactionItemRow(i + 1); }
}

function addTransactionItemRow(index) {
    const container = document.getElementById('transactionItemsContainer');
    const newRow = document.createElement('div');
    newRow.className = 'transaction-item-row';
    newRow.style = 'background: #f8f9fa; padding: 15px; border-radius: 12px; margin-bottom: 10px; border-left: 4px solid #00d2ff;';
    newRow.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;"><strong>รายการที่ ${index}</strong></div>
        <div class="modal-grid">
            <div class="form-group"><label>Category ID</label><input type="text" class="itm-id-cat" disabled required></div>
            <div class="form-group"><label>Category Name</label><input type="text" class="itm-cat-name" disabled></div>
            <div class="form-group"><label>Asset Code</label><input type="text" class="itm-asset" onblur="lookupItemMaster(this, 'asset')" required></div>
            <div class="form-group"><label>Inventory Code</label><input type="text" class="itm-inv" onblur="lookupItemMaster(this, 'inv')" required></div>
            <div class="form-group full-width"><label>Description</label><input type="text" class="itm-desc" disabled required></div>
        </div>
    `;
    container.appendChild(newRow);
}

async function lookupItemMaster(input, type) {
    const row = input.closest('.transaction-item-row') || input.closest('.modal-grid');
    if (!row) return;

    const value = input.value.trim();
    if (!value) return;

    const assetInput = row.querySelector('.itm-asset') || row.querySelector('#edit_itm_asset');
    const invInput = row.querySelector('.itm-inv') || row.querySelector('#edit_itm_inv');
    const idCatInput = row.querySelector('.itm-id-cat') || row.querySelector('#edit_itm_id_cat');
    const catNameInput = row.querySelector('.itm-cat-name') || row.querySelector('#edit_itm_cat_name');
    const descInput = row.querySelector('.itm-desc') || row.querySelector('#edit_itm_desc');

    try {
        let query = _supabase.from('Item Master').select('*');
        if (type === 'asset') query = query.eq('asset_code', value);
        else query = query.eq('inventory_code', value);

        const { data, error } = await query.single();
        if (error) {
            if (error.code === 'PGRST116') {
                console.warn('Item not found in Item Master');
            } else {
                throw error;
            }
            return;
        }

        if (data) {
            if (idCatInput) idCatInput.value = data.category_id || '';
            if (descInput) descInput.value = data.description || '';
            if (type === 'asset') {
                if (invInput) invInput.value = data.inventory_code || '';
            } else {
                if (assetInput) assetInput.value = data.asset_code || '';
            }

            // Fetch category name
            if (data.category_id && catNameInput) {
                const { data: catData } = await _supabase.from('Category Master').select('category_name').eq('id', data.category_id).single();
                if (catData) catNameInput.value = catData.category_name || '';
            }
        }
    } catch (err) {
        console.error('Error looking up item:', err);
    }
}

async function openTransactionModal(item, mode) {
    editingTransactionItem = item;
    const modal = document.getElementById('transactionModal');
    modal.style.display = 'flex';
    const hasPermission = currentUser.rank === 'Master' || currentUser.rank === 'Admin';
    const isEditMode = (mode === 'add' || mode === 'edit' || mode === 'transfer') && hasPermission;
    let sameCodeItems = [];
    if (item && item.code) { const { data } = await _supabase.from('Transection Inventory').select('*').eq('code', item.code); sameCodeItems = data || []; }
    
    // Auto-generate code for new transactions
    let autoCode = "";
    if (mode === 'add') autoCode = generateTransactionCode();
    else if (mode === 'transfer') autoCode = generateTransactionCode("M");

    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>${mode === 'add' ? 'Add New Transaction' : (mode === 'transfer' ? '📦 ย้ายของ (Transfer)' : (mode === 'edit' ? 'Edit Item' : 'Transaction Detail'))}</h3>
                <button class="close-modal-btn" onclick="closeModal('transactionModal')">✕</button>
            </div>
            <form id="transactionForm">
                <div class="modal-grid" style="background: rgba(52, 152, 219, 0.05); padding: 20px; border-radius: 20px; margin-bottom: 25px;">
                    <div class="form-group"><label>Transaction Code</label><input type="text" id="tr_code" value="${item ? (item.code || '') : autoCode}" disabled required></div>
                    <div class="form-group">
                        <label>Movement Type</label>
                        <select id="tr_type" ${(!isEditMode || mode === 'transfer') ? 'disabled' : ''}>
                            <option value="ยืม" ${item && item.movement_type === 'ยืม' ? 'selected' : ''}>ยืม</option>
                            <option value="จัดสรร" ${item && item.movement_type === 'จัดสรร' ? 'selected' : ''}>จัดสรร</option>
                            <option value="ตัดจำหน่าย" ${item && item.movement_type === 'ตัดจำหน่าย' ? 'selected' : ''}>ตัดจำหน่าย</option>
                            <option value="ย้ายของ" ${(mode === 'transfer' || (item && item.movement_type === 'ย้ายของ')) ? 'selected' : ''}>ย้ายของ</option>
                        </select>
                    </div>
                    <div class="form-group"><label>From Zone</label><input type="text" id="tr_from_zone" value="${item ? (item.from_zone || '') : ''}" ${!isEditMode ? 'disabled' : ''}></div>
                    <div class="form-group"><label>To Location (โซนใหม่)</label><input type="text" id="tr_location" value="${item ? (item.to_location || '') : ''}" ${!isEditMode ? 'disabled' : ''}></div>
                    <div class="form-group">
                        <label>Status</label>
                        <select id="tr_status" ${(!isEditMode || mode === 'transfer') ? 'disabled' : ''}>
                            <option value="กำลังยืม" ${item && item.status === 'กำลังยืม' ? 'selected' : ''}>กำลังยืม</option>
                            <option value="คืนของแล้ว" ${item && item.status === 'คืนของแล้ว' ? 'selected' : ''}>คืนของแล้ว</option>
                            <option value="จัดสรรอยู่" ${item && item.status === 'จัดสรรอยู่' ? 'selected' : ''}>จัดสรรอยู่</option>
                            <option value="ตัดจำหน่าย" ${item && item.status === 'ตัดจำหน่าย' ? 'selected' : ''}>ตัดจำหน่าย</option>
                            <option value="ย้ายของ" ${(mode === 'transfer' || (item && item.status === 'ย้ายของ')) ? 'selected' : ''}>ย้ายของ</option>
                        </select>
                    </div>
                    ${mode === 'add' || mode === 'transfer' ? `<div class="form-group"><label>Quantity (จำนวนรายการ)</label><input type="number" id="tr_qty" value="1" min="1" oninput="handleQuantityChange(this.value)"></div>` : ''}
                    
                    ${mode !== 'transfer' && (!item || item.movement_type !== 'ย้ายของ') ? `
                    <div class="form-group"><label>Name Lender (ผู้ให้)</label><input type="text" id="tr_lender" value="${item ? (item.name_lender || '') : ''}" ${!isEditMode ? 'disabled' : ''}></div>
                    <div class="form-group"><label>Name Borrower (ผู้รับ)</label><input type="text" id="tr_borrower" value="${item ? (item.name_borrower || '') : ''}" ${!isEditMode ? 'disabled' : ''}></div>
                    <div class="form-group"><label>Lending Date</label><input type="datetime-local" id="tr_lender_date" value="${item && item.lending_date ? item.lending_date.slice(0,16) : ''}" ${!isEditMode ? 'disabled' : ''}></div>
                    <div class="form-group"><label>Date Returned</label><input type="datetime-local" id="tr_return_date" value="${item && item.date_returned ? item.date_returned.slice(0,16) : ''}" ${!isEditMode ? 'disabled' : ''}></div>
                    ` : ''}
                    
                    <div class="form-group full-width"><label>Remark</label><textarea id="tr_remark" rows="2" ${!isEditMode ? 'disabled' : ''}>${item ? (item.remark || '') : ''}</textarea></div>
                    ${currentUser.rank === 'Master' ? `
                    <div class="form-group"><label>Created By (ID)</label><input type="text" value="${item ? (item.create_id || '') : currentUser.id}" disabled></div>
                    <div class="form-group"><label>Created At</label><input type="text" value="${item ? (item.created_at || '') : new Date().toLocaleString('th-TH')}" disabled></div>
                    <div class="form-group"><label>Last Edited By (ID)</label><input type="text" value="${mode === 'edit' ? currentUser.id : (item ? (item.edit_id || '') : '')}" disabled></div>
                    <div class="form-group"><label>Last Edited At</label><input type="text" value="${mode === 'edit' ? new Date().toLocaleString('th-TH') : (item ? (item.edit_at || '') : '')}" disabled></div>
                    ` : ''}
                </div>
                <div id="itemSelectionArea">
                    <h4 style="margin-bottom: 15px; color: #2d3436;">📦 รายการสิ่งของใน Transaction นี้</h4>
                    ${mode === 'add' || mode === 'transfer' ? `<div id="transactionItemsContainer"></div>` : `
                        <div class="table-wrapper" style="margin-bottom: 20px;">
                            <table style="font-size: 0.85rem;">
                                <thead><tr><th>Asset Code</th><th>Inventory Code</th><th>Description</th>${mode === 'edit' ? '<th>Action</th>' : ''}</tr></thead>
                                <tbody>${sameCodeItems.map(row => `<tr style="${row.id === (item ? item.id : null) ? 'background: rgba(52, 152, 219, 0.1);' : ''}"><td>${row.asset_code}</td><td>${row.inventory_code}</td><td>${row.description}</td>${mode === 'edit' ? `<td><button type="button" class="icon-btn delete-icon" onclick="deleteTransactionRecord('${row.id}')">🗑</button></td>` : ''}</tr>`).join('')}</tbody>
                            </table>
                        </div>
                        ${mode === 'edit' ? `<div id="editSingleItemFields" style="background: #fff; padding: 15px; border: 1px solid #eee; border-radius: 12px;"><p style="font-weight: 600; margin-bottom: 10px;">แก้ไขรายการที่เลือก (${item.asset_code})</p><div class="modal-grid">
                            <div class="form-group"><label>Category ID</label><input type="text" id="edit_itm_id_cat" value="${item.id_category || ''}" disabled></div>
                            <div class="form-group"><label>Category Name</label><input type="text" id="edit_itm_cat_name" value="${item.category || ''}" disabled></div>
                            <div class="form-group"><label>Asset Code</label><input type="text" id="edit_itm_asset" value="${item.asset_code || ''}" onblur="lookupItemMaster(this, 'asset')"></div>
                            <div class="form-group"><label>Inventory Code</label><input type="text" id="edit_itm_inv" value="${item.inventory_code || ''}" onblur="lookupItemMaster(this, 'inv')"></div>
                            <div class="form-group full-width"><label>Description</label><input type="text" id="edit_itm_desc" value="${item.description || ''}" disabled></div>
                        </div></div>` : ''}
                    `}
                </div>
                <div class="modal-footer">${!isEditMode ? `<button type="button" class="btn-cancel" onclick="closeModal('transactionModal')">ปิดหน้าต่าง</button>` : `<button type="button" class="btn-cancel" onclick="closeModal('transactionModal')">ยกเลิก</button><button type="button" class="btn-save" onclick="saveTransactionRecord('${mode}')">บันทึกข้อมูล</button>`}</div>
            </form>
        </div>
    `;
    if (mode === 'add' || mode === 'transfer') {
        handleQuantityChange(1);
        if (mode === 'transfer') {
            const trType = document.getElementById('tr_type');
            const trStatus = document.getElementById('tr_status');
            if (trType) trType.value = 'ย้ายของ';
            if (trStatus) trStatus.value = 'ย้ายของ';
        }
    }
}

// Helper to update Item Master Status/Zone
async function updateItemMasterStatus(assetCode, inventoryCode, isActive, newZone = null) {
    try {
        const updateData = { active: isActive };
        if (newZone) updateData.location_zone = newZone;
        if (assetCode) await _supabase.from('Item Master').update(updateData).eq('asset_code', assetCode);
        if (inventoryCode) await _supabase.from('Item Master').update(updateData).eq('inventory_code', inventoryCode);
    } catch (err) { console.error("Failed to sync Item Master:", err); }
}

// Helper to update Inventory Master Quantity (With Auto-Create by Zone & Description)
async function updateInventoryStock(zone, description, change, categoryId = null, imageUrl = null, forceDeleteIfZero = false) {
    if (!zone || !description) return;
    try {
        const { data, error } = await _supabase.from('Inventory Master').select('*').eq('zone', zone).eq('descriprion', description).single();
        if (error && error.code === 'PGRST116') {
            if (change > 0) {
                const newInventory = { zone: zone, descriprion: description, quantity: change, active: true, id_category: categoryId, image: imageUrl, create_id: currentUser.id, created_at: new Date().toLocaleString('th-TH') };
                await _supabase.from('Inventory Master').insert([newInventory]);
            }
        } else if (data) {
            const newQty = (data.quantity || 0) + change;
            if (forceDeleteIfZero && newQty <= 0) {
                await _supabase.from('Inventory Master').delete().eq('id', data.id);
            } else {
                const updateData = { quantity: Math.max(0, newQty) };
                if (imageUrl && !data.image) updateData.image = imageUrl;
                await _supabase.from('Inventory Master').update(updateData).eq('id', data.id);
            }
        }
    } catch (err) { console.error("Failed to update Inventory stock:", err); }
}

async function saveTransactionRecord(mode) {
    showLoading();
    const code = document.getElementById('tr_code').value;
    const fromZone = document.getElementById('tr_from_zone').value;
    const toLocation = document.getElementById('tr_location').value;
    const status = document.getElementById('tr_status').value;
    const movementType = (mode === 'transfer') ? 'ย้ายของ' : document.getElementById('tr_type').value;
    const commonData = { code: code, movement_type: movementType, from_zone: fromZone, to_location: toLocation, status: status, name_lender: document.getElementById('tr_lender')?.value || null, name_borrower: document.getElementById('tr_borrower')?.value || null, lending_date: document.getElementById('tr_lender_date')?.value || null, date_returned: document.getElementById('tr_return_date')?.value || null, remark: document.getElementById('tr_remark').value, edit_id: currentUser.id, edit_at: new Date().toLocaleString('th-TH') };

    try {
        if (mode === 'add' || mode === 'transfer') {
            const itemContainers = document.querySelectorAll('.transaction-item-row');
            if (itemContainers.length === 0) throw new Error('กรุณาเพิ่มอย่างน้อย 1 รายการ');
            const rowsToInsert = Array.from(itemContainers).map(row => ({ ...commonData, id_category: row.querySelector('.itm-id-cat').value, category: row.querySelector('.itm-cat-name').value, asset_code: row.querySelector('.itm-asset').value, inventory_code: row.querySelector('.itm-inv').value, description: row.querySelector('.itm-desc').value, quantity: 1, create_id: currentUser.id, created_at: new Date().toLocaleString('th-TH') }));
            const { error } = await _supabase.from('Transection Inventory').insert(rowsToInsert);
            if (error) throw error;

            for (const row of rowsToInsert) {
                if (mode === 'transfer' || movementType === 'ย้ายของ') {
                    // Fetch source inventory image to carry over
                    const { data: invData } = await _supabase.from('Inventory Master').select('image').eq('zone', fromZone).eq('descriprion', row.description).single();
                    const sourceImage = invData ? invData.image : null;

                    await updateItemMasterStatus(row.asset_code, row.inventory_code, true, toLocation);
                    await updateInventoryStock(fromZone, row.description, -1, row.id_category, null, true);
                    await updateInventoryStock(toLocation, row.description, 1, row.id_category, sourceImage);
                } else {
                    await updateItemMasterStatus(row.asset_code, row.inventory_code, false);
                    await updateInventoryStock(fromZone, row.description, -1, row.id_category);
                }
            }
            alert(`${mode === 'transfer' ? 'ย้ายของ' : 'เพิ่มรายการ'} สำเร็จ!`);
        } else {
            const oldItem = editingTransactionItem;
            const updateData = { ...commonData, id_category: document.getElementById('edit_itm_id_cat').value, category: document.getElementById('edit_itm_cat_name').value, asset_code: document.getElementById('edit_itm_asset').value, inventory_code: document.getElementById('edit_itm_inv').value, description: document.getElementById('edit_itm_desc').value };
            const { error } = await _supabase.from('Transection Inventory').update(updateData).eq('id', oldItem.id);
            if (error) throw error;
            if (status === 'คืนของแล้ว' && oldItem.status !== 'คืนของแล้ว') {
                await updateItemMasterStatus(updateData.asset_code, updateData.inventory_code, true);
                await updateInventoryStock(fromZone, updateData.description, 1, updateData.id_category);
            } else if (status !== 'คืนของแล้ว' && oldItem.status === 'คืนของแล้ว') {
                await updateItemMasterStatus(updateData.asset_code, updateData.inventory_code, false);
                await updateInventoryStock(fromZone, updateData.description, -1, updateData.id_category);
            }
            alert('แก้ไขรายการและปรับยอดเรียบร้อย!');
        }
        closeModal('transactionModal'); loadTransactionData();
    } catch (err) { alert('เกิดข้อผิดพลาด: ' + err.message); } finally { hideLoading(); }
}

async function deleteTransactionRecord(id) {
    if (!confirm('คุณแน่ใจหรือไม่ว่าต้องการลบรายการนี้?')) return;
    showLoading();
    try { const { error } = await _supabase.from('Transection Inventory').delete().eq('id', id); if (error) throw error; alert('ลบรายการสำเร็จ!'); if (document.getElementById('transactionModal').style.display === 'flex') closeModal('transactionModal'); loadTransactionData(); }
    catch (err) { alert('ลบข้อมูลไม่สำเร็จ: ' + err.message); } finally { hideLoading(); }
}

function renderUserView() {
    const mainContent = document.getElementById('mainContent');
    const hasPermission = currentUser.rank === 'Master';
    mainContent.innerHTML = `
        <div class="controls-row">
            <div class="search-filters">
                <input type="text" id="searchUserId" class="search-input" placeholder="🔍 ค้นหาด้วย User ID..." oninput="filterUserTable()">
                <input type="text" id="searchUserName" class="search-input" placeholder="🔍 ค้นหาด้วยชื่อ..." oninput="filterUserTable()">
            </div>
            ${hasPermission ? `<button class="btn-add" onclick="openUserModal(null, 'add')"><span>➕</span> Add User</button>` : ''}
        </div>
        <div class="table-wrapper">
            <table>
                <thead><tr><th>ID</th><th>Name</th><th>User ID</th><th>Password</th><th>Rank</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody id="userTableBody"></tbody>
            </table>
        </div>
        <div id="userPagination" class="pagination-container"></div>
    `;
    loadUserData(0);
}

async function loadUserData(page = 0) {
    currentUserPage = page;
    const tableBody = document.getElementById('userTableBody');
    if (!tableBody) return;

    const searchId = document.getElementById('searchUserId')?.value || '';
    const searchName = document.getElementById('searchUserName')?.value || '';

    tableBody.innerHTML = '<tr><td colspan="7" style="text-align:center;">กำลังโหลดข้อมูล...</td></tr>';
    try { 
        let query = _supabase.from('User Master').select('*', { count: 'exact' });
        
        if (searchId) query = query.ilike('user_id', `%${searchId}%`);
        if (searchName) query = query.ilike('name', `%${searchName}%`);

        const { data, error, count } = await query
            .order('id', { ascending: true })
            .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

        if (error) throw error; 
        renderUserTable(data, count); 
    }
    catch (err) { console.error("Error loading data:", err); tableBody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:red;">โหลดข้อมูลล้มเหลว</td></tr>'; }
}

function renderUserTable(data, totalCount) {
    const tableBody = document.getElementById('userTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = '';
    
    data.forEach(item => {
        const tr = document.createElement('tr');
        tr.onclick = () => {
            if (!isTextSelected()) openUserModal(item, 'view');
        };
        tr.innerHTML = `<td>${item.id}</td><td>${item.name || '-'}</td><td>${item.user_id || '-'}</td><td>${item.password || '****'}</td><td>${item.rank || '-'}</td><td><span class="status-badge ${item.status ? 'status-active' : 'status-inactive'}">${item.status ? 'Active' : 'Inactive'}</span></td><td onclick="event.stopPropagation()"><div class="action-icons"><button class="icon-btn edit-icon" onclick="openUserModal(${JSON.stringify(item).replace(/"/g, '&quot;')}, 'edit')">✎</button><button class="icon-btn delete-icon" onclick="deleteUserItem('${item.id}')">🗑</button></div></td>`;
        tableBody.appendChild(tr);
    });

    renderPagination('userPagination', totalCount, currentUserPage, 'loadUserData');
}

let userFilterTimeout;
function filterUserTable() {
    clearTimeout(userFilterTimeout);
    userFilterTimeout = setTimeout(() => {
        loadUserData(0);
    }, 500);
}

function openUserModal(item, mode) {
    const modal = document.getElementById('userModal');
    modal.style.display = 'flex';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>${mode === 'add' ? 'Add New User' : (mode === 'edit' ? 'Edit User' : 'User Detail')}</h3>
                <button class="close-modal-btn" onclick="closeModal('userModal')">✕</button>
            </div>
            <form id="userForm">
                <div class="modal-grid">
                    <div class="form-group"><label>ID</label><input type="text" id="user_id_pk" value="${item ? item.id : ''}" ${mode !== 'add' ? 'disabled' : ''} required></div>
                    <div class="form-group"><label>Name</label><input type="text" id="user_name" value="${item ? (item.name || '') : ''}" ${mode === 'view' ? 'disabled' : ''} required></div>
                    <div class="form-group"><label>User ID (Login)</label><input type="text" id="user_login_id" value="${item ? (item.user_id || '') : ''}" ${mode === 'view' ? 'disabled' : ''} required></div>
                    <div class="form-group"><label>Password</label><input type="text" id="user_password" value="${item ? (item.password || '') : ''}" ${mode === 'view' ? 'disabled' : ''} required></div>
                    <div class="form-group"><label>Rank</label><select id="user_rank" ${mode === 'view' ? 'disabled' : ''}><option value="User" ${item && item.rank === 'User' ? 'selected' : ''}>User</option><option value="Admin" ${item && item.rank === 'Admin' ? 'selected' : ''}>Admin</option><option value="Master" ${item && item.rank === 'Master' ? 'selected' : ''}>Master</option></select></div>
                    <div class="form-group"><label>Status</label><select id="user_status" ${mode === 'view' ? 'disabled' : ''}><option value="true" ${item && item.status ? 'selected' : ''}>Active</option><option value="false" ${item && !item.status ? 'selected' : ''}>Inactive</option></select></div>
                    <div class="form-group full-width"><label>Remark</label><textarea id="user_remark" rows="2" ${mode === 'view' ? 'disabled' : ''}>${item ? (item.remark || '') : ''}</textarea></div>
                    <div class="form-group"><label>Login At</label><input type="text" value="${item ? (item.login_at || '-') : '-'}" disabled></div>
                    <div class="form-group"><label>Create Name</label><input type="text" value="${item ? (item.create_name || '') : currentUser.name}" disabled></div>
                    <div class="form-group"><label>Created At</label><input type="text" value="${item ? (item.created_at || '') : new Date().toLocaleString('th-TH')}" disabled></div>
                    <div class="form-group"><label>Edit Name</label><input type="text" value="${mode === 'edit' ? currentUser.name : (item ? (item.edit_name || '') : '')}" disabled></div>
                    <div class="form-group"><label>Edit At</label><input type="text" value="${mode === 'edit' ? new Date().toLocaleString('th-TH') : (item ? (item.edit_at || '') : '')}" disabled></div>
                </div>
                <div class="modal-footer">${mode === 'view' ? `<button type="button" class="btn-cancel" onclick="closeModal('userModal')">ปิดหน้าต่าง</button>` : `<button type="button" class="btn-cancel" onclick="closeModal('userModal')">ยกเลิก</button><button type="button" class="btn-save" onclick="saveUserItem('${mode}')">${mode === 'add' ? 'บันทึกผู้ใช้ใหม่' : 'บันทึกการแก้ไข'}</button>`}</div>
            </form>
        </div>
    `;
}

async function saveUserItem(mode) {
    showLoading();
    const id = document.getElementById('user_id_pk').value;
    const userData = { name: document.getElementById('user_name').value, user_id: document.getElementById('user_login_id').value, password: document.getElementById('user_password').value, rank: document.getElementById('user_rank').value, status: document.getElementById('user_status').value === 'true', remark: document.getElementById('user_remark').value, edit_name: currentUser.name, edit_at: new Date().toLocaleString('th-TH') };
    try {
        if (mode === 'add') { userData.id = id; userData.create_name = currentUser.name; userData.created_at = new Date().toLocaleString('th-TH'); const { error } = await _supabase.from('User Master').insert([userData]); if (error) throw error; alert('เพิ่มผู้ใช้ใหม่สำเร็จ!'); }
        else { const { error } = await _supabase.from('User Master').update(userData).eq('id', id); if (error) throw error; alert('แก้ไขข้อมูลผู้ใช้สำเร็จ!'); }
        closeModal('userModal'); loadUserData();
    } catch (err) { alert('เกิดข้อผิดพลาด: ' + err.message); } finally { hideLoading(); }
}

async function deleteUserItem(id) {
    if (id === currentUser.id) { alert('ไม่สามารถลบบัญชีที่กำลังใช้งานอยู่ได้'); return; }
    if (!confirm(`คุณแน่ใจหรือไม่ว่าต้องการลบผู้ใช้ ID: ${id}?`)) return;
    showLoading();
    try { const { error } = await _supabase.from('User Master').delete().eq('id', id); if (error) throw error; alert('ลบผู้ใช้สำเร็จ!'); loadUserData(); }
    catch (err) { alert('ลบผู้ใช้ไม่สำเร็จ: ' + err.message); } finally { hideLoading(); }
}

function closeModal(modalId) { document.getElementById(modalId).style.display = 'none'; }
function logout() { localStorage.removeItem('wms_user'); location.reload(); }

// --- Dashboard View Implementation ---
let dashboardData = {};
let currentLayout = 'Indoor Floor 1';

const layoutConfigs = {
    'Indoor Floor 1': {
        file: 'layouts/Indoor Floor 1_0.png',
        label: 'Indoor Floor 1',
        size: { width: 1180, height: 760 },
        rooms: [
            { text: 'BB<br>Inventory Zone', left: 80, top: 12, width: 1090, height: 110 },
            { text: 'Key Zone', left: 10, top: 290, width: 230, height: 420 }
        ],
        slots: {
            AA01: { left: 120, top: 140, width: 75, height: 78 }, AA02: { left: 195, top: 140, width: 75, height: 78 },
            AA03: { left: 270, top: 140, width: 75, height: 78 }, AA04: { left: 345, top: 140, width: 75, height: 78 },
            AA05: { left: 420, top: 140, width: 75, height: 78 }, AA06: { left: 495, top: 140, width: 75, height: 78 },
            AA07: { left: 570, top: 140, width: 75, height: 78 }, AA08: { left: 645, top: 140, width: 75, height: 78 },
            AA09: { left: 720, top: 140, width: 75, height: 78 }, AA10: { left: 795, top: 140, width: 75, height: 78 },
            AA11: { left: 870, top: 140, width: 75, height: 78 }, AA12: { left: 945, top: 140, width: 75, height: 78 },
            AA13: { left: 1020, top: 140, width: 75, height: 78 }, AA14: { left: 1095, top: 140, width: 75, height: 78 },
            AA22: { left: 255, top: 310, width: 88, height: 188 }, AA21: { left: 255, top: 498, width: 88, height: 188 },
            AA16: { left: 725, top: 330, width: 225, height: 88 }, AA15: { left: 950, top: 330, width: 220, height: 88 },
            AA18: { left: 725, top: 478, width: 225, height: 88 }, AA17: { left: 950, top: 478, width: 220, height: 88 },
            AA20: { left: 725, top: 626, width: 225, height: 88 }, AA19: { left: 950, top: 626, width: 220, height: 88 }
        }
    },
    'Outdoor Floor 1': {
        file: 'layouts/Outdoor Floor 1_0.png',
        label: 'Outdoor Floor 1',
        size: { width: 1180, height: 760 },
        rooms: [
            { text: 'LIFT', left: 930, top: 6, width: 140, height: 86 },
            { text: 'DD<br>Inventory Zone', left: 730, top: 14, width: 120, height: 92 },
            { text: 'DD<br>Inventory Zone', left: 948, top: 320, width: 88, height: 360 },
            { text: 'DD<br>Inventory Zone', left: 800, top: 720, width: 300, height: 44 },
            { text: 'Garbage for sale', left: 300, top: 110, width: 54, height: 120, fontSize: 12 },
            { text: 'Garbage<br>for sale', left: 412, top: 174, width: 64, height: 56, fontSize: 10 },
            { text: '-4 / จัดชั้น 1', left: 8, top: 56, width: 58, height: 94, fontSize: 12, rotate: -90 },
            { text: '-4 / จัดชั้น 1', left: 8, top: 150, width: 58, height: 94, fontSize: 12, rotate: -90 }
        ],
        slots: {
            JJ01: { left: 64, top: 2, width: 140, height: 44 }, JJ02: { left: 204, top: 2, width: 140, height: 44 }, JJ03: { left: 344, top: 2, width: 140, height: 44 },
            HH03: { left: 94, top: 110, width: 200, height: 136 }, HH02: { left: 94, top: 250, width: 200, height: 136 }, HH01: { left: 296, top: 250, width: 200, height: 136 },
            KK: { left: 360, top: 110, width: 160, height: 136 },
            II07: { left: 8, top: 56, width: 58, height: 94 }, II06: { left: 8, top: 150, width: 58, height: 94 }, II05: { left: 8, top: 244, width: 58, height: 94 },
            II04: { left: 8, top: 338, width: 58, height: 94 }, II03: { left: 8, top: 432, width: 58, height: 94 }, II02: { left: 8, top: 526, width: 58, height: 94 }, II01: { left: 8, top: 620, width: 58, height: 94 },
            GG10: { left: 92, top: 426, width: 104, height: 44 }, GG11: { left: 296, top: 426, width: 104, height: 44 }, GG12: { left: 400, top: 426, width: 100, height: 44 },
            GG09: { left: 92, top: 530, width: 104, height: 42 }, GG08: { left: 196, top: 530, width: 104, height: 42 }, GG07: { left: 300, top: 530, width: 104, height: 42 }, GG06: { left: 404, top: 530, width: 104, height: 42 },
            GG05: { left: 92, top: 630, width: 128, height: 48 }, GG04: { left: 258, top: 630, width: 128, height: 48 }, GG03: { left: 386, top: 630, width: 128, height: 48 },
            GG02: { left: 198, top: 732, width: 122, height: 28 }, GG01: { left: 320, top: 732, width: 122, height: 28 },
            FF01: { left: 678, top: 210, width: 258, height: 176 },
            EE08: { left: 678, top: 410, width: 128, height: 48 }, EE09: { left: 806, top: 410, width: 130, height: 48 },
            EE06: { left: 678, top: 520, width: 128, height: 48 }, EE07: { left: 806, top: 520, width: 130, height: 48 },
            EE05: { left: 628, top: 610, width: 52, height: 90 }, EE04: { left: 680, top: 610, width: 126, height: 45 }, EE03: { left: 806, top: 610, width: 130, height: 45 },
            EE01: { left: 680, top: 655, width: 126, height: 45 }, EE02: { left: 806, top: 655, width: 130, height: 45 }
        }
    },
    'Outdoor Floor 2 Left': {
        file: 'layouts/Outdoor floor 2 Left_0.png',
        label: 'Outdoor Floor 2 Left',
        size: { width: 1160, height: 930 },
        rooms: [
            { text: 'LIFT', left: 960, top: 6, width: 150, height: 72 },
            { text: '', left: 960, top: 190, width: 190, height: 575, bg: '#dceaf0' }
        ],
        slots: {
            NN02: { left: 6, top: 0, width: 280, height: 146 }, NN03: { left: 286, top: 0, width: 280, height: 146 },
            NN01: { left: 6, top: 146, width: 560, height: 118 },
            OO04: { left: 214, top: 318, width: 92, height: 56 }, OO03: { left: 306, top: 318, width: 92, height: 56 }, OO02: { left: 398, top: 318, width: 92, height: 56 }, OO01: { left: 490, top: 318, width: 92, height: 56 },
            OO05: { left: 214, top: 374, width: 92, height: 42 }, OO06: { left: 306, top: 374, width: 92, height: 42 }, OO07: { left: 398, top: 374, width: 92, height: 42 }, OO08: { left: 490, top: 374, width: 92, height: 42 },
            ZZ11: { left: 88, top: 450, width: 160, height: 44 }, ZZ09: { left: 262, top: 450, width: 160, height: 44 }, ZZ07: { left: 436, top: 450, width: 160, height: 44 },
            ZZ10: { left: 88, top: 494, width: 160, height: 44 }, ZZ08: { left: 262, top: 494, width: 160, height: 44 }, ZZ06: { left: 436, top: 494, width: 160, height: 44 },
            ZZ05: { left: 90, top: 590, width: 500, height: 48 }, ZZ04: { left: 90, top: 638, width: 500, height: 48 }, ZZ03: { left: 90, top: 720, width: 500, height: 46 }, ZZ02: { left: 90, top: 766, width: 500, height: 46 },
            ZZ01: { left: 160, top: 878, width: 360, height: 46 },
            MM01: { left: 660, top: 176, width: 266, height: 182 }, MM02: { left: 660, top: 358, width: 266, height: 182 }, MM03: { left: 660, top: 540, width: 266, height: 280 }
        }
    },
    'Outdoor Floor 2 Right': {
        file: 'layouts/Outdoor floor 2 Right_0.png',
        label: 'Outdoor Floor 2 Right',
        size: { width: 1060, height: 640 },
        rooms: [
            { text: 'LIFT', left: 12, top: 8, width: 184, height: 72 },
            { text: '', left: 0, top: 176, width: 206, height: 590, bg: '#dceaf0' },
            { text: 'ห้องเก็บพระ', left: 744, top: 392, width: 300, height: 240 }
        ],
        slots: {
            ZZA: { left: 278, top: 0, width: 182, height: 78, label: 'ZZ-A' }, ZZB: { left: 462, top: 0, width: 182, height: 78, label: 'ZZ-B' }, ZZC: { left: 646, top: 0, width: 182, height: 78, label: 'ZZ-C' }, ZZD: { left: 830, top: 0, width: 182, height: 78, label: 'ZZ-D' },
            LL01: { left: 222, top: 176, width: 338, height: 178 }, ZZDOC01: { left: 918, top: 92, width: 104, height: 250, label: 'ZZ-Doc. 01' },
            LL02: { left: 222, top: 428, width: 338, height: 206 }
        }
    }
};

function getQtyColor(qty) {
    if (qty === 0) return '#d9d9d9'; // ว่าง
    if (qty <= 10) return '#7fd3ff'; // ฟ้า
    if (qty <= 20) return '#97d055'; // เขียว
    if (qty <= 30) return '#fff200'; // เหลือง
    return '#e566e7'; // ชมพู/ม่วง
}

async function renderDashboardView() {
    const mainContent = document.getElementById('mainContent');
    const cfg = layoutConfigs[currentLayout];
    
    // Fetch data including new stats
    await fetchDashboardData();
    
    const stats = dashboardStats;

    mainContent.innerHTML = `
        <!-- Main Stats Row -->
        <div class="dashboard-stats-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 25px; margin-bottom: 35px;">
            <div class="stat-card modern-card" style="background: linear-gradient(135deg, #6c5ce7 0%, #a29bfe 100%);">
                <div class="card-icon">📦</div>
                <div class="card-info">
                    <span class="card-label">จำนวนของทั้งหมด</span>
                    <div class="card-value">${stats.totalQty.toLocaleString()} <span class="unit">Units</span></div>
                </div>
                <div class="card-progress"><div class="progress-bar" style="width: 100%"></div></div>
            </div>

            <div class="stat-card modern-card" style="background: linear-gradient(135deg, #0984e3 0%, #74b9ff 100%);">
                <div class="card-icon">📁</div>
                <div class="card-info">
                    <span class="card-label">หมวดหมู่ทั้งหมด</span>
                    <div class="card-value">${stats.totalCategories.toLocaleString()} <span class="unit">Categories</span></div>
                </div>
                <div class="card-progress"><div class="progress-bar" style="width: 100%"></div></div>
            </div>

            <div class="stat-card modern-card" style="background: linear-gradient(135deg, #d4af37 0%, #f1c40f 100%);">
                <div class="card-icon">📍</div>
                <div class="card-info">
                    <span class="card-label">โซนทั้งหมด</span>
                    <div class="card-value">${stats.totalZones.toLocaleString()} <span class="unit">Zones</span></div>
                </div>
                <div class="card-progress"><div class="progress-bar" style="width: 100%"></div></div>
            </div>
        </div>

        <!-- Visual Analytics Row -->
        <div style="display: grid; grid-template-columns: 1fr 1.2fr 1fr; gap: 25px; margin-bottom: 35px;">
            <!-- Column 1: Transaction Status Chart -->
            <div class="analytics-card" style="background: #fff; border-radius: 30px; padding: 25px; box-shadow: var(--shadow-premium); border: 1px solid var(--glass-border); display: flex; flex-direction: column; align-items: center;">
                <h3 style="color: var(--bu-purple); font-weight: 800; font-size: 1.1rem; margin-bottom: 20px; align-self: flex-start;">📊 Transaction Status</h3>
                <div style="width: 100%; height: 280px; position: relative;">
                    <canvas id="statusChart"></canvas>
                </div>
            </div>

            <!-- Column 2: Grouped Zones Bar Chart -->
            <div class="analytics-card" style="background: #fff; border-radius: 30px; padding: 25px; box-shadow: var(--shadow-premium); border: 1px solid var(--glass-border);">
                <h3 style="color: var(--bu-purple); font-weight: 800; font-size: 1.1rem; margin-bottom: 20px;">🏘️ จำนวนของแยกตาม Zone</h3>
                <div style="width: 100%; height: 280px;">
                    <canvas id="zoneChart"></canvas>
                </div>
            </div>

            <!-- Column 3: Category Summary Chart -->
            <div class="analytics-card" style="background: #fff; border-radius: 30px; padding: 25px; box-shadow: var(--shadow-premium); border: 1px solid var(--glass-border); display: flex; flex-direction: column; align-items: center;">
                <h3 style="color: var(--bu-purple); font-weight: 800; font-size: 1.1rem; margin-bottom: 20px; align-self: flex-start;">📁 Category Summary</h3>
                <div style="width: 100%; height: 280px;">
                    <canvas id="categoryChart"></canvas>
                </div>
            </div>
        </div>

        <div class="dashboard-controls" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px; padding: 20px; background: #fff; border-radius: 25px; box-shadow: 0 10px 30px rgba(0,0,0,0.03);">
            <div class="dashboard-layout-selector" style="margin-bottom:0">
                ${Object.keys(layoutConfigs).map(key => `
                    <button class="layout-btn ${currentLayout === key ? 'active' : ''}" onclick="changeLayout('${key}')">${layoutConfigs[key].label}</button>
                `).join('')}
            </div>
            <div class="legend-card" style="border: none; box-shadow: none; background: #f8f9fa; padding: 10px 20px;">
                <div style="display:flex; align-items:center; gap:8px;"><span style="width:12px; height:12px; background:#d9d9d9; border-radius:3px;"></span> 0</div>
                <div style="display:flex; align-items:center; gap:8px;"><span style="width:12px; height:12px; background:#7fd3ff; border-radius:3px;"></span> 1-10</div>
                <div style="display:flex; align-items:center; gap:8px;"><span style="width:12px; height:12px; background:#97d055; border-radius:3px;"></span> 11-20</div>
                <div style="display:flex; align-items:center; gap:8px;"><span style="width:12px; height:12px; background:#fff200; border-radius:3px;"></span> 21-30</div>
                <div style="display:flex; align-items:center; gap:8px;"><span style="width:12px; height:12px; background:#e566e7; border-radius:3px;"></span> 31+</div>
            </div>
        </div>

        <div class="layout-viewport" style="background: #fdfdfe; border-radius: 40px; border: 1px solid #eee;">
            <div id="layoutInteractive" class="layout-container" style="width: ${cfg.size.width}px; height: ${cfg.size.height}px;">
                <!-- Rooms and Slots will be drawn here -->
            </div>
        </div>
    `;

    drawInteractiveLayout();
    initDashboardCharts(stats);
}

function initDashboardCharts(stats) {
    const ctxStatus = document.getElementById('statusChart').getContext('2d');
    const ctxZone = document.getElementById('zoneChart').getContext('2d');
    const ctxCategory = document.getElementById('categoryChart').getContext('2d');

    // 1. Transaction Status Chart (Doughnut)
    new Chart(ctxStatus, {
        type: 'doughnut',
        data: {
            labels: Object.keys(stats.statusCounts),
            datasets: [{
                data: Object.values(stats.statusCounts),
                backgroundColor: ['#e17055', '#00b894', '#fdcb6e', '#3a7bd5', '#a29bfe'],
                borderWidth: 0,
                hoverOffset: 15
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom', labels: { usePointStyle: true, font: { family: 'Kanit', size: 11 } } },
                tooltip: { padding: 15, bodyFont: { family: 'Kanit' }, titleFont: { family: 'Kanit' } }
            },
            cutout: '70%'
        }
    });

    // 2. Zone Group Chart (Horizontal Bar)
    const zoneLabels = Object.keys(stats.prefixZones).sort((a,b) => stats.prefixZones[b] - stats.prefixZones[a]);
    const zoneData = zoneLabels.map(l => stats.prefixZones[l]);

    new Chart(ctxZone, {
        type: 'bar',
        data: {
            labels: zoneLabels,
            datasets: [{
                label: 'Quantity',
                data: zoneData,
                backgroundColor: zoneLabels.map((_, i) => i % 2 === 0 ? '#3A2E5B' : '#E67E22'),
                borderRadius: 10,
                barThickness: 20
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { display: false }, ticks: { font: { family: 'Kanit' } } },
                y: { grid: { display: false }, ticks: { font: { family: 'Kanit', weight: 'bold' } } }
            }
        }
    });

    // 3. Category Summary Chart (Bar)
    const catLabels = Object.keys(stats.categoryStats).sort((a,b) => stats.categoryStats[b] - stats.categoryStats[a]).slice(0, 10);
    const catData = catLabels.map(l => stats.categoryStats[l]);

    new Chart(ctxCategory, {
        type: 'bar',
        data: {
            labels: catLabels,
            datasets: [{
                label: 'Items',
                data: catData,
                backgroundColor: '#3a7bd5',
                borderRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { grid: { display: false }, ticks: { font: { family: 'Kanit', size: 10 } } },
                y: { grid: { color: '#f0f0f0' }, ticks: { font: { family: 'Kanit' } } }
            }
        }
    });
}

function drawInteractiveLayout() {
    const container = document.getElementById('layoutInteractive');
    const cfg = layoutConfigs[currentLayout];
    if (!container || !cfg) return;

    // Draw Rooms (Static areas)
    cfg.rooms.forEach(room => {
        const div = document.createElement('div');
        div.className = 'room';
        div.style.left = room.left + 'px';
        div.style.top = room.top + 'px';
        div.style.width = room.width + 'px';
        div.style.height = room.height + 'px';
        if (room.fontSize) div.style.fontSize = room.fontSize + 'px';
        if (room.rotate) div.style.transform = `rotate(${room.rotate}deg)`;
        div.innerHTML = room.text || '';
        container.appendChild(div);
    });

    // Draw Slots (Interactive interactive)
    Object.entries(cfg.slots).forEach(([code, pos]) => {
        const zoneInfo = dashboardData[code] || { totalQty: 0 };
        const div = document.createElement('div');
        div.className = 'slot';
        div.style.left = pos.left + 'px';
        div.style.top = pos.top + 'px';
        div.style.width = pos.width + 'px';
        div.style.height = pos.height + 'px';
        div.style.background = getQtyColor(zoneInfo.totalQty);
        
        // Add Tooltip data
        div.setAttribute('data-tooltip', `${code}: ${zoneInfo.totalQty.toLocaleString()} units`);
        
        div.innerHTML = `
            <div class="code">${pos.label || code}</div>
            <div class="qty">${zoneInfo.totalQty} units</div>
        `;
        
        div.onclick = (e) => {
            e.stopPropagation();
            document.querySelectorAll('.slot').forEach(s => s.classList.remove('active'));
            div.classList.add('active');
            openZonePopup(code);
        };
        
        container.appendChild(div);
    });
}

async function changeLayout(layoutKey) {
    currentLayout = layoutKey;
    renderDashboardView();
}

let dashboardStats = {};

async function fetchDashboardData() {
    try {
        showLoading();
        dashboardData = {}; 
        
        // Fetch all data in parallel
        const [invRes, itemRes, catRes, transRes] = await Promise.all([
            _supabase.from('Inventory Master').select('zone, descriprion, quantity, image, id_category'),
            _supabase.from('Item Master').select('location_zone, description, category_id'),
            _supabase.from('Category Master').select('id', { count: 'exact', head: true }),
            _supabase.from('Transection Inventory').select('status')
        ]);

        if (invRes.error) throw invRes.error;
        if (itemRes.error) throw itemRes.error;
        if (catRes.error) throw catRes.error;
        if (transRes.error) throw transRes.error;

        const zones = {};
        const prefixZones = {}; // Grouped by prefix (AA, BB, etc.)
        const categoryStats = {}; // Total items per Category (from Item Master)
        let totalQty = 0;
        let uniqueDescs = new Set();

        // Process Item Master for Category Stats (1 record = 1 item)
        itemRes.data.forEach(row => {
            const catId = row.category_id || 'N/A';
            categoryStats[catId] = (categoryStats[catId] || 0) + 1;
            
            const z = row.location_zone || 'Unknown';
            const desc = row.description || 'No Description';
            if (!zones[z]) zones[z] = { totalQty: 0, descriptions: {} };
            if (!zones[z].descriptions[desc]) zones[z].descriptions[desc] = { qty: 0, image: null };
            uniqueDescs.add(desc);
        });

        // Process Inventory Master for Zone Totals
        invRes.data.forEach(row => {
            const z = row.zone || 'Unknown';
            const prefix = z.replace(/[0-9]/g, '').trim() || z;
            const qty = row.quantity || 0;
            const desc = row.descriprion || 'No Description';
            const img = row.image || null;

            if (!zones[z]) zones[z] = { totalQty: 0, descriptions: {} };
            if (!zones[z].descriptions[desc]) zones[z].descriptions[desc] = { qty: 0, image: img };
            
            zones[z].totalQty += qty;
            zones[z].descriptions[desc].qty += qty;
            if (img && !zones[z].descriptions[desc].image) zones[z].descriptions[desc].image = img;

            prefixZones[prefix] = (prefixZones[prefix] || 0) + qty;
            totalQty += qty;
        });

        // Global Stats
        const statusCounts = {};
        transRes.data.forEach(t => {
            const status = t.status || 'N/A';
            statusCounts[status] = (statusCounts[status] || 0) + 1;
        });

        dashboardStats = {
            totalZones: Object.keys(zones).length,
            totalQty: totalQty,
            totalItems: uniqueDescs.size,
            totalCategories: catRes.count || 0,
            statusCounts: statusCounts,
            prefixZones: prefixZones,
            categoryStats: categoryStats
        };

        dashboardData = zones;
    } catch (err) {
        console.error('Error fetching dashboard data:', err);
    } finally {
        hideLoading();
    }
}

function openZonePopup(zoneName) {
    const popup = document.getElementById('sidePopup');
    const overlay = document.getElementById('popupOverlay');
    const zoneInfo = dashboardData[zoneName] || { totalQty: 0, descriptions: {} };

    document.getElementById('popupZoneName').innerText = zoneName;
    
    const content = document.getElementById('popupContent');
    content.innerHTML = `
        <div class="popup-summary">
            <span class="summary-label">Total Items in Zone</span>
            <div class="summary-value">${zoneInfo.totalQty.toLocaleString()}</div>
        </div>
        
        <div class="search-group" style="margin-bottom: 25px;">
            <input type="text" id="popupSearch" class="search-input" style="width:100%; padding: 0.8rem 1.2rem; border-radius: 15px;" 
                   placeholder="🔍 ค้นหา Description..." oninput="filterPopupItems('${zoneName}')">
        </div>

        <h4 style="margin-bottom: 20px; color: var(--bu-purple); display: flex; justify-content: space-between; align-items: center;">
            รายการสิ่งของ
            <span style="font-size: 0.8rem; background: #f0f3ff; color: #3a7bd5; padding: 4px 10px; border-radius: 8px;" id="popupMatchCount">
                ${Object.keys(zoneInfo.descriptions).length} รายการ
            </span>
        </h4>
        
        <div class="popup-item-list" id="popupItemList">
            ${renderPopupItemList(zoneName)}
        </div>
    `;

    popup.classList.add('open');
    if (overlay) overlay.classList.add('show');
}

function renderPopupItemList(zoneName, filter = '') {
    const zoneInfo = dashboardData[zoneName] || { totalQty: 0, descriptions: {} };
    const descriptions = Object.keys(zoneInfo.descriptions).filter(desc => 
        desc.toLowerCase().includes(filter.toLowerCase())
    );

    if (descriptions.length === 0) {
        return `<p style="color: var(--text-muted); text-align: center; padding: 20px;">ไม่พบรายการที่ตรงกับเงื่อนไข</p>`;
    }

    return descriptions.map(desc => {
        const item = zoneInfo.descriptions[desc];
        return `
            <div class="popup-item-card" style="display: flex; gap: 15px; align-items: center; cursor: pointer; transition: transform 0.2s;" 
                 onclick="showItemDetailsInZone('${zoneName}', '${desc.replace(/'/g, "\\'")}')"
                 onmouseover="this.style.transform='translateX(5px)'" 
                 onmouseout="this.style.transform='translateX(0)'">
                ${item.image ? `<img src="${item.image}" style="width: 60px; height: 60px; object-fit: cover; border-radius: 10px; border: 1px solid #eee;">` : `<div style="width: 60px; height: 60px; background: #f8f9fa; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 1.2rem; color: #ccc; border: 1px solid #eee;">🖼️</div>`}
                <div style="flex: 1;">
                    <span class="item-desc" style="margin-bottom: 5px; display: block; font-weight: 700; color: var(--bu-purple);">${desc}</span>
                    <div class="item-meta">
                        <span>ยอดรวมใน Zone</span>
                        <span class="item-qty" style="font-weight: 800; color: var(--bu-orange);">${item.qty.toLocaleString()}</span>
                    </div>
                </div>
                <div style="color: #ccc; font-size: 1.2rem;">›</div>
            </div>
        `;
    }).join('');
}

async function showItemDetailsInZone(zoneName, description) {
    showLoading();
    try {
        // ดึงข้อมูลดิบจากทั้ง 2 ตารางที่ระบุ Zone และ Description นี้
        const [invRes, itemRes] = await Promise.all([
            _supabase.from('Inventory Master').select('*').eq('zone', zoneName).eq('descriprion', description),
            _supabase.from('Item Master').select('*').eq('location_zone', zoneName).eq('description', description)
        ]);

        const popupContent = document.getElementById('popupContent');
        const backBtn = `<button onclick="openZonePopup('${zoneName}')" style="background: none; border: none; color: var(--bu-purple); cursor: pointer; font-weight: 700; margin-bottom: 20px; display: flex; align-items: center; gap: 5px;">← กลับไปหน้ารวม Zone</button>`;
        
        let html = `${backBtn}
            <h4 style="color: var(--bu-purple); margin-bottom: 15px;">รายละเอียด: ${description}</h4>
            <div style="background: #f8f9fa; padding: 15px; border-radius: 15px; margin-bottom: 20px;">
                <p style="font-size: 0.9rem; color: #666; margin-bottom: 5px;">Zone: <strong>${zoneName}</strong></p>
            </div>
        `;

        if (itemRes.data && itemRes.data.length > 0) {
            html += `<h5 style="margin-bottom: 10px;">Item Master Records (${itemRes.data.length})</h5>
                <div class="popup-item-list" style="margin-bottom: 25px;">
                    ${itemRes.data.map(item => `
                        <div class="popup-item-card" style="padding: 12px; font-size: 0.85rem;">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                                <span style="color: #666;">Asset Code:</span>
                                <strong style="color: var(--bu-purple);">${item.asset_code}</strong>
                            </div>
                            <div style="display: flex; justify-content: space-between;">
                                <span style="color: #666;">Inventory Code:</span>
                                <strong>${item.inventory_code || '-'}</strong>
                            </div>
                        </div>
                    `).join('')}
                </div>`;
        }

        if (invRes.data && invRes.data.length > 0) {
            html += `<h5 style="margin-bottom: 10px;">Inventory Records (${invRes.data.length})</h5>
                <div class="popup-item-list">
                    ${invRes.data.map(item => `
                        <div class="popup-item-card" style="padding: 12px; font-size: 0.85rem;">
                            <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
                                <span style="color: #666;">ID:</span>
                                <strong>${item.id}</strong>
                            </div>
                            <div style="display: flex; justify-content: space-between;">
                                <span style="color: #666;">Quantity:</span>
                                <strong style="color: var(--bu-orange); font-size: 1rem;">${item.quantity}</strong>
                            </div>
                        </div>
                    `).join('')}
                </div>`;
        }

        popupContent.innerHTML = html;
    } catch (err) {
        console.error('Error fetching item details:', err);
    } finally {
        hideLoading();
    }
}

function filterPopupItems(zoneName) {
    const query = document.getElementById('popupSearch').value;
    const listContainer = document.getElementById('popupItemList');
    const matchCount = document.getElementById('popupMatchCount');
    
    if (listContainer) listContainer.innerHTML = renderPopupItemList(zoneName, query);
    
    // อัปเดตตัวเลขจำนวนที่ค้นเจอ
    const zoneInfo = dashboardData[zoneName] || { descriptions: {} };
    const count = Object.keys(zoneInfo.descriptions).filter(desc => 
        desc.toLowerCase().includes(query.toLowerCase())
    ).length;
    if (matchCount) matchCount.innerText = `${count} รายการ`;
}

function closeZonePopup() {
    const popup = document.getElementById('sidePopup');
    const overlay = document.getElementById('popupOverlay');
    if (popup) popup.classList.remove('open');
    if (overlay) overlay.classList.remove('show');
    // Also remove highlight from layout
    document.querySelectorAll('.slot').forEach(s => s.classList.remove('active'));
}
