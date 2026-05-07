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
let currentView = 'items';
let editingTransactionItem = null;

// --- Pagination Settings ---
const PAGE_SIZE = 500;
const ITEM_PAGE_SIZE = 200;
const FILTER_FETCH_SIZE = 1000;
const USE_LIFE_DB_COLUMN = 'Use Life';
const USE_LIFE_SYNC_STORAGE_KEY = 'wms_use_life_sync_date';
let currentInventoryPage = 0;
let currentItemPage = 0;
let currentCategoryPage = 0;
let currentTransactionPage = 0;
let currentUserPage = 0;
let useLifeSyncPromise = null;

// --- Global Filters State ---
let activeFilters = {
    inventory: {},
    items: {},
    category: {},
    transactions: {},
    users: {}
};

let activeSort = {
    items: { column: null, direction: 'asc' }
};

function getSortIndicator(view, column) {
    const sort = activeSort[view];
    if (!sort || sort.column !== column) return '';
    return `<span class="sort-indicator">${sort.direction === 'asc' ? '▲' : '▼'}</span>`;
}

function setSort(view, column, direction) {
    if (!activeSort[view]) activeSort[view] = {};
    activeSort[view] = { column, direction };
    document.querySelectorAll('.filter-dropdown').forEach(d => d.classList.remove('show'));
    if (view === 'items') renderItemView();
}

function clearSort(view, column) {
    if (activeSort[view]?.column === column) activeSort[view] = { column: null, direction: 'asc' };
    document.querySelectorAll('.filter-dropdown').forEach(d => d.classList.remove('show'));
    if (view === 'items') renderItemView();
}

// Function to toggle filter dropdown
function toggleFilterDropdown(event, view, column) {
    event.stopPropagation();
    const dropdownId = `filter-dropdown-${view}-${column}`;
    
    // Find the correct dropdown element (might be in th or in body)
    const allElements = document.querySelectorAll(`[id="${dropdownId}"]`);
    let dropdown = Array.from(allElements).find(el => document.getElementById('mainContent').contains(el)) || allElements[0];
    
    if (!dropdown) return;

    // Remove any orphaned dropdowns of the same ID from body
    Array.from(allElements).forEach(el => {
        if (el !== dropdown && el.parentElement === document.body) el.remove();
    });

    const btn = event.currentTarget;
    const isShowing = dropdown.classList.contains('show');

    // Close all other dropdowns
    document.querySelectorAll('.filter-dropdown').forEach(d => d.classList.remove('show'));

    if (!isShowing) {
        // Move to body to ensure it's not clipped by table-wrapper
        document.body.appendChild(dropdown);
        
        // Initial position
        updateDropdownPosition(dropdown, btn);
        
        dropdown.classList.add('show');
        populateFilterOptions(view, column);

        // Store reference for scroll repositioning
        dropdown._attachedBtn = btn;
    }
}

function updateDropdownPosition(dropdown, btn) {
    if (!dropdown || !btn) return;
    const rect = btn.getBoundingClientRect();
    const dropdownWidth = 280; // Match CSS
    
    dropdown.style.top = (rect.bottom + 5) + 'px';
    let leftPos = rect.left;
    
    // Prevent overflow right
    if (leftPos + dropdownWidth > window.innerWidth) {
        leftPos = window.innerWidth - dropdownWidth - 20;
    }
    dropdown.style.left = Math.max(10, leftPos) + 'px';
}

// Reposition open dropdowns on ANY scroll (window or table wrapper)
document.addEventListener('scroll', () => {
    const openDropdown = document.querySelector('.filter-dropdown.show');
    if (openDropdown && openDropdown._attachedBtn) {
        updateDropdownPosition(openDropdown, openDropdown._attachedBtn);
    }
}, true);

// --- Horizontal Scroll Logic (Ctrl + Shift + Wheel) ---
window.addEventListener('wheel', (e) => {
    if (e.ctrlKey && e.shiftKey) {
        const tableWrapper = e.target.closest('.table-wrapper');
        if (tableWrapper) {
            e.preventDefault();
            // scrollLeft += deltaY (increased multiplier for smoother feel)
            tableWrapper.scrollLeft += e.deltaY * 1.5;
        }
    }
}, { passive: false });

// Function to populate unique options in the filter dropdown
async function populateFilterOptions(view, column) {
    const dropdown = document.getElementById(`filter-dropdown-${view}-${column}`);
    const optionsContainer = dropdown.querySelector('.filter-options');
    const searchInput = dropdown.querySelector('.filter-search');
    const tableName = getTableNameFromView(view);
    const dbColumn = getDbColumnFromViewColumn(view, column);

    optionsContainer.innerHTML = '<div style="font-size: 0.8rem; padding: 10px; color: #666;">กำลังโหลด...</div>';

    try {
        const data = await fetchAllFilterColumnValues(view, column, tableName, dbColumn);

        const sourceData = view === 'items'
            ? data.filter(item => itemMatchesItemSearchControls(item) && itemPassesItemFiltersExcept(item, column))
            : data;

        const getUniqueValues = (rows) => {
            const values = [...new Set(rows.map(item => getNormalizedFilterValue(getFilterRowValue(view, column, item))))];
            values.sort(compareNormalizedFilterValues);
            return values;
        };

        // Get unique values from the full table result, not only the visible page.
        let uniqueValues = getUniqueValues(sourceData);
        
        const renderOptions = (filterText = '') => {
            const query = normalizeSearchText(filterText);
            const filtered = view === 'items' && query
                ? getUniqueValues(sourceData.filter(item =>
                    getItemMasterSearchText(item).includes(query) ||
                    normalizeSearchText(getFilterRowValue(view, column, item)).includes(query)
                ))
                : uniqueValues.filter(v => normalizeSearchText(v).includes(query));
            const selected = activeFilters[view][column] || [];

            optionsContainer.innerHTML = filtered.map(val => `
                <label class="filter-option">
                    <input type="checkbox" value="${escapeAttribute(val)}" data-filter-value="${escapeAttribute(val)}" ${selected.includes(val) ? 'checked' : ''} onchange="updateFilterSelection('${view}', '${column}', this.dataset.filterValue, this.checked)">
                    <span>${escapeHtml(val)}</span>
                </label>
            `).join('');
            if (filtered.length === 0) optionsContainer.innerHTML = '<div style="font-size: 0.8rem; padding: 10px; color: #999; text-align: center;">ไม่พบข้อมูล</div>';
        };

        renderOptions();

        searchInput.oninput = (e) => renderOptions(e.target.value);

    } catch (err) {
        console.error('Error fetching unique values:', err);
        optionsContainer.innerHTML = '<div style="font-size: 0.8rem; padding: 10px; color: red;">โหลดข้อมูลล้มเหลว</div>';
    }
}

function isClientSideItemFilterColumn(column) {
    return column === 'use_life' || column === 'acquis_value' || column === 'status';
}

function isActiveValue(value) {
    const normalizedValue = String(value ?? '').trim().toLowerCase();
    if (value === true || normalizedValue === 'true' || normalizedValue === 'active' || normalizedValue === '1') return true;
    if (value === false || normalizedValue === 'false' || normalizedValue === 'inactive' || normalizedValue === '0') return false;
    return Boolean(value);
}

function getActiveStatusLabel(value) {
    return isActiveValue(value) ? 'Active' : 'Inactive';
}

function getActiveStatusClass(value) {
    return isActiveValue(value) ? 'status-active' : 'status-inactive';
}

function getFilterRowValue(view, column, row) {
    if (view === 'items' && column === 'use_life') return getItemUseLife(row);
    if (view === 'items' && column === 'acquis_value') return formatAcquisValue(getItemAcquisValue(row), '');
    if (view === 'items' && column === 'status') return getActiveStatusLabel(row?.active);
    const dbColumn = getDbColumnFromViewColumn(view, column);
    return row ? row[dbColumn] : null;
}

function getNormalizedFilterValue(value) {
    return value === null || value === undefined || value === '' ? '(ว่าง)' : String(value);
}

function getComparableNumber(value) {
    if (value === null || value === undefined || value === '' || value === '(ว่าง)') return null;
    const numberValue = Number(String(value).replace(/,/g, '').trim());
    return Number.isFinite(numberValue) ? numberValue : null;
}

function compareNormalizedFilterValues(a, b) {
    if (a === '(ว่าง)' && b !== '(ว่าง)') return 1;
    if (a !== '(ว่าง)' && b === '(ว่าง)') return -1;

    const aNum = getComparableNumber(a);
    const bNum = getComparableNumber(b);
    if (aNum !== null && bNum !== null) return aNum - bNum;

    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

function itemPassesClientSideFilters(item, columns) {
    return columns.every(column => {
        const selected = activeFilters.items[column] || [];
        if (selected.length === 0) return true;
        return selected.includes(getNormalizedFilterValue(getFilterRowValue('items', column, item)));
    });
}

function normalizeSearchText(value) {
    return String(value ?? '').trim().toLowerCase();
}

function getItemMasterSearchText(item) {
    return [
        item?.asset_code,
        item?.inventory_code,
        item?.description,
        item?.category_id,
        getItemUseLife(item),
        formatAcquisValue(getItemAcquisValue(item), ''),
        item?.location_zone,
        getActiveStatusLabel(item?.active)
    ].map(normalizeSearchText).join(' ');
}

function itemMatchesItemSearchControls(item) {
    const searchCode = normalizeSearchText(document.getElementById('searchAssetInventory')?.value || '');
    const searchDescCat = normalizeSearchText(document.getElementById('searchItemDescCat')?.value || '');

    if (searchCode) {
        const codeText = [item?.asset_code, item?.inventory_code].map(normalizeSearchText).join(' ');
        if (!codeText.includes(searchCode)) return false;
    }

    if (searchDescCat) {
        const descCatText = [item?.description, item?.category_id].map(normalizeSearchText).join(' ');
        if (!descCatText.includes(searchDescCat)) return false;
    }

    return true;
}

function itemPassesItemFiltersExcept(item, excludedColumn) {
    return Object.entries(activeFilters.items || {}).every(([column, selected]) => {
        if (column === excludedColumn || !selected || selected.length === 0) return true;
        return selected.includes(getNormalizedFilterValue(getFilterRowValue('items', column, item)));
    });
}

function compareItemRowsByColumn(column, direction) {
    return (a, b) => {
        const aValue = getFilterRowValue('items', column, a);
        const bValue = getFilterRowValue('items', column, b);
        const aNormalized = getNormalizedFilterValue(aValue);
        const bNormalized = getNormalizedFilterValue(bValue);
        if (aNormalized === '(ว่าง)' && bNormalized !== '(ว่าง)') return 1;
        if (aNormalized !== '(ว่าง)' && bNormalized === '(ว่าง)') return -1;
        const baseResult = compareNormalizedFilterValues(aNormalized, bNormalized);
        return direction === 'desc' ? -baseResult : baseResult;
    };
}

async function fetchAllFilterColumnValues(view, column, tableName, dbColumn) {
    let allRows = [];
    let from = 0;
    const useFullRow = view === 'items';

    while (true) {
        let query = _supabase
            .from(tableName)
            .select(useFullRow ? '*' : dbColumn);

        query = useFullRow
            ? query.order('asset_code', { ascending: true })
            : query.order(dbColumn, { ascending: true });

        const { data, error } = await query.range(from, from + FILTER_FETCH_SIZE - 1);

        if (error) throw error;
        allRows = allRows.concat(data || []);
        if (!data || data.length < FILTER_FETCH_SIZE) break;
        from += FILTER_FETCH_SIZE;
    }

    return allRows;
}

function updateFilterSelection(view, column, value, isChecked) {
    if (!activeFilters[view][column]) activeFilters[view][column] = [];
    if (isChecked) {
        if (!activeFilters[view][column].includes(value)) activeFilters[view][column].push(value);
    } else {
        activeFilters[view][column] = activeFilters[view][column].filter(v => v !== value);
    }
}

function selectAllFilters(view, column, isAll) {
    const dropdown = document.getElementById(`filter-dropdown-${view}-${column}`);
    const checkboxes = dropdown.querySelectorAll('.filter-options input[type="checkbox"]');
    checkboxes.forEach(cb => {
        cb.checked = isAll;
        updateFilterSelection(view, column, cb.dataset.filterValue ?? cb.value, isAll);
    });
}

function applyFilter(view) {
    document.querySelectorAll('.filter-dropdown').forEach(d => d.classList.remove('show'));
    
    // Update filter button active state
    for (const column in activeFilters[view]) {
        const btn = document.getElementById(`filter-btn-${view}-${column}`);
        if (btn) {
            if (activeFilters[view][column].length > 0) btn.classList.add('active');
            else btn.classList.remove('active');
        }
    }

    // Load data with new filters
    if (view === 'inventory') loadInventoryData(0);
    else if (view === 'items') loadItemData(0);
    else if (view === 'category') loadCategoryData(0);
    else if (view === 'transactions') loadTransactionData(0);
    else if (view === 'users') loadUserData(0);
}

function clearFilter(view, column) {
    activeFilters[view][column] = [];
    const btn = document.getElementById(`filter-btn-${view}-${column}`);
    if (btn) btn.classList.remove('active');
    applyFilter(view);
}

// Helper to get Table Name
function getTableNameFromView(view) {
    const map = {
        inventory: 'Inventory Master',
        items: 'Item Master',
        category: 'Category Master',
        transactions: 'Transection Inventory',
        users: 'User Master'
    };
    return map[view];
}

// Helper to map UI column to DB column
function getDbColumnFromViewColumn(view, column) {
    const maps = {
        inventory: { id: 'id', zone: 'zone', desc: 'descriprion', status: 'active', remark: 'remark' },
        items: { asset: 'asset_code', inv: 'inventory_code', cat: 'category_id', desc: 'description', use_life: 'Use Life', acquis_value: 'Acquis Value', zone: 'location_zone', status: 'active' },
        category: { id: 'id', name: 'category_name' },
        transactions: { id: 'id', code: 'code', cat_id: 'id_category', asset: 'asset_code', inv: 'inventory_code', desc: 'description', type: 'movement_type', loc: 'to_location', status: 'status' },
        users: { id: 'id', name: 'name', login: 'user_id', rank: 'rank', status: 'status' }
    };
    return maps[view][column];
}

// Close dropdowns on outside click
window.addEventListener('click', () => {
    document.querySelectorAll('.filter-dropdown').forEach(d => d.classList.remove('show'));
});

document.addEventListener('click', (event) => {
    const modal = event.target;
    if (modal && modal.classList && modal.classList.contains('modal-overlay')) {
        closeModal(modal.id);
    }
});

document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const activeDialog = document.getElementById('appDialogOverlay');
    if (activeDialog && activeDialog.classList.contains('show')) return;

    const openModal = Array.from(document.querySelectorAll('.modal-overlay'))
        .reverse()
        .find(modal => modal.style.display === 'flex');
    if (openModal) closeModal(openModal.id);
});

// Helper: สร้างปุ่ม Pagination
function renderPagination(containerId, totalCount, currentPage, onPageChange, pageSize = PAGE_SIZE, showNumberedPages = false) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const totalPages = Math.ceil(totalCount / pageSize);
    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }

    const startItem = currentPage * pageSize + 1;
    const endItem = Math.min((currentPage + 1) * pageSize, totalCount);
    const pageButtons = showNumberedPages ? renderNumberedPageButtons(totalPages, currentPage, onPageChange) : '';

    let html = `
        <button class="pagination-btn" ${currentPage === 0 ? 'disabled' : ''} onclick="${onPageChange}(0)">First</button>
        <button class="pagination-btn" ${currentPage === 0 ? 'disabled' : ''} onclick="${onPageChange}(${currentPage - 1})">Prev</button>
        ${pageButtons}
        <span class="pagination-info">หน้า ${currentPage + 1} จาก ${totalPages} | แสดง ${startItem.toLocaleString()}-${endItem.toLocaleString()} จาก ${totalCount.toLocaleString()} รายการ</span>
        <button class="pagination-btn" ${currentPage >= totalPages - 1 ? 'disabled' : ''} onclick="${onPageChange}(${currentPage + 1})">Next</button>
        <button class="pagination-btn" ${currentPage >= totalPages - 1 ? 'disabled' : ''} onclick="${onPageChange}(${totalPages - 1})">Last</button>
    `;
    container.innerHTML = html;
}

function renderNumberedPageButtons(totalPages, currentPage, onPageChange) {
    const pages = [];
    const visibleRange = 2;

    for (let i = 0; i < totalPages; i++) {
        const isEdgePage = i === 0 || i === totalPages - 1;
        const isNearCurrent = Math.abs(i - currentPage) <= visibleRange;
        if (isEdgePage || isNearCurrent) {
            pages.push(i);
        }
    }

    let lastPage = -1;
    return pages.map(page => {
        const gap = page - lastPage > 1 ? '<span class="pagination-ellipsis">...</span>' : '';
        lastPage = page;
        return `${gap}<button class="pagination-btn pagination-number ${page === currentPage ? 'active' : ''}" onclick="${onPageChange}(${page})">${page + 1}</button>`;
    }).join('');
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

function capturePagePosition() {
    const tableWrapper = document.querySelector('#mainContent .table-wrapper');
    return {
        windowX: window.scrollX,
        windowY: window.scrollY,
        tableScrollLeft: tableWrapper ? tableWrapper.scrollLeft : 0,
        tableScrollTop: tableWrapper ? tableWrapper.scrollTop : 0
    };
}

function restorePagePosition(position) {
    if (!position) return;
    const restore = () => {
        window.scrollTo(position.windowX || 0, position.windowY || 0);
        const tableWrapper = document.querySelector('#mainContent .table-wrapper');
        if (tableWrapper) {
            tableWrapper.scrollLeft = position.tableScrollLeft || 0;
            tableWrapper.scrollTop = position.tableScrollTop || 0;
        }
    };

    requestAnimationFrame(restore);
    setTimeout(restore, 80);
}

async function reloadDataPreservingPosition(loader, page) {
    const position = capturePagePosition();
    await loader(page);
    restorePagePosition(position);
}

let appDialogResolver = null;

function initAppDialog() {
    if (document.getElementById('appDialogOverlay')) return;

    const dialog = document.createElement('div');
    dialog.id = 'appDialogOverlay';
    dialog.className = 'app-dialog-overlay';
    dialog.innerHTML = `
        <div class="app-dialog-card" role="dialog" aria-modal="true" aria-labelledby="appDialogTitle">
            <div class="app-dialog-accent"></div>
            <div class="app-dialog-body">
                <div id="appDialogIcon" class="app-dialog-icon"></div>
                <div class="app-dialog-copy">
                    <h3 id="appDialogTitle"></h3>
                    <p id="appDialogMessage"></p>
                </div>
            </div>
            <div class="app-dialog-actions">
                <button type="button" id="appDialogCancel" class="app-dialog-btn app-dialog-btn-secondary">ยกเลิก</button>
                <button type="button" id="appDialogConfirm" class="app-dialog-btn app-dialog-btn-primary">ตกลง</button>
            </div>
        </div>
    `;
    document.body.appendChild(dialog);

    document.getElementById('appDialogCancel').onclick = () => closeAppDialog(false);
    document.getElementById('appDialogConfirm').onclick = () => closeAppDialog(true);
    document.addEventListener('keydown', (event) => {
        const activeDialog = document.getElementById('appDialogOverlay');
        if (event.key === 'Escape' && activeDialog && activeDialog.classList.contains('show')) {
            closeAppDialog(false);
        }
    });
}

function closeAppDialog(result) {
    const dialog = document.getElementById('appDialogOverlay');
    if (!dialog) return;
    dialog.classList.remove('show');
    setTimeout(() => { dialog.style.display = 'none'; }, 180);
    if (appDialogResolver) {
        appDialogResolver(result);
        appDialogResolver = null;
    }
}

function showAppDialog({ type = 'info', title = 'แจ้งเตือน', message = '', confirm = false, confirmText = 'ตกลง', cancelText = 'ยกเลิก' }) {
    initAppDialog();

    const dialog = document.getElementById('appDialogOverlay');
    const icon = document.getElementById('appDialogIcon');
    const titleEl = document.getElementById('appDialogTitle');
    const messageEl = document.getElementById('appDialogMessage');
    const cancelBtn = document.getElementById('appDialogCancel');
    const confirmBtn = document.getElementById('appDialogConfirm');

    const iconMap = { success: '✓', error: '!', warning: '?', info: 'i' };
    dialog.className = `app-dialog-overlay show app-dialog-${type}`;
    icon.textContent = iconMap[type] || iconMap.info;
    icon.className = `app-dialog-icon app-dialog-icon-${type}`;
    titleEl.textContent = title;
    messageEl.textContent = message;
    cancelBtn.textContent = cancelText;
    confirmBtn.textContent = confirmText;
    cancelBtn.style.display = confirm ? 'inline-flex' : 'none';

    dialog.style.display = 'flex';
    setTimeout(() => confirmBtn.focus(), 0);

    return new Promise(resolve => {
        appDialogResolver = resolve;
    });
}

function showAppAlert(message, type = 'success', title = null) {
    const titleMap = {
        success: 'ดำเนินการสำเร็จ',
        error: 'ไม่สามารถดำเนินการได้',
        warning: 'โปรดตรวจสอบข้อมูล',
        info: 'แจ้งเตือน'
    };
    return showAppDialog({ type, title: title || titleMap[type] || titleMap.info, message, confirm: false });
}

function showAppConfirm(message, options = {}) {
    return showAppDialog({
        type: options.type || 'warning',
        title: options.title || 'ยืนยันการทำรายการ',
        message,
        confirm: true,
        confirmText: options.confirmText || 'ยืนยัน',
        cancelText: options.cancelText || 'ยกเลิก'
    });
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
            <div class="nav-item ${currentView === 'items' ? 'active' : ''}" onclick="switchView('items')"><img src="รูป/Item Icon.png" class="nav-icon"> Item Master</div>
            <div class="nav-item ${currentView === 'category' ? 'active' : ''}" onclick="switchView('category')"><img src="รูป/Category Icon.png" class="nav-icon"> Category Master</div>
            <div class="nav-item ${currentView === 'transactions' ? 'active' : ''}" onclick="switchView('transactions')"><img src="รูป/Transaction Icon.png" class="nav-icon"> Transaction Master</div>
            ${user.rank === 'Master' ? `<div class="nav-item ${currentView === 'users' ? 'active' : ''}" onclick="switchView('users')"><img src="รูป/User Icon.png" class="nav-icon"> User Master</div>` : ''}
            <div class="nav-item ${currentView === 'dashboard' ? 'active' : ''}" onclick="switchView('dashboard')"><img src="รูป/Dashboard Icon.png" class="nav-icon"> Dashboard</div>
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
            <h2 id="viewTitle"><img src="รูป/Item Icon.png" class="view-icon"> Item Master</h2>
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
    const titles = { 
        'dashboard': '<img src="รูป/Dashboard Icon.png" class="view-icon"> Dashboard', 
        'inventory': '<img src="รูป/Inventory Icon.png" class="view-icon"> Inventory Master', 
        'category': '<img src="รูป/Category Icon.png" class="view-icon"> Category Master', 
        'items': '<img src="รูป/Item Icon.png" class="view-icon"> Item Master', 
        'transactions': '<img src="รูป/Transaction Icon.png" class="view-icon"> Transaction Master', 
        'users': '<img src="รูป/User Icon.png" class="view-icon"> User Master' 
    };
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
                <thead>
                    <tr>
                        <th>${getFilterHeader('inventory', 'id', 'ID')}</th>
                        <th>${getFilterHeader('inventory', 'zone', 'Zone')}</th>
                        <th>${getFilterHeader('inventory', 'desc', 'Description')}</th>
                        <th>Quantity</th>
                        <th>Image</th>
                        <th>${getFilterHeader('inventory', 'status', 'Status')}</th>
                        <th>${getFilterHeader('inventory', 'remark', 'Remark')}</th>
                        ${hasPermission ? '<th>Actions</th>' : ''}
                    </tr>
                </thead>
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

    // Global Search
    const searchZone = document.getElementById('searchZone')?.value || '';
    const searchDesc = document.getElementById('searchDesc')?.value || '';

    tableBody.innerHTML = '<tr><td colspan="8" style="text-align:center;">กำลังโหลดข้อมูล...</td></tr>';
    try {
        let query = _supabase.from('Inventory Master').select('*', { count: 'exact' });
        
        // Apply Global Search
        if (searchZone) query = query.ilike('zone', `%${searchZone}%`);
        if (searchDesc) query = query.ilike('descriprion', `%${searchDesc}%`);

        // Apply Excel-style filters
        for (const col in activeFilters.inventory) {
            const vals = activeFilters.inventory[col];
            if (vals && vals.length > 0) {
                const dbCol = getDbColumnFromViewColumn('inventory', col);
                
                // Special handling for boolean 'active' status
                if (col === 'status') {
                    const mappedVals = vals.map(v => v === 'true');
                    query = query.in(dbCol, mappedVals);
                } else {
                    if (vals.includes('(ว่าง)')) {
                        const nonNulls = vals.filter(v => v !== '(ว่าง)');
                        if (nonNulls.length > 0) query = query.or(`${dbCol}.in.(${nonNulls.join(',')}),${dbCol}.is.null`);
                        else query = query.is(dbCol, null);
                    } else {
                        query = query.in(dbCol, vals);
                    }
                }
            }
        }

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
            <td><span class="status-badge ${getActiveStatusClass(item.active)}">${getActiveStatusLabel(item.active)}</span></td>
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

function getItemImage(item) {
    if (!item) return '';
    return item.Image || item.image || '';
}

function getBangkokDateParts(date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Bangkok',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date);
    return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
}

function getBangkokDateKey(date = new Date()) {
    const parts = getBangkokDateParts(date);
    return `${parts.year}-${parts.month}-${parts.day}`;
}

function getCurrentThaiYearTwoDigit(date = new Date()) {
    const parts = getBangkokDateParts(date);
    return (Number(parts.year) + 543) % 100;
}

function calculateUseLifeFromInventoryCode(inventoryCode, date = new Date()) {
    const code = String(inventoryCode ?? '').trim();
    if (!code || code.charAt(0).toUpperCase() === 'D' || code.length <= 8) return null;

    const inventoryYearText = code.slice(1, 3);
    if (!/^\d{2}$/.test(inventoryYearText)) return null;

    return getCurrentThaiYearTwoDigit(date) - Number(inventoryYearText);
}

function getStoredItemUseLife(item) {
    if (!item) return '';
    return item[USE_LIFE_DB_COLUMN] ?? item.use_life ?? item.useLife ?? '';
}

function setItemUseLife(item, value) {
    if (!item) return;
    item[USE_LIFE_DB_COLUMN] = value;
    if ('use_life' in item) item.use_life = value;
    if ('useLife' in item) item.useLife = value;
}

function getItemUseLife(item) {
    if (!item) return '';
    const calculatedUseLife = calculateUseLifeFromInventoryCode(item.inventory_code);
    return calculatedUseLife ?? getStoredItemUseLife(item);
}

function getItemAcquisValue(item) {
    if (!item) return '';
    return item['Acquis Value'] ?? item.acquis_value ?? item.acquisValue ?? '';
}

function getNumericAcquisValue(value) {
    if (value === null || value === undefined || value === '') return 0;
    const numericValue = Number(String(value).replace(/,/g, '').trim());
    return Number.isFinite(numericValue) ? numericValue : 0;
}

function formatAcquisValue(value, blankValue = '-') {
    if (value === null || value === undefined || value === '') return blankValue;

    const normalized = String(value).replace(/,/g, '').trim();
    if (normalized === '') return blankValue;

    const numericValue = Number(normalized);
    if (!Number.isFinite(numericValue)) return value;

    const decimalPart = normalized.includes('.') ? normalized.split('.')[1] : '';
    const decimalLength = decimalPart ? Math.min(decimalPart.length, 20) : 0;

    return numericValue.toLocaleString('en-US', {
        minimumFractionDigits: decimalLength,
        maximumFractionDigits: decimalLength
    });
}

function formatDisplayValue(value) {
    return value === null || value === undefined || value === '' ? '-' : value;
}

function getUseLifeLastSyncDate() {
    try {
        return localStorage.getItem(USE_LIFE_SYNC_STORAGE_KEY);
    } catch (err) {
        return null;
    }
}

function setUseLifeLastSyncDate(dateKey) {
    try {
        localStorage.setItem(USE_LIFE_SYNC_STORAGE_KEY, dateKey);
    } catch (err) {
        console.warn('Unable to save Use Life sync date:', err);
    }
}

function shouldUpdateStoredUseLife(item, calculatedUseLife) {
    const storedUseLife = getStoredItemUseLife(item);
    const storedNumber = getComparableNumber(storedUseLife);
    if (storedNumber !== null) return storedNumber !== calculatedUseLife;
    return String(storedUseLife ?? '').trim() !== String(calculatedUseLife);
}

function getCalculatedUseLifeUpdates(rows) {
    return (rows || []).reduce((updates, item) => {
        const calculatedUseLife = calculateUseLifeFromInventoryCode(item?.inventory_code);
        if (calculatedUseLife === null || !shouldUpdateStoredUseLife(item, calculatedUseLife)) return updates;

        setItemUseLife(item, calculatedUseLife);
        updates.push({
            assetCode: item.asset_code,
            inventoryCode: item.inventory_code,
            useLife: calculatedUseLife
        });
        return updates;
    }, []);
}

async function fetchAllItemRowsForUseLifeSync() {
    let allRows = [];
    let from = 0;

    while (true) {
        const { data, error } = await _supabase
            .from('Item Master')
            .select('*')
            .order('asset_code', { ascending: true })
            .range(from, from + FILTER_FETCH_SIZE - 1);

        if (error) throw error;
        allRows = allRows.concat(data || []);
        if (!data || data.length < FILTER_FETCH_SIZE) break;
        from += FILTER_FETCH_SIZE;
    }

    return allRows;
}

async function updateUseLifeRowsInDatabase(updates) {
    const chunkSize = 20;

    for (let i = 0; i < updates.length; i += chunkSize) {
        const chunk = updates.slice(i, i + chunkSize);
        await Promise.all(chunk.map(async update => {
            let query = _supabase
                .from('Item Master')
                .update({ [USE_LIFE_DB_COLUMN]: update.useLife });

            if (update.assetCode) query = query.eq('asset_code', update.assetCode);
            else if (update.inventoryCode) query = query.eq('inventory_code', update.inventoryCode);
            else return;

            const { error } = await query;
            if (error) throw error;
        }));
    }
}

async function syncItemUseLifeForToday() {
    const todayKey = getBangkokDateKey();
    if (getUseLifeLastSyncDate() === todayKey) return 0;
    if (useLifeSyncPromise) return useLifeSyncPromise;

    useLifeSyncPromise = (async () => {
        const rows = await fetchAllItemRowsForUseLifeSync();
        const updates = getCalculatedUseLifeUpdates(rows);

        if (updates.length > 0) {
            await updateUseLifeRowsInDatabase(updates);
        }

        setUseLifeLastSyncDate(todayKey);
        return updates.length;
    })().finally(() => {
        useLifeSyncPromise = null;
    });

    return useLifeSyncPromise;
}

function updateItemUseLifePreview() {
    const previewInput = document.getElementById('itm_use_life_preview');
    if (!previewInput) return;

    const inventoryCode = document.getElementById('itm_inv')?.value;
    const calculatedUseLife = calculateUseLifeFromInventoryCode(inventoryCode);
    previewInput.value = calculatedUseLife ?? '';
}

function escapeAttribute(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderImagePreviewHtml(url, altText = 'Image Preview') {
    if (url && url.trim() !== '') {
        return `<img src="${escapeAttribute(url)}" alt="${escapeAttribute(altText)}" class="image-preview">`;
    }
    return `<div class="image-preview-empty">(ไม่มีรูปภาพพรีวิว)</div>`;
}

function updateImagePreview(url, containerId = 'imagePreviewContainer') {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = renderImagePreviewHtml(url);
}

function updateItemImagePreview(url) {
    updateImagePreview(url, 'itemImagePreviewContainer');
}

function resizeImageFile(file, maxSize = 1200, quality = 0.82) {
    return new Promise((resolve, reject) => {
        if (!file.type.startsWith('image/')) {
            reject(new Error('กรุณาเลือกไฟล์รูปภาพเท่านั้น'));
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            const img = new Image();
            img.onload = () => {
                const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = () => reject(new Error('อ่านไฟล์รูปภาพไม่สำเร็จ'));
            img.src = reader.result;
        };
        reader.onerror = () => reject(new Error('อ่านไฟล์รูปภาพไม่สำเร็จ'));
        reader.readAsDataURL(file);
    });
}

async function handleItemImageUpload(input) {
    const file = input.files && input.files[0];
    if (!file) return;

    try {
        const imageData = await resizeImageFile(file);
        const imageInput = document.getElementById('itm_image');
        if (imageInput) imageInput.value = imageData;
        updateItemImagePreview(imageData);
    } catch (err) {
        showAppAlert(err.message, 'error');
        input.value = '';
    }
}

function clearItemImage() {
    const imageInput = document.getElementById('itm_image');
    const uploadInput = document.getElementById('itm_image_upload');
    if (imageInput) imageInput.value = '';
    if (uploadInput) uploadInput.value = '';
    updateItemImagePreview('');
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
                    <div class="form-group full-width" style="text-align: center;"><label>Image Preview</label><div id="imagePreviewContainer" class="image-preview-container">${renderImagePreviewHtml(item ? item.image : '')}</div></div>
                    <div class="form-group"><label>ID</label><input type="text" id="inv_id" value="${item ? item.id : ''}" ${mode !== 'add' ? 'disabled' : ''} required></div>
                    <div class="form-group"><label>Zone</label><input type="text" id="inv_zone" value="${item ? (item.zone || '') : ''}" ${mode === 'view' ? 'disabled' : ''}></div>
                    <div class="form-group"><label>Category ID</label><input type="text" id="inv_category" value="${item ? (item.id_category || '') : ''}" ${mode === 'view' ? 'disabled' : ''}></div>
                    <div class="form-group full-width"><label>Description</label><input type="text" id="inv_description" value="${item ? (item.descriprion || '') : ''}" ${mode === 'view' ? 'disabled' : ''} required></div>
                    <div class="form-group"><label>Quantity</label><input type="number" id="inv_quantity" value="${item ? (item.quantity || 0) : 0}" ${mode === 'view' ? 'disabled' : ''}></div>
                    <div class="form-group"><label>Status</label><select id="inv_active" ${mode === 'view' ? 'disabled' : ''}><option value="true" ${item && isActiveValue(item.active) ? 'selected' : ''}>Active</option><option value="false" ${item && !isActiveValue(item.active) ? 'selected' : ''}>Inactive</option></select></div>
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
        if (mode === 'add') { itemData.id = id; itemData.create_id = currentUser.id; itemData.created_at = new Date().toLocaleString('th-TH'); const { error } = await _supabase.from('Inventory Master').insert([itemData]); if (error) throw error; showAppAlert('เพิ่มรายการใหม่สำเร็จ!', 'success'); }
        else { const { error } = await _supabase.from('Inventory Master').update(itemData).eq('id', id); if (error) throw error; showAppAlert('แก้ไขข้อมูลสำเร็จ!', 'success'); }
        closeModal('inventoryModal'); await reloadDataPreservingPosition(loadInventoryData, currentInventoryPage);
    } catch (err) { showAppAlert('เกิดข้อผิดพลาด: ' + err.message, 'error'); } finally { hideLoading(); }
}

async function deleteInventoryItem(id) {
    if (!await showAppConfirm(`คุณแน่ใจหรือไม่ว่าต้องการลบรายการ ID: ${id}?`, { confirmText: 'ลบรายการ' })) return;
    showLoading();
    try { const { error } = await _supabase.from('Inventory Master').delete().eq('id', id); if (error) throw error; showAppAlert('ลบข้อมูลสำเร็จ!', 'success'); loadInventoryData(); }
    catch (err) { showAppAlert('ลบข้อมูลไม่สำเร็จ: ' + err.message, 'error'); } finally { hideLoading(); }
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
                <thead>
                    <tr>
                        <th>No.</th>
                        <th>${getFilterHeader('items', 'asset', 'Asset Code')}</th>
                        <th>${getFilterHeader('items', 'inv', 'Inventory Code')}</th>
                        <th>${getFilterHeader('items', 'desc', 'Description')}</th>
                        <th>${getFilterHeader('items', 'use_life', 'Use Life (year)')}</th>
                        <th>${getFilterHeader('items', 'acquis_value', 'Acquis Value')}</th>
                        <th>Image</th>
                        <th>${getFilterHeader('items', 'zone', 'Location Zone')}</th>
                        <th>${getFilterHeader('items', 'status', 'Status')}</th>
                        ${hasPermission ? '<th>Actions</th>' : ''}
                    </tr>
                </thead>
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

    // Global search
    const searchCode = document.getElementById('searchAssetInventory')?.value || '';
    const searchDescCat = document.getElementById('searchItemDescCat')?.value || '';

    const hasPermission = currentUser.rank === 'Master' || currentUser.rank === 'Admin';
    const colSpan = hasPermission ? 10 : 9;
    tableBody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align:center;">กำลังโหลดข้อมูล...</td></tr>`;
    try {
        try {
            await syncItemUseLifeForToday();
        } catch (syncErr) {
            console.warn('Use Life daily sync failed:', syncErr);
        }

        const itemSort = activeSort.items || {};
        const clientSideFilterColumns = Object.keys(activeFilters.items).filter(col =>
            isClientSideItemFilterColumn(col) && activeFilters.items[col]?.length > 0
        );
        const needsClientSideSort = itemSort.column && isClientSideItemFilterColumn(itemSort.column);
        const needsClientSideProcessing = clientSideFilterColumns.length > 0 || needsClientSideSort;

        const applyItemBaseFilters = (baseQuery) => {
            let query = baseQuery;

            if (searchCode) {
                query = query.or(`asset_code.ilike.%${searchCode}%,inventory_code.ilike.%${searchCode}%`);
            }
            if (searchDescCat) {
                query = query.or(`description.ilike.%${searchDescCat}%,category_id.ilike.%${searchDescCat}%`);
            }

            for (const col in activeFilters.items) {
                const vals = activeFilters.items[col];
                if (isClientSideItemFilterColumn(col) || !vals || vals.length === 0) continue;

                const dbCol = getDbColumnFromViewColumn('items', col);
                if (col === 'status') {
                    const mappedVals = vals.map(v => v === 'true');
                    query = query.in(dbCol, mappedVals);
                } else {
                    if (vals.includes('(ว่าง)')) {
                        const nonNulls = vals.filter(v => v !== '(ว่าง)');
                        if (nonNulls.length > 0) query = query.or(`${dbCol}.in.(${nonNulls.join(',')}),${dbCol}.is.null`);
                        else query = query.is(dbCol, null);
                    } else {
                        query = query.in(dbCol, vals);
                    }
                }
            }

            return query;
        };

        if (needsClientSideProcessing) {
            let allData = [];
            let from = 0;

            while (true) {
                const { data, error } = await applyItemBaseFilters(_supabase.from('Item Master').select('*'))
                    .order('asset_code', { ascending: true })
                    .range(from, from + FILTER_FETCH_SIZE - 1);

                if (error) throw error;
                allData = allData.concat(data || []);
                if (!data || data.length < FILTER_FETCH_SIZE) break;
                from += FILTER_FETCH_SIZE;
            }

            const filteredData = allData.filter(item => itemPassesClientSideFilters(item, clientSideFilterColumns));
            if (needsClientSideSort) {
                filteredData.sort(compareItemRowsByColumn(itemSort.column, itemSort.direction));
            }
            const pageStart = page * ITEM_PAGE_SIZE;
            const pageData = filteredData.slice(pageStart, pageStart + ITEM_PAGE_SIZE);
            itemMasterData = pageData;
            renderItemTable(pageData, filteredData.length);
            return;
        }

        let query = applyItemBaseFilters(_supabase.from('Item Master').select('*', { count: 'exact' }));
        const dbSortColumn = itemSort.column ? getDbColumnFromViewColumn('items', itemSort.column) : 'asset_code';
        const sortAscending = itemSort.direction !== 'desc';

        const { data, error, count } = await query
            .order(dbSortColumn, { ascending: sortAscending })
            .range(page * ITEM_PAGE_SIZE, (page + 1) * ITEM_PAGE_SIZE - 1);

        if (error) throw error;
        itemMasterData = data || [];
        renderItemTable(data, count);
    } catch (err) { console.error("Error loading item data:", err); tableBody.innerHTML = `<tr><td colspan="${colSpan}" style="text-align:center; color:red;">โหลดข้อมูลล้มเหลว</td></tr>`; }
}

function renderItemTable(data, totalCount) {
    const tableBody = document.getElementById('itemTableBody');
    if (!tableBody) return;
    tableBody.innerHTML = '';
    const hasPermission = currentUser.rank === 'Master' || currentUser.rank === 'Admin';
    
    data.forEach((item, index) => {
        const tr = document.createElement('tr');
        tr.onclick = () => {
            if (!isTextSelected()) openItemModal(item, 'view');
        };
        const imageUrl = getItemImage(item);
        const useLife = getItemUseLife(item);
        const acquisValue = getItemAcquisValue(item);
        const statusText = getActiveStatusLabel(item.active);
        const statusClass = getActiveStatusClass(item.active);
        const encodedAssetCode = encodeURIComponent(item.asset_code || '');
        const rowNumber = currentItemPage * ITEM_PAGE_SIZE + index + 1;
        tr.innerHTML = `
            <td class="row-number-cell">${rowNumber.toLocaleString()}</td><td>${item.asset_code}</td><td>${item.inventory_code || '-'}</td><td>${item.description || '-'}</td><td>${formatDisplayValue(useLife)}</td><td>${formatAcquisValue(acquisValue)}</td><td>${imageUrl ? `<img src="${escapeAttribute(imageUrl)}" alt="Item" class="table-thumb">` : '-'}</td><td>${item.location_zone || '-'}</td><td><span class="status-badge ${statusClass}">${statusText}</span></td>
            ${hasPermission ? `<td onclick="event.stopPropagation()"><div class="action-icons"><button class="icon-btn edit-icon" onclick="openItemModalFromTable('${encodedAssetCode}', 'edit')">✎</button><button class="icon-btn delete-icon" onclick="deleteItemRecord('${item.asset_code}')">🗑</button></div></td>` : ''}
        `;
        tableBody.appendChild(tr);
    });

    renderPagination('itemPagination', totalCount, currentItemPage, 'loadItemData', ITEM_PAGE_SIZE, true);
}

function openItemModalFromTable(encodedAssetCode, mode) {
    const assetCode = decodeURIComponent(encodedAssetCode);
    const item = itemMasterData.find(row => row.asset_code === assetCode);
    if (item) openItemModal(item, mode);
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
    const imageValue = getItemImage(item);
    const useLifeValue = getItemUseLife(item);
    const acquisValue = getItemAcquisValue(item);
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>${mode === 'add' ? 'Add New Item' : (mode === 'edit' ? 'Edit Item' : 'Item Detail')}</h3>
                <button class="close-modal-btn" onclick="closeModal('itemModal')">✕</button>
            </div>
            <form id="itemForm">
                <div class="modal-grid">
                    <div class="form-group"><label>Asset Code</label><input type="text" id="itm_asset" value="${item ? item.asset_code : ''}" ${mode !== 'add' ? 'disabled' : ''} required></div>
                    <div class="form-group"><label>Inventory Code</label><input type="text" id="itm_inv" value="${item ? (item.inventory_code || '') : ''}" ${!isEditMode ? 'disabled' : ''} oninput="updateItemUseLifePreview()"></div>
                    <div class="form-group"><label>Category ID</label><input type="text" id="itm_cat" value="${item ? (item.category_id || '') : ''}" ${!isEditMode ? 'disabled' : ''}></div>
                    <div class="form-group"><label>Use Life</label><input type="text" id="itm_use_life_preview" value="${escapeAttribute(useLifeValue)}" disabled></div>
                    <div class="form-group"><label>Acquis Value</label><input type="text" value="${escapeAttribute(formatAcquisValue(acquisValue))}" disabled></div>
                    <div class="form-group full-width"><label>Description</label><input type="text" id="itm_desc" value="${item ? (item.description || '') : ''}" ${!isEditMode ? 'disabled' : ''} required></div>
                    <div class="form-group full-width"><label>Image</label><div id="itemImagePreviewContainer" class="image-preview-container">${renderImagePreviewHtml(imageValue, 'Item Image')}</div><input type="hidden" id="itm_image" value="${escapeAttribute(imageValue)}">${isEditMode ? `<div class="image-upload-row"><input type="file" id="itm_image_upload" accept="image/*" onchange="handleItemImageUpload(this)"><button type="button" class="btn-clear-image" onclick="clearItemImage()">ล้างรูป</button></div>` : ''}</div>
                    <div class="form-group"><label>Location Zone</label><input type="text" id="itm_zone" value="${item ? (item.location_zone || '') : ''}" ${!isEditMode ? 'disabled' : ''}></div>
                    <div class="form-group"><label>Status</label><select id="itm_active" ${!isEditMode ? 'disabled' : ''}><option value="true" ${item && isActiveValue(item.active) ? 'selected' : ''}>Active</option><option value="false" ${item && !isActiveValue(item.active) ? 'selected' : ''}>Inactive</option></select></div>
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
    const itemData = { inventory_code: document.getElementById('itm_inv').value, category_id: document.getElementById('itm_cat').value, description: document.getElementById('itm_desc').value, Image: document.getElementById('itm_image').value, location_zone: document.getElementById('itm_zone').value, active: document.getElementById('itm_active').value === 'true', edit_id: currentUser.id, edit_at: new Date().toLocaleString('th-TH') };
    const calculatedUseLife = calculateUseLifeFromInventoryCode(itemData.inventory_code);
    if (calculatedUseLife !== null) itemData[USE_LIFE_DB_COLUMN] = calculatedUseLife;
    try {
        if (mode === 'add') {
            itemData.asset_code = assetCode;
            itemData.create_id = currentUser.id;
            itemData.created_at = new Date().toLocaleString('th-TH');
            const { error } = await _supabase.from('Item Master').insert([itemData]);
            if (error) throw error;
            
            // Sync with Inventory Master
            if (itemData.location_zone && itemData.description) {
                await updateInventoryStock(itemData.location_zone, itemData.description, 1, itemData.category_id, itemData.Image);
            }
            
            showAppAlert('เพิ่มไอเทมใหม่สำเร็จ!', 'success');
        } else {
            const { error } = await _supabase.from('Item Master').update(itemData).eq('asset_code', assetCode);
            if (error) throw error;
            showAppAlert('แก้ไขไอเทมสำเร็จ!', 'success');
        }
        closeModal('itemModal'); await reloadDataPreservingPosition(loadItemData, currentItemPage);
    } catch (err) { showAppAlert('เกิดข้อผิดพลาด: ' + err.message, 'error'); } finally { hideLoading(); }
}

async function deleteItemRecord(assetCode) {
    if (!await showAppConfirm(`คุณแน่ใจหรือไม่ว่าต้องการลบไอเทม Asset Code: ${assetCode}?`, { confirmText: 'ลบไอเทม' })) return;
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

        showAppAlert('ลบไอเทมสำเร็จ!', 'success');
        loadItemData();
    } catch (err) { showAppAlert('ลบไอเทมไม่สำเร็จ: ' + err.message, 'error'); } finally { hideLoading(); }
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
                <thead>
                    <tr>
                        <th>${getFilterHeader('category', 'id', 'ID')}</th>
                        <th>${getFilterHeader('category', 'name', 'Category Name')}</th>
                        ${hasPermission ? '<th>Actions</th>' : ''}
                    </tr>
                </thead>
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

    // Global search
    const searchId = document.getElementById('searchCatId')?.value || '';
    const searchName = document.getElementById('searchCatName')?.value || '';

    tableBody.innerHTML = '<tr><td colspan="3" style="text-align:center;">กำลังโหลดข้อมูล...</td></tr>';
    try {
        let query = _supabase.from('Category Master').select('*', { count: 'exact' });
        
        // Apply Global Search
        if (searchId) query = query.ilike('id', `%${searchId}%`);
        if (searchName) query = query.ilike('category_name', `%${searchName}%`);

        // Apply Excel-style filters
        for (const col in activeFilters.category) {
            const vals = activeFilters.category[col];
            if (vals && vals.length > 0) {
                const dbCol = getDbColumnFromViewColumn('category', col);
                if (vals.includes('(ว่าง)')) {
                    const nonNulls = vals.filter(v => v !== '(ว่าง)');
                    if (nonNulls.length > 0) query = query.or(`${dbCol}.in.(${nonNulls.join(',')}),${dbCol}.is.null`);
                    else query = query.is(dbCol, null);
                } else {
                    query = query.in(dbCol, vals);
                }
            }
        }

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
        if (mode === 'add') { catData.id = id; catData.create_id = currentUser.id; catData.created_at = new Date().toLocaleString('th-TH'); const { error } = await _supabase.from('Category Master').insert([catData]); if (error) throw error; showAppAlert('เพิ่มหมวดหมู่ใหม่สำเร็จ!', 'success'); }
        else { const { error } = await _supabase.from('Category Master').update(catData).eq('id', id); if (error) throw error; showAppAlert('แก้ไขหมวดหมู่สำเร็จ!', 'success'); }
        closeModal('categoryModal'); await reloadDataPreservingPosition(loadCategoryData, currentCategoryPage);
    } catch (err) { showAppAlert('เกิดข้อผิดพลาด: ' + err.message, 'error'); } finally { hideLoading(); }
}

async function deleteCategoryItem(id) {
    if (!await showAppConfirm(`คุณแน่ใจหรือไม่ว่าต้องการลบหมวดหมู่ ID: ${id}?`, { confirmText: 'ลบหมวดหมู่' })) return;
    showLoading();
    try { const { error } = await _supabase.from('Category Master').delete().eq('id', id); if (error) throw error; showAppAlert('ลบหมวดหมู่สำเร็จ!', 'success'); loadCategoryData(); }
    catch (err) { showAppAlert('ลบหมวดหมู่ไม่สำเร็จ: ' + err.message, 'error'); } finally { hideLoading(); }
}

// --- Transection Master View ---
function getFilterHeader(view, column, label) {
    const canSort = view === 'items' && (column === 'use_life' || column === 'acquis_value');
    return `
        <div class="filter-header">
            <span>${label}${getSortIndicator(view, column)}</span>
            <button id="filter-btn-${view}-${column}" class="filter-btn" onclick="toggleFilterDropdown(event, '${view}', '${column}')">▼</button>
            <div id="filter-dropdown-${view}-${column}" class="filter-dropdown" onclick="event.stopPropagation()">
                ${canSort ? `
                <div class="filter-sort-actions">
                    <button type="button" onclick="setSort('${view}', '${column}', 'asc')">เรียงจากน้อยไปมาก</button>
                    <button type="button" onclick="setSort('${view}', '${column}', 'desc')">เรียงจากมากไปน้อย</button>
                    <button type="button" onclick="clearSort('${view}', '${column}')">ล้างการเรียง</button>
                </div>
                ` : ''}
                <input type="text" class="filter-search" placeholder="Search...">
                <div style="margin: 5px 0; display: flex; gap: 10px;">
                    <a href="javascript:void(0)" onclick="selectAllFilters('${view}', '${column}', true)" style="font-size: 0.7rem;">Select All</a>
                    <a href="javascript:void(0)" onclick="selectAllFilters('${view}', '${column}', false)" style="font-size: 0.7rem;">Deselect All</a>
                </div>
                <div class="filter-options"></div>
                <div class="filter-actions">
                    <button class="btn-filter-clear" onclick="clearFilter('${view}', '${column}')">Clear</button>
                    <button class="btn-filter-apply" onclick="applyFilter('${view}')">Apply</button>
                </div>
            </div>
        </div>
    `;
}

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
                ${hasPermission ? `
                    <button class="btn-add" style="background: linear-gradient(135deg, #27ae60 0%, #2ecc71 100%);" onclick="exportTransactionsToExcel()"><span>📊</span> Export to Excel</button>
                    <button class="btn-add" style="background: linear-gradient(135deg, #0984e3 0%, #3a7bd5 100%);" onclick="openTransactionModal(null, 'transfer')"><span>🔄</span> ย้ายของ</button>
                    <button class="btn-add" onclick="openTransactionModal(null, 'add')"><span>➕</span> Add Transection</button>
                ` : ''}
            </div>
        </div>
        <div class="table-wrapper">
            <table>
                <thead>
                    <tr>
                        <th>${getFilterHeader('transactions', 'id', 'ID')}</th>
                        <th>${getFilterHeader('transactions', 'code', 'Code')}</th>
                        <th>${getFilterHeader('transactions', 'cat_id', 'Category ID')}</th>
                        <th>${getFilterHeader('transactions', 'asset', 'Asset Code')}</th>
                        <th>${getFilterHeader('transactions', 'inv', 'Inventory Code')}</th>
                        <th>${getFilterHeader('transactions', 'desc', 'Description')}</th>
                        <th>${getFilterHeader('transactions', 'type', 'Type')}</th>
                        <th>${getFilterHeader('transactions', 'loc', 'To Location')}</th>
                        <th>${getFilterHeader('transactions', 'status', 'Status')}</th>
                        ${hasPermission ? '<th>Actions</th>' : ''}
                    </tr>
                </thead>
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

    // Existing search (global)
    const searchCode = document.getElementById('searchTransCode')?.value || '';
    const searchAsset = document.getElementById('searchTransAsset')?.value || '';

    tableBody.innerHTML = '<tr><td colspan="10" style="text-align:center;">กำลังโหลดข้อมูล...</td></tr>';
    try {
        let query = _supabase.from('Transection Inventory').select('*', { count: 'exact' });
        
        // Apply global searches
        if (searchCode) query = query.ilike('code', `%${searchCode}%`);
        if (searchAsset) {
            query = query.or(`asset_code.ilike.%${searchAsset}%,inventory_code.ilike.%${searchAsset}%`);
        }

        // Apply Excel-style filters
        for (const col in activeFilters.transactions) {
            const vals = activeFilters.transactions[col];
            if (vals && vals.length > 0) {
                const dbCol = getDbColumnFromViewColumn('transactions', col);
                // Handle nulls
                if (vals.includes('(ว่าง)')) {
                    const nonNulls = vals.filter(v => v !== '(ว่าง)');
                    if (nonNulls.length > 0) {
                        query = query.or(`${dbCol}.in.(${nonNulls.join(',')}),${dbCol}.is.null`);
                    } else {
                        query = query.is(dbCol, null);
                    }
                } else {
                    query = query.in(dbCol, vals);
                }
            }
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
                            <option value="จอง" ${item && item.status === 'จอง' ? 'selected' : ''}>จอง</option>
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
            showAppAlert(`${mode === 'transfer' ? 'ย้ายของ' : 'เพิ่มรายการ'} สำเร็จ!`, 'success');
        } else {
            const oldItem = editingTransactionItem;
            const updateData = { ...commonData, id_category: document.getElementById('edit_itm_id_cat').value, category: document.getElementById('edit_itm_cat_name').value, asset_code: document.getElementById('edit_itm_asset').value, inventory_code: document.getElementById('edit_itm_inv').value, description: document.getElementById('edit_itm_desc').value };
            const { error } = await _supabase.from('Transection Inventory').update(updateData).eq('id', oldItem.id);
            if (error) throw error;
            if (status === 'คืนของแล้ว' && oldItem.status !== 'คืนของแล้ว') {
                await updateItemMasterStatus(updateData.asset_code, updateData.inventory_code, true);
                await updateInventoryStock(fromZone, updateData.description, 1, updateData.id_category);
            } else if (status === 'จอง' && oldItem.status !== 'จอง') {
                await updateItemMasterStatus(updateData.asset_code, updateData.inventory_code, false);
            } else if (status !== 'คืนของแล้ว' && oldItem.status === 'คืนของแล้ว') {
                await updateItemMasterStatus(updateData.asset_code, updateData.inventory_code, false);
                await updateInventoryStock(fromZone, updateData.description, -1, updateData.id_category);
            }
            showAppAlert('แก้ไขรายการและปรับยอดเรียบร้อย!', 'success');
        }
        closeModal('transactionModal'); await reloadDataPreservingPosition(loadTransactionData, currentTransactionPage);
    } catch (err) { showAppAlert('เกิดข้อผิดพลาด: ' + err.message, 'error'); } finally { hideLoading(); }
}

async function deleteTransactionRecord(id) {
    if (!await showAppConfirm('คุณแน่ใจหรือไม่ว่าต้องการลบรายการนี้?', { confirmText: 'ลบรายการ' })) return;
    showLoading();
    try { const { error } = await _supabase.from('Transection Inventory').delete().eq('id', id); if (error) throw error; showAppAlert('ลบรายการสำเร็จ!', 'success'); if (document.getElementById('transactionModal').style.display === 'flex') closeModal('transactionModal'); loadTransactionData(); }
    catch (err) { showAppAlert('ลบข้อมูลไม่สำเร็จ: ' + err.message, 'error'); } finally { hideLoading(); }
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
                <thead>
                    <tr>
                        <th>${getFilterHeader('users', 'id', 'ID')}</th>
                        <th>${getFilterHeader('users', 'name', 'Name')}</th>
                        <th>${getFilterHeader('users', 'login', 'User ID')}</th>
                        <th>Password</th>
                        <th>${getFilterHeader('users', 'rank', 'Rank')}</th>
                        <th>${getFilterHeader('users', 'status', 'Status')}</th>
                        <th>Actions</th>
                    </tr>
                </thead>
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

    // Global search
    const searchId = document.getElementById('searchUserId')?.value || '';
    const searchName = document.getElementById('searchUserName')?.value || '';

    tableBody.innerHTML = '<tr><td colspan="7" style="text-align:center;">กำลังโหลดข้อมูล...</td></tr>';
    try { 
        let query = _supabase.from('User Master').select('*', { count: 'exact' });
        
        // Apply Global Search
        if (searchId) query = query.ilike('user_id', `%${searchId}%`);
        if (searchName) query = query.ilike('name', `%${searchName}%`);

        // Apply Excel-style filters
        for (const col in activeFilters.users) {
            const vals = activeFilters.users[col];
            if (vals && vals.length > 0) {
                const dbCol = getDbColumnFromViewColumn('users', col);
                if (col === 'status') {
                    const mappedVals = vals.map(v => v === 'true');
                    query = query.in(dbCol, mappedVals);
                } else {
                    if (vals.includes('(ว่าง)')) {
                        const nonNulls = vals.filter(v => v !== '(ว่าง)');
                        if (nonNulls.length > 0) query = query.or(`${dbCol}.in.(${nonNulls.join(',')}),${dbCol}.is.null`);
                        else query = query.is(dbCol, null);
                    } else {
                        query = query.in(dbCol, vals);
                    }
                }
            }
        }

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
        if (mode === 'add') { userData.id = id; userData.create_name = currentUser.name; userData.created_at = new Date().toLocaleString('th-TH'); const { error } = await _supabase.from('User Master').insert([userData]); if (error) throw error; showAppAlert('เพิ่มผู้ใช้ใหม่สำเร็จ!', 'success'); }
        else { const { error } = await _supabase.from('User Master').update(userData).eq('id', id); if (error) throw error; showAppAlert('แก้ไขข้อมูลผู้ใช้สำเร็จ!', 'success'); }
        closeModal('userModal'); await reloadDataPreservingPosition(loadUserData, currentUserPage);
    } catch (err) { showAppAlert('เกิดข้อผิดพลาด: ' + err.message, 'error'); } finally { hideLoading(); }
}

async function deleteUserItem(id) {
    if (id === currentUser.id) { showAppAlert('ไม่สามารถลบบัญชีที่กำลังใช้งานอยู่ได้', 'warning'); return; }
    if (!await showAppConfirm(`คุณแน่ใจหรือไม่ว่าต้องการลบผู้ใช้ ID: ${id}?`, { confirmText: 'ลบผู้ใช้' })) return;
    showLoading();
    try { const { error } = await _supabase.from('User Master').delete().eq('id', id); if (error) throw error; showAppAlert('ลบผู้ใช้สำเร็จ!', 'success'); loadUserData(); }
    catch (err) { showAppAlert('ลบผู้ใช้ไม่สำเร็จ: ' + err.message, 'error'); } finally { hideLoading(); }
}

function closeModal(modalId) { document.getElementById(modalId).style.display = 'none'; }
function logout() { localStorage.removeItem('wms_user'); location.reload(); }

// --- Dashboard View Implementation ---
let dashboardData = {};
let dashboardItemRows = [];
let activePopupZoneName = '';
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

function getLocationZonePrefix(zone) {
    const normalizedZone = String(zone || '').trim();
    if (!normalizedZone) return 'Unknown';
    return normalizedZone.slice(0, 2).toUpperCase();
}

function getItemCategoryId(row) {
    return String(row?.category_id || '').trim() || 'Unknown';
}

const DASHBOARD_USE_LIFE_GROUP_LABELS = ['0-5 ปี', '6-10 ปี', '11-15 ปี', '16-20 ปี', '20 ปีขึ้นไป'];

function getUseLifeGroupLabel(value) {
    const numericValue = Number(String(value ?? '').replace(/,/g, '').trim());
    if (!Number.isFinite(numericValue)) return null;
    if (numericValue <= 5) return '0-5 ปี';
    if (numericValue <= 10) return '6-10 ปี';
    if (numericValue <= 15) return '11-15 ปี';
    if (numericValue <= 20) return '16-20 ปี';
    return '20 ปีขึ้นไป';
}

function formatCompactDashboardNumber(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return '-';

    const absValue = Math.abs(numericValue);
    const formatUnit = (divisor, suffix) => {
        const compactValue = numericValue / divisor;
        const digits = Math.abs(compactValue) >= 10 ? 0 : 1;
        return `${compactValue.toFixed(digits).replace(/\.0$/, '')} ${suffix}`;
    };

    if (absValue >= 1000000000) return formatUnit(1000000000, 'B');
    if (absValue >= 1000000) return formatUnit(1000000, 'M');
    if (absValue >= 1000) return formatUnit(1000, 'K');
    return numericValue.toLocaleString('en-US');
}

function getDashboardSuggestedMax(values, multiplier = 1.18) {
    const maxValue = Math.max(...values.map(value => Number(value) || 0));
    if (!Number.isFinite(maxValue) || maxValue <= 0) return undefined;
    return Math.ceil(maxValue * multiplier);
}

const DASHBOARD_BAR_VALUE_LABEL_PLUGIN = {
    id: 'dashboardBarValueLabel',
    afterDatasetsDraw(chart, _args, options) {
        const { ctx, chartArea } = chart;
        const formatter = options?.formatter || formatCompactDashboardNumber;
        const isHorizontal = chart.options.indexAxis === 'y';

        ctx.save();
        ctx.fillStyle = options?.color || '#334155';
        ctx.strokeStyle = options?.strokeColor || 'rgba(255, 255, 255, 0.96)';
        ctx.lineWidth = options?.strokeWidth || 4;
        ctx.lineJoin = 'round';
        ctx.font = '800 11px Kanit, sans-serif';
        ctx.textBaseline = 'middle';

        chart.data.datasets.forEach((dataset, datasetIndex) => {
            const meta = chart.getDatasetMeta(datasetIndex);
            if (meta.hidden) return;

            meta.data.forEach((bar, index) => {
                const rawValue = dataset.data[index];
                const numericValue = Number(rawValue);
                if (!Number.isFinite(numericValue) || numericValue === 0) return;

                const label = formatter(numericValue);
                const labelWidth = ctx.measureText(label).width;

                if (isHorizontal) {
                    ctx.textAlign = 'left';
                    const rightEdge = Math.max(bar.x, bar.base || chartArea.left);
                    const labelX = Math.min(rightEdge + 8, chartArea.right - labelWidth);
                    ctx.strokeText(label, labelX, bar.y);
                    ctx.fillText(label, labelX, bar.y);
                } else {
                    ctx.textAlign = 'center';
                    const labelY = Math.max(bar.y - 12, chartArea.top + 10);
                    ctx.strokeText(label, bar.x, labelY);
                    ctx.fillText(label, bar.x, labelY);
                }
            });
        });

        ctx.restore();
    }
};

const DASHBOARD_PIE_PERCENT_LABEL_PLUGIN = {
    id: 'dashboardPiePercentLabel',
    afterDatasetsDraw(chart, _args, options) {
        const { ctx } = chart;
        const dataset = chart.data.datasets[0];
        if (!dataset) return;

        const values = dataset.data.map(value => Number(value) || 0);
        const total = values.reduce((sum, value) => sum + value, 0);
        if (total <= 0) return;

        ctx.save();
        ctx.fillStyle = options?.color || '#ffffff';
        ctx.strokeStyle = options?.strokeColor || 'rgba(15, 23, 42, 0.35)';
        ctx.lineWidth = options?.strokeWidth || 3;
        ctx.lineJoin = 'round';
        ctx.font = '800 13px Kanit, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const meta = chart.getDatasetMeta(0);
        meta.data.forEach((arc, index) => {
            const value = values[index];
            if (value <= 0) return;

            const percent = (value / total) * 100;
            const label = `${percent >= 10 ? percent.toFixed(0) : percent.toFixed(1)}%`;
            const position = arc.tooltipPosition();
            ctx.strokeText(label, position.x, position.y);
            ctx.fillText(label, position.x, position.y);
        });

        ctx.restore();
    }
};

async function renderDashboardView() {
    const mainContent = document.getElementById('mainContent');
    const cfg = layoutConfigs[currentLayout];
    
    // Fetch data including new stats
    await fetchDashboardData();
    
    const stats = dashboardStats;

    mainContent.innerHTML = `
        <!-- Main Stats Row -->
        <div class="dashboard-stats-grid">
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

            <div class="stat-card modern-card" style="background: linear-gradient(135deg, #0f766e 0%, #14b8a6 100%);">
                <div class="card-icon">💰</div>
                <div class="card-info">
                    <span class="card-label">Acquis Value รวม</span>
                    <div class="card-value">${formatAcquisValue(stats.totalAcquisValue, '0')} <span class="unit">Value</span></div>
                </div>
                <div class="card-progress"><div class="progress-bar" style="width: 100%"></div></div>
            </div>
        </div>

        <!-- Visual Analytics Row -->
        <div class="analytics-row">
            <!-- Column 1: Transaction Status Chart -->
            <div class="analytics-card">
                <h3>📊 Transaction Status</h3>
                <div class="chart-container">
                    <canvas id="statusChart"></canvas>
                </div>
            </div>

            <!-- Column 2: Grouped Zones Bar Chart -->
            <div class="analytics-card">
                <h3>🏘️ จำนวนของแยกตาม Zone</h3>
                <div class="chart-container">
                    <canvas id="zoneChart"></canvas>
                </div>
            </div>

            <!-- Column 3: Category Summary Chart -->
            <div class="analytics-card">
                <h3>📁 Category ID Summary</h3>
                <div class="chart-container">
                    <canvas id="categoryChart"></canvas>
                </div>
            </div>

            <!-- Column 4: Use Life Groups -->
            <div class="analytics-card">
                <h3>🕒 Use Life (Year)</h3>
                <div class="chart-container">
                    <canvas id="useLifeChart"></canvas>
                </div>
            </div>

            <!-- Full Row: Acquis Value by Category -->
            <div class="analytics-card analytics-card-wide">
                <h3>💰 Acquis Value by Category</h3>
                <div class="chart-container chart-container-wide">
                    <canvas id="acquisCategoryChart"></canvas>
                </div>
            </div>
        </div>

        <div class="dashboard-controls">
            <div class="dashboard-layout-selector">
                ${Object.keys(layoutConfigs).map(key => `
                    <button class="layout-btn ${currentLayout === key ? 'active' : ''}" onclick="changeLayout('${key}')">${layoutConfigs[key].label}</button>
                `).join('')}
            </div>
            <div class="legend-card">
                <div style="display:flex; align-items:center; gap:8px;"><span style="width:12px; height:12px; background:#d9d9d9; border-radius:3px;"></span> 0</div>
                <div style="display:flex; align-items:center; gap:8px;"><span style="width:12px; height:12px; background:#7fd3ff; border-radius:3px;"></span> 1-10</div>
                <div style="display:flex; align-items:center; gap:8px;"><span style="width:12px; height:12px; background:#97d055; border-radius:3px;"></span> 11-20</div>
                <div style="display:flex; align-items:center; gap:8px;"><span style="width:12px; height:12px; background:#fff200; border-radius:3px;"></span> 21-30</div>
                <div style="display:flex; align-items:center; gap:8px;"><span style="width:12px; height:12px; background:#e566e7; border-radius:3px;"></span> 31+</div>
            </div>
        </div>

        <div class="layout-viewport">
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
    const ctxAcquisCategory = document.getElementById('acquisCategoryChart').getContext('2d');
    const ctxUseLife = document.getElementById('useLifeChart').getContext('2d');

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
            interaction: { mode: 'nearest', intersect: false },
            hover: { mode: 'nearest', intersect: false },
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
                label: 'Location Zone Count',
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
            interaction: { mode: 'nearest', intersect: false, axis: 'y' },
            hover: { mode: 'nearest', intersect: false },
            layout: { padding: { right: 42 } },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: context => `${context.label}: ${Number(context.parsed.x || 0).toLocaleString()} รายการ`
                    },
                    bodyFont: { family: 'Kanit' },
                    titleFont: { family: 'Kanit' }
                },
                dashboardBarValueLabel: { formatter: formatCompactDashboardNumber }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    suggestedMax: getDashboardSuggestedMax(zoneData),
                    grid: { display: false },
                    ticks: { font: { family: 'Kanit' }, callback: value => formatCompactDashboardNumber(value) }
                },
                y: { grid: { display: false }, ticks: { font: { family: 'Kanit', weight: 'bold' } } }
            }
        },
        plugins: [DASHBOARD_BAR_VALUE_LABEL_PLUGIN]
    });

    // 3. Category ID Summary Chart from Item Master category_id (Bar)
    const catLabels = Object.keys(stats.categoryStats).sort((a,b) => stats.categoryStats[b] - stats.categoryStats[a]).slice(0, 10);
    const catData = catLabels.map(l => stats.categoryStats[l]);

    new Chart(ctxCategory, {
        type: 'bar',
        data: {
            labels: catLabels,
            datasets: [{
                label: 'Category ID Count',
                data: catData,
                backgroundColor: '#3a7bd5',
                borderRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'nearest', intersect: false, axis: 'x' },
            hover: { mode: 'nearest', intersect: false },
            layout: { padding: { top: 22 } },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: context => `${context.label}: ${Number(context.parsed.y || 0).toLocaleString()} รายการ`
                    },
                    bodyFont: { family: 'Kanit' },
                    titleFont: { family: 'Kanit' }
                },
                dashboardBarValueLabel: { formatter: formatCompactDashboardNumber }
            },
            scales: {
                x: { grid: { display: false }, ticks: { font: { family: 'Kanit', size: 10 } } },
                y: {
                    beginAtZero: true,
                    suggestedMax: getDashboardSuggestedMax(catData),
                    grid: { color: '#f0f0f0' },
                    ticks: { font: { family: 'Kanit' }, callback: value => formatCompactDashboardNumber(value) }
                }
            }
        },
        plugins: [DASHBOARD_BAR_VALUE_LABEL_PLUGIN]
    });

    // 4. Acquis Value by Category from Item Master (Bar)
    const acquisCategoryStats = stats.categoryAcquisStats || {};
    const acquisLabels = Object.keys(acquisCategoryStats)
        .sort((a, b) => acquisCategoryStats[b] - acquisCategoryStats[a]);
    const acquisData = acquisLabels.map(label => acquisCategoryStats[label]);

    new Chart(ctxAcquisCategory, {
        type: 'bar',
        data: {
            labels: acquisLabels,
            datasets: [{
                label: 'Acquis Value',
                data: acquisData,
                backgroundColor: '#0f766e',
                borderRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'nearest', intersect: false, axis: 'x' },
            hover: { mode: 'nearest', intersect: false },
            layout: { padding: { top: 24 } },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: context => `Acquis Value: ${formatAcquisValue(context.parsed.y, '0')}`
                    },
                    bodyFont: { family: 'Kanit' },
                    titleFont: { family: 'Kanit' }
                },
                dashboardBarValueLabel: { formatter: formatCompactDashboardNumber }
            },
            scales: {
                x: { grid: { display: false }, ticks: { font: { family: 'Kanit', size: 10 } } },
                y: {
                    beginAtZero: true,
                    suggestedMax: getDashboardSuggestedMax(acquisData),
                    grid: { color: '#f0f0f0' },
                    ticks: {
                        font: { family: 'Kanit' },
                        callback: value => formatCompactDashboardNumber(value)
                    }
                }
            }
        },
        plugins: [DASHBOARD_BAR_VALUE_LABEL_PLUGIN]
    });

    // 5. Use Life groups from Item Master (Pie)
    const useLifeLabels = DASHBOARD_USE_LIFE_GROUP_LABELS;
    const useLifeData = useLifeLabels.map(label => stats.useLifeGroups?.[label] || 0);

    new Chart(ctxUseLife, {
        type: 'pie',
        data: {
            labels: useLifeLabels,
            datasets: [{
                data: useLifeData,
                backgroundColor: ['#14b8a6', '#3a7bd5', '#f59e0b', '#ef4444', '#3A2E5B'],
                borderWidth: 0,
                hoverOffset: 12
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'nearest', intersect: false },
            hover: { mode: 'nearest', intersect: false },
            plugins: {
                legend: { position: 'bottom', labels: { usePointStyle: true, font: { family: 'Kanit', size: 11 } } },
                tooltip: {
                    callbacks: {
                        label: context => `${context.label}: ${Number(context.parsed || 0).toLocaleString()} รายการ`
                    },
                    bodyFont: { family: 'Kanit' },
                    titleFont: { family: 'Kanit' }
                },
                dashboardPiePercentLabel: {}
            }
        },
        plugins: [DASHBOARD_PIE_PERCENT_LABEL_PLUGIN]
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

async function fetchAllDashboardItemRows() {
    let allRows = [];
    let from = 0;
    let exactCount = 0;

    while (true) {
        const { data, error, count } = await _supabase
            .from('Item Master')
            .select('*', { count: 'exact' })
            .order('asset_code', { ascending: true })
            .range(from, from + FILTER_FETCH_SIZE - 1);

        if (error) throw error;
        if (typeof count === 'number') exactCount = count;

        allRows = allRows.concat(data || []);
        if (!data || data.length < FILTER_FETCH_SIZE) break;
        from += FILTER_FETCH_SIZE;
    }

    return { data: allRows, count: exactCount || allRows.length };
}

async function fetchDashboardData() {
    try {
        showLoading();
        dashboardData = {};
        dashboardItemRows = [];
        
        // Dashboard zone counts come from Item Master by Location Zone.
        const [itemRes, catRes, transRes] = await Promise.all([
            fetchAllDashboardItemRows(),
            _supabase.from('Category Master').select('id', { count: 'exact', head: true }),
            _supabase.from('Transection Inventory').select('status')
        ]);

        if (itemRes.error) throw itemRes.error;
        if (catRes.error) throw catRes.error;
        if (transRes.error) throw transRes.error;

        const zones = {};
        const prefixZones = {}; // Count Item Master rows by first 2 chars of Location Zone (AA, BB, etc.)
        const categoryStats = {}; // Count Item Master rows by category_id.
        const categoryAcquisStats = {}; // Sum Acquis Value by category_id.
        const useLifeGroups = Object.fromEntries(DASHBOARD_USE_LIFE_GROUP_LABELS.map(label => [label, 0]));
        let totalQty = 0;
        let totalAcquisValue = 0;
        let uniqueDescs = new Set();

        // Process Item Master: 1 row = 1 item/unit in a Location Zone.
        dashboardItemRows = itemRes.data || [];
        dashboardItemRows.forEach(row => {
            const catId = getItemCategoryId(row);
            categoryStats[catId] = (categoryStats[catId] || 0) + 1;

            const acquisValue = getNumericAcquisValue(getItemAcquisValue(row));
            totalAcquisValue += acquisValue;
            categoryAcquisStats[catId] = (categoryAcquisStats[catId] || 0) + acquisValue;

            const useLifeGroup = getUseLifeGroupLabel(getItemUseLife(row));
            if (useLifeGroup) useLifeGroups[useLifeGroup] += 1;
            
            const z = String(row.location_zone || '').trim() || 'Unknown';
            const prefix = getLocationZonePrefix(z);
            const desc = row.description || 'No Description';
            const img = getItemImage(row) || null;

            if (!zones[z]) zones[z] = { totalQty: 0, descriptions: {}, items: [] };
            if (!zones[z].descriptions[desc]) zones[z].descriptions[desc] = { qty: 0, image: img, items: [] };
            
            zones[z].totalQty += 1;
            zones[z].items.push(row);
            zones[z].descriptions[desc].qty += 1;
            zones[z].descriptions[desc].items.push(row);
            if (img && !zones[z].descriptions[desc].image) zones[z].descriptions[desc].image = img;

            prefixZones[prefix] = (prefixZones[prefix] || 0) + 1;
            totalQty += 1;
            uniqueDescs.add(desc);
        });

        // Global Stats
        const statusCounts = {};
        transRes.data.forEach(t => {
            const status = t.status || 'N/A';
            statusCounts[status] = (statusCounts[status] || 0) + 1;
        });

        dashboardStats = {
            totalZones: Object.keys(zones).length,
            totalQty: itemRes.count ?? totalQty,
            totalItems: uniqueDescs.size,
            totalCategories: catRes.count || 0,
            totalAcquisValue: totalAcquisValue,
            statusCounts: statusCounts,
            prefixZones: prefixZones,
            categoryStats: categoryStats,
            categoryAcquisStats: categoryAcquisStats,
            useLifeGroups: useLifeGroups
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
    const zoneInfo = dashboardData[zoneName] || { totalQty: 0, descriptions: {}, items: [] };
    const items = zoneInfo.items || [];
    activePopupZoneName = zoneName;

    document.getElementById('popupZoneName').innerText = zoneName;
    
    const content = document.getElementById('popupContent');
    content.innerHTML = `
        <div class="popup-summary">
            <span class="summary-label">Total Items in Zone</span>
            <div class="summary-value">${zoneInfo.totalQty.toLocaleString()}</div>
        </div>
        
        <div class="search-group" style="margin-bottom: 25px;">
            <input type="text" id="popupSearch" class="search-input" style="width:100%; padding: 0.8rem 1.2rem; border-radius: 15px;" 
                   placeholder="ค้นหา Asset / Inventory / Description..." oninput="filterPopupItems()">
        </div>

        <h4 style="margin-bottom: 20px; color: var(--bu-purple); display: flex; justify-content: space-between; align-items: center;">
            รายการสิ่งของ
            <span style="font-size: 0.8rem; background: #f0f3ff; color: #3a7bd5; padding: 4px 10px; border-radius: 8px;" id="popupMatchCount">
                ${items.length.toLocaleString()} รายการ
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
    const zoneInfo = dashboardData[zoneName] || { totalQty: 0, descriptions: {}, items: [] };
    const items = (zoneInfo.items || [])
        .filter(item => dashboardItemMatchesFilter(item, filter))
        .sort((a, b) => String(a.asset_code || '').localeCompare(String(b.asset_code || ''), undefined, { numeric: true, sensitivity: 'base' }));

    if (items.length === 0) {
        return `<p style="color: var(--text-muted); text-align: center; padding: 20px;">ไม่พบรายการที่ตรงกับเงื่อนไข</p>`;
    }

    return items.map(item => {
        const imageUrl = getItemImage(item);
        const useLife = getItemUseLife(item);
        const assetCode = item.asset_code || '';
        const encodedAssetCode = escapeAttribute(encodeURIComponent(assetCode).replace(/'/g, '%27'));
        const statusText = getActiveStatusLabel(item.active);
        const statusClass = getActiveStatusClass(item.active);
        const clickAttr = assetCode ? ` onclick="openDashboardItemFromPopup('${encodedAssetCode}')"` : '';
        const clickableClass = assetCode ? ' is-clickable' : '';

        return `
            <div class="popup-item-card dashboard-zone-item${clickableClass}"${clickAttr}>
                <div class="dashboard-zone-item-thumb">
                    ${imageUrl ? `<img src="${escapeAttribute(imageUrl)}" alt="${escapeAttribute(item.description || 'Item')}">` : `<span>No image</span>`}
                </div>
                <div class="dashboard-zone-item-body">
                    <div class="dashboard-zone-item-title-row">
                        <span class="dashboard-zone-item-title">${escapeHtml(formatDisplayValue(item.description))}</span>
                        <span class="status-badge ${statusClass}">${statusText}</span>
                    </div>
                    <div class="dashboard-zone-item-code">${escapeHtml(formatDisplayValue(assetCode))}</div>
                    <div class="dashboard-zone-item-grid">
                        ${renderDashboardItemMeta('Inventory', item.inventory_code)}
                        ${renderDashboardItemMeta('Category', item.category_id)}
                        ${renderDashboardItemMeta('Use Life', useLife)}
                    </div>
                </div>
            </div>
        `;
    }).join('');
}

function dashboardItemMatchesFilter(item, filter = '') {
    const query = String(filter || '').trim().toLowerCase();
    if (!query) return true;

    return [
        item.asset_code,
        item.inventory_code,
        item.category_id,
        item.description,
        item.location_zone,
        getItemUseLife(item),
        getActiveStatusLabel(item.active).toLowerCase()
    ].some(value => String(value ?? '').toLowerCase().includes(query));
}

function renderDashboardItemMeta(label, value) {
    return `
        <div class="dashboard-zone-item-meta">
            <span>${escapeHtml(label)}</span>
            <strong>${escapeHtml(formatDisplayValue(value))}</strong>
        </div>
    `;
}

async function openDashboardItemFromPopup(encodedAssetCode) {
    const assetCode = decodeURIComponent(encodedAssetCode || '');
    if (!assetCode) return;

    const cachedItem = dashboardItemRows.find(item => item.asset_code === assetCode);
    if (cachedItem) {
        openItemModal(cachedItem, 'view');
        return;
    }

    showLoading();
    try {
        const { data, error } = await _supabase.from('Item Master').select('*').eq('asset_code', assetCode).single();
        if (error) throw error;
        openItemModal(data, 'view');
    } catch (err) {
        console.error('Error opening item from dashboard:', err);
    } finally {
        hideLoading();
    }
}

function filterPopupItems() {
    const query = document.getElementById('popupSearch').value;
    const listContainer = document.getElementById('popupItemList');
    const matchCount = document.getElementById('popupMatchCount');
    
    if (listContainer) listContainer.innerHTML = renderPopupItemList(activePopupZoneName, query);
    
    // อัปเดตตัวเลขจำนวนที่ค้นเจอ
    const zoneInfo = dashboardData[activePopupZoneName] || { items: [] };
    const count = (zoneInfo.items || []).filter(item => dashboardItemMatchesFilter(item, query)).length;
    if (matchCount) matchCount.innerText = `${count.toLocaleString()} รายการ`;
}

function closeZonePopup() {
    const popup = document.getElementById('sidePopup');
    const overlay = document.getElementById('popupOverlay');
    if (popup) popup.classList.remove('open');
    if (overlay) overlay.classList.remove('show');
    // Also remove highlight from layout
    document.querySelectorAll('.slot').forEach(s => s.classList.remove('active'));
}

// --- Export to Excel Implementation ---
async function exportTransactionsToExcel() {
    showLoading();
    try {
        // Fetch ALL data from Transection Inventory
        let allData = [];
        let from = 0;
        let to = 999;
        let hasMore = true;

        while (hasMore) {
            const { data, error } = await _supabase
                .from('Transection Inventory')
                .select('*')
                .order('id', { ascending: false })
                .range(from, to);

            if (error) throw error;
            if (data.length === 0) {
                hasMore = false;
            } else {
                allData = allData.concat(data);
                from += 1000;
                to += 1000;
                if (data.length < 1000) hasMore = false;
            }
        }

        if (allData.length === 0) {
            showAppAlert('ไม่มีข้อมูลที่จะ Export', 'warning');
            return;
        }

        // Format data for Excel
        const excelData = allData.map(item => ({
            'ID': item.id,
            'Transaction Code': item.code || '',
            'Movement Type': item.movement_type || '',
            'From Zone': item.from_zone || '',
            'To Location': item.to_location || '',
            'Status': item.status || '',
            'Asset Code': item.asset_code || '',
            'Inventory Code': item.inventory_code || '',
            'Description': item.description || '',
            'Category ID': item.id_category || '',
            'Category Name': item.category || '',
            'Quantity': item.quantity || 0,
            'Name Lender': item.name_lender || '',
            'Name Borrower': item.name_borrower || '',
            'Lending Date': item.lending_date ? new Date(item.lending_date).toLocaleString('th-TH') : '',
            'Return Date': item.date_returned ? new Date(item.date_returned).toLocaleString('th-TH') : '',
            'Remark': item.remark || '',
            'Created By': item.create_id || '',
            'Created At': item.created_at || '',
            'Last Edited By': item.edit_id || '',
            'Last Edited At': item.edit_at || ''
        }));

        // Create Workbook
        const worksheet = XLSX.utils.json_to_sheet(excelData);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Transactions');

        // Download file
        const fileName = `Transactions_Export_${new Date().toISOString().slice(0,10)}.xlsx`;
        XLSX.writeFile(workbook, fileName);

    } catch (err) {
        console.error('Export Error:', err);
        showAppAlert('เกิดข้อผิดพลาดในการ Export: ' + err.message, 'error');
    } finally {
        hideLoading();
    }
}

