/**
 * popup.js - 亚马逊产品库弹出窗口与管理看板交互逻辑
 * 核心功能：
 * 1. 响应式拉取 chrome.storage.local 数据并渲染（无插件环境自动优雅降级支持本地演示）
 * 2. 交互式多维度搜索（标题、ASIN、品牌）、站点筛选与按时间/价格排序
 * 3. 卡片网格与明细表格双视图自由无缝切换
 * 4. 一键采集当前标签页亚马逊商品
 * 5. UTF-8 BOM 兼容模式导出高精度 CSV/Excel
 * 6. ASIN 与商品链接一键复制、单条删除与安全二次确认清空
 */

const STORAGE_KEY = "amazon_products";

// 判断是否运行在 Chrome 扩展扩展环境
const isChromeExtension = typeof chrome !== "undefined" && chrome.storage && chrome.storage.local;

// 离线/独立浏览器预览时的示例商品数据
const MOCK_PREVIEW_PRODUCTS = [
  {
    asin: "B08N5WRWNW",
    title: "Apple 2020 MacBook Air Laptop M1 Chip, 13” Retina Display, 8GB RAM, 256GB SSD Storage",
    mainImage: "https://m.media-amazon.com/images/I/71jG+e7roXL._AC_SL1500_.jpg",
    price: "$749.99",
    numericPrice: 749.99,
    currency: "$",
    site: "US",
    hostname: "www.amazon.com",
    url: "https://www.amazon.com/dp/B08N5WRWNW",
    rating: "4.8",
    reviews: "21,450",
    brand: "Apple",
    collectedAt: "2026/9/5 10:15:20",
    createdAt: Date.now() - 3600000 * 2,
    updatedAt: Date.now() - 3600000 * 2
  },
  {
    asin: "B09B8V1LZ3",
    title: "Sony WH-1000XM5 Wireless Industry Leading Noise Canceling Headphones with Auto NC Optimizer",
    mainImage: "https://m.media-amazon.com/images/I/61+El0CuctL._AC_SL1500_.jpg",
    price: "$398.00",
    numericPrice: 398.0,
    currency: "$",
    site: "US",
    hostname: "www.amazon.com",
    url: "https://www.amazon.com/dp/B09B8V1LZ3",
    rating: "4.6",
    reviews: "12,830",
    brand: "Sony",
    collectedAt: "2026/9/5 11:30:00",
    createdAt: Date.now() - 3600000 * 5,
    updatedAt: Date.now() - 3600000 * 5
  },
  {
    asin: "B07FZ8S74R",
    title: "Echo Dot (4th Gen) | Smart speaker with Alexa | Charcoal",
    mainImage: "https://m.media-amazon.com/images/I/714Rq4k05UL._AC_SL1000_.jpg",
    price: "£44.99",
    numericPrice: 44.99,
    currency: "£",
    site: "UK",
    hostname: "www.amazon.co.uk",
    url: "https://www.amazon.co.uk/dp/B07FZ8S74R",
    rating: "4.7",
    reviews: "89,120",
    brand: "Amazon",
    collectedAt: "2026/9/5 12:45:10",
    createdAt: Date.now() - 3600000 * 12,
    updatedAt: Date.now() - 3600000 * 12
  },
  {
    asin: "B09TMN58KL",
    title: "Kindle Paperwhite (16 GB) – Now with a 6.8\" display and adjustable warm light",
    mainImage: "https://m.media-amazon.com/images/I/61WfQ1CgSFL._AC_SL1000_.jpg",
    price: "¥16,980",
    numericPrice: 16980,
    currency: "¥",
    site: "JP",
    hostname: "www.amazon.co.jp",
    url: "https://www.amazon.co.jp/dp/B09TMN58KL",
    rating: "4.5",
    reviews: "6,520",
    brand: "Amazon",
    collectedAt: "2026/9/5 14:02:18",
    createdAt: Date.now() - 3600000 * 20,
    updatedAt: Date.now() - 3600000 * 20
  }
];

// 全局状态管理
let allProducts = [];
let filteredProducts = [];
let currentView = localStorage.getItem("az_view_mode") || "card"; // card | table

// DOM 元素引用
const elements = {
  statTotalCount: document.getElementById("stat-total-count"),
  statFilteredCount: document.getElementById("stat-filtered-count"),
  searchInput: document.getElementById("search-input"),
  searchClearBtn: document.getElementById("search-clear-btn"),
  filterSite: document.getElementById("filter-site"),
  filterSort: document.getElementById("filter-sort"),
  btnCollectCurrent: document.getElementById("btn-collect-current"),
  btnExportCsv: document.getElementById("btn-export-csv"),
  btnOpenDashboard: document.getElementById("btn-open-dashboard"),
  btnClearAll: document.getElementById("btn-clear-all"),
  viewCardBtn: document.getElementById("view-card"),
  viewTableBtn: document.getElementById("view-table"),
  productGrid: document.getElementById("product-grid"),
  productTableWrapper: document.getElementById("product-table-wrapper"),
  productTableBody: document.getElementById("product-table-body"),
  emptyState: document.getElementById("empty-state"),
  modalConfirm: document.getElementById("modal-confirm"),
  modalTitle: document.getElementById("modal-title"),
  modalDesc: document.getElementById("modal-desc"),
  modalCancelBtn: document.getElementById("modal-cancel-btn"),
  modalConfirmBtn: document.getElementById("modal-confirm-btn"),
  popupToast: document.getElementById("popup-toast")
};

// 1. 初始化入口
document.addEventListener("DOMContentLoaded", () => {
  // 检测当前是否处于独立全屏管理页
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get("fullscreen") === "true" || window.innerWidth > 800 || !isChromeExtension) {
    document.body.classList.add("fullscreen");
    if (elements.btnOpenDashboard) {
      elements.btnOpenDashboard.style.display = "none"; // 全屏下隐藏该按钮
    }
  }

  // 绑定各类交互事件
  bindEvents();

  // 恢复保存的视图模式
  setViewMode(currentView);

  // 初次加载数据
  loadProductsFromStorage();

  // 监听 Storage 变动（多标签页或后台采集时实时响应联动）
  if (isChromeExtension && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "local" && changes[STORAGE_KEY]) {
        allProducts = changes[STORAGE_KEY].newValue || [];
        applyFilterAndRender();
      }
    });
  }
});

/**
 * 注册所有 UI 事件
 */
function bindEvents() {
  // 搜索输入与清除
  elements.searchInput.addEventListener("input", () => {
    elements.searchClearBtn.classList.toggle("hidden", !elements.searchInput.value);
    applyFilterAndRender();
  });

  elements.searchClearBtn.addEventListener("click", () => {
    elements.searchInput.value = "";
    elements.searchClearBtn.classList.add("hidden");
    applyFilterAndRender();
    elements.searchInput.focus();
  });

  // 筛选与排序
  elements.filterSite.addEventListener("change", applyFilterAndRender);
  elements.filterSort.addEventListener("change", applyFilterAndRender);

  // 视图切换
  elements.viewCardBtn.addEventListener("click", () => setViewMode("card"));
  elements.viewTableBtn.addEventListener("click", () => setViewMode("table"));

  // 采集当前标签页商品
  elements.btnCollectCurrent.addEventListener("click", handleCollectCurrentTab);

  // 导出 CSV / Excel
  elements.btnExportCsv.addEventListener("click", handleExportCsv);

  // 全屏打开独立管理面板
  if (elements.btnOpenDashboard) {
    elements.btnOpenDashboard.addEventListener("click", () => {
      if (isChromeExtension) {
        const url = chrome.runtime.getURL("dashboard.html?fullscreen=true");
        chrome.tabs.create({ url: url });
      } else {
        window.open("dashboard.html?fullscreen=true", "_blank");
      }
    });
  }

  // 清空全部
  elements.btnClearAll.addEventListener("click", () => {
    if (allProducts.length === 0) {
      showToast("当前产品库已为空", "info");
      return;
    }
    showConfirmModal(
      "清空产品库",
      `确定要删除已保存的全部 ${allProducts.length} 个商品吗？此操作不可逆！`,
      async () => {
        await clearAllProducts();
        showToast("已清空所有商品数据", "success");
      }
    );
  });
}

/**
 * 从本地 storage 加载商品数据（自动适配 Chrome 扩展与浏览器独立预览）
 */
async function loadProductsFromStorage() {
  if (isChromeExtension) {
    chrome.storage.local.get([STORAGE_KEY], (res) => {
      allProducts = res[STORAGE_KEY] || [];
      applyFilterAndRender();
    });
  } else {
    // GitHub Pages 或纯静态网页环境：优先从云端 products.json 获取实时商品列表
    try {
      const timestamp = Date.now();
      const res = await fetch("./products.json?t=" + timestamp);
      if (res.ok) {
        const cloudData = await res.json();
        if (Array.isArray(cloudData) && cloudData.length > 0) {
          allProducts = cloudData;
          localStorage.setItem(STORAGE_KEY, JSON.stringify(allProducts));
          applyFilterAndRender();
          return;
        }
      }
    } catch (err) {
      console.warn("读取云端 products.json 失败，尝试降级到本地缓存", err);
    }

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        allProducts = JSON.parse(stored);
      } else {
        allProducts = [...MOCK_PREVIEW_PRODUCTS];
      }
    } catch (e) {
      allProducts = [...MOCK_PREVIEW_PRODUCTS];
    }
    applyFilterAndRender();
  }
}

/**
 * 切换网格/表格视图模式
 */
function setViewMode(mode) {
  currentView = mode;
  localStorage.setItem("az_view_mode", mode);

  if (mode === "card") {
    elements.viewCardBtn.classList.add("active");
    elements.viewTableBtn.classList.remove("active");
    elements.productGrid.classList.remove("hidden");
    elements.productTableWrapper.classList.add("hidden");
  } else {
    elements.viewCardBtn.classList.remove("active");
    elements.viewTableBtn.classList.add("active");
    elements.productGrid.classList.add("hidden");
    elements.productTableWrapper.classList.remove("hidden");
  }

  applyFilterAndRender();
}

/**
 * 执行搜索、筛选、排序并重新渲染
 */
function applyFilterAndRender() {
  const query = elements.searchInput.value.trim().toLowerCase();
  const selectedSite = elements.filterSite.value;
  const sortType = elements.filterSort.value;

  // 1. 过滤
  filteredProducts = allProducts.filter((item) => {
    // 站点过滤
    if (selectedSite !== "ALL" && item.site !== selectedSite) {
      return false;
    }

    // 关键词过滤 (标题 / ASIN / 品牌)
    if (query) {
      const titleMatch = (item.title || "").toLowerCase().includes(query);
      const asinMatch = (item.asin || "").toLowerCase().includes(query);
      const brandMatch = (item.brand || "").toLowerCase().includes(query);
      return titleMatch || asinMatch || brandMatch;
    }

    return true;
  });

  // 2. 排序
  filteredProducts.sort((a, b) => {
    if (sortType === "time-desc") {
      return (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0);
    }
    if (sortType === "time-asc") {
      return (a.updatedAt || a.createdAt || 0) - (b.updatedAt || b.createdAt || 0);
    }
    if (sortType === "price-desc") {
      const priceA = typeof a.numericPrice === "number" ? a.numericPrice : -1;
      const priceB = typeof b.numericPrice === "number" ? b.numericPrice : -1;
      return priceB - priceA;
    }
    if (sortType === "price-asc") {
      const priceA = typeof a.numericPrice === "number" ? a.numericPrice : 9999999;
      const priceB = typeof b.numericPrice === "number" ? b.numericPrice : 9999999;
      return priceA - priceB;
    }
    return 0;
  });

  // 3. 更新统计数字
  elements.statTotalCount.textContent = allProducts.length;
  elements.statFilteredCount.textContent = filteredProducts.length;

  // 4. 空状态处理
  if (filteredProducts.length === 0) {
    elements.emptyState.classList.remove("hidden");
    elements.productGrid.innerHTML = "";
    elements.productTableBody.innerHTML = "";
    return;
  }
  elements.emptyState.classList.add("hidden");

  // 5. 渲染对应视图
  if (currentView === "card") {
    renderCardView(filteredProducts);
  } else {
    renderTableView(filteredProducts);
  }
}

/**
 * 渲染精美卡片网格
 */
function renderCardView(products) {
  elements.productGrid.innerHTML = "";

  const fragment = document.createDocumentFragment();

  products.forEach((p) => {
    const card = document.createElement("div");
    card.className = "product-card";
    card.dataset.asin = p.asin;

    const displayDate = p.collectedAt || (p.createdAt ? new Date(p.createdAt).toLocaleDateString() : "--");
    const thumbUrl = p.mainImage || "icons/icon48.png";
    const ratingHtml = p.rating ? `<span class="rating-info">★ ${escapeHtml(p.rating)} (${escapeHtml(p.reviews || 0)})</span>` : "";

    card.innerHTML = `
      <div class="card-top">
        <div class="img-container">
          <img src="${escapeHtml(thumbUrl)}" alt="${escapeHtml(p.asin)}" class="product-thumb" loading="lazy" onerror="this.src='icons/icon48.png'" />
        </div>
        <div class="card-body">
          <div>
            <div class="card-badges">
              <span class="badge-site">${escapeHtml(p.site || "US")}</span>
              <span class="badge-asin" title="点击一键复制 ASIN">${escapeHtml(p.asin)}</span>
            </div>
            <a href="${escapeHtml(p.url || "#")}" target="_blank" class="product-title" title="${escapeHtml(p.title)}">
              ${escapeHtml(p.title || "未命名商品")}
            </a>
          </div>
          <div class="price-row">
            <span class="price-tag">${escapeHtml(p.price || "暂无报价")}</span>
            ${ratingHtml}
          </div>
        </div>
      </div>
      <div class="card-meta">
        <span>录入: ${escapeHtml(displayDate)}</span>
        <div class="card-actions">
          <button class="card-action-btn btn-copy-link" title="复制商品原链接">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            <span>链接</span>
          </button>
          <a href="${escapeHtml(p.url || "#")}" target="_blank" class="card-action-btn" title="直达商品页面">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
            <span>直达</span>
          </a>
          <button class="card-action-btn btn-del" title="删除该条商品">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      </div>
    `;

    // 复制 ASIN
    const asinBadge = card.querySelector(".badge-asin");
    asinBadge.addEventListener("click", () => {
      copyToClipboard(p.asin, `已复制 ASIN: ${p.asin}`);
    });

    // 复制链接
    const copyLinkBtn = card.querySelector(".btn-copy-link");
    copyLinkBtn.addEventListener("click", () => {
      copyToClipboard(p.url, "已复制商品链接！");
    });

    // 删除单项
    const delBtn = card.querySelector(".btn-del");
    delBtn.addEventListener("click", () => {
      deleteSingleProduct(p.asin);
    });

    fragment.appendChild(card);
  });

  elements.productGrid.appendChild(fragment);
}

/**
 * 渲染列表表格
 */
function renderTableView(products) {
  elements.productTableBody.innerHTML = "";
  const fragment = document.createDocumentFragment();

  products.forEach((p) => {
    const tr = document.createElement("tr");
    tr.dataset.asin = p.asin;

    const displayDate = p.collectedAt || (p.createdAt ? new Date(p.createdAt).toLocaleDateString() : "--");
    const thumbUrl = p.mainImage || "icons/icon48.png";

    tr.innerHTML = `
      <td>
        <img src="${escapeHtml(thumbUrl)}" alt="${escapeHtml(p.asin)}" class="table-img" loading="lazy" onerror="this.src='icons/icon48.png'" />
      </td>
      <td>
        <span class="badge-asin" title="点击复制 ASIN" style="cursor: pointer;">${escapeHtml(p.asin)}</span>
      </td>
      <td>
        <a href="${escapeHtml(p.url || "#")}" target="_blank" class="table-title-link" title="${escapeHtml(p.title)}">
          ${escapeHtml(p.title || "未命名商品")}
        </a>
      </td>
      <td><span class="badge-site">${escapeHtml(p.site || "US")}</span></td>
      <td class="table-price">${escapeHtml(p.price || "暂无")}</td>
      <td style="color: var(--text-dim); font-size: 11px;">${escapeHtml(displayDate)}</td>
      <td style="text-align: center;">
        <div style="display: flex; gap: 4px; justify-content: center;">
          <a href="${escapeHtml(p.url || "#")}" target="_blank" class="card-action-btn" title="直达">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
              <polyline points="15 3 21 3 21 9"></polyline>
              <line x1="10" y1="14" x2="21" y2="3"></line>
            </svg>
          </a>
          <button class="card-action-btn btn-del" title="删除">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      </td>
    `;

    const asinBadge = tr.querySelector(".badge-asin");
    asinBadge.addEventListener("click", () => {
      copyToClipboard(p.asin, `已复制 ASIN: ${p.asin}`);
    });

    const delBtn = tr.querySelector(".btn-del");
    delBtn.addEventListener("click", () => {
      deleteSingleProduct(p.asin);
    });

    fragment.appendChild(tr);
  });

  elements.productTableBody.appendChild(fragment);
}

/**
 * 采集当前活动标签页
 */
async function handleCollectCurrentTab() {
  if (!isChromeExtension) {
    showToast("当前处于独立离线演示环境；请在 Chrome 扩展中连接亚马逊实时采集", "info");
    return;
  }

  const btn = elements.btnCollectCurrent;
  btn.style.opacity = "0.7";
  btn.style.pointerEvents = "none";

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.url) {
      showToast("未检测到有效标签页", "error");
      return;
    }

    if (!tab.url.includes("amazon.")) {
      showToast("请在亚马逊商品页面执行采集！", "error");
      return;
    }

    // 向 content.js 发起采集
    chrome.tabs.sendMessage(tab.id, { action: "DO_COLLECT" }, async (response) => {
      if (chrome.runtime.lastError || !response) {
        // 动态兜底注入
        try {
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["content.js"]
          });
          setTimeout(() => {
            chrome.tabs.sendMessage(tab.id, { action: "DO_COLLECT" }, (res) => {
              if (res && res.success) {
                showToast(res.isUpdate ? "商品信息已更新！" : "🎉 采集成功已入库！", "success");
                loadProductsFromStorage();
              } else {
                showToast((res && res.message) || "采集失败，请确认页面是否为商品详情页", "error");
              }
            });
          }, 200);
        } catch (e) {
          showToast("无法在当前页面注入脚本", "error");
        }
      } else {
        if (response.success) {
          showToast(response.isUpdate ? "商品信息已更新！" : "🎉 采集成功已入库！", "success");
          loadProductsFromStorage();
        } else {
          showToast(response.message || "采集失败", "error");
        }
      }
    });
  } catch (err) {
    showToast("操作失败: " + err.message, "error");
  } finally {
    setTimeout(() => {
      btn.style.opacity = "1";
      btn.style.pointerEvents = "auto";
    }, 400);
  }
}

/**
 * 导出为 Excel 兼容的标准 CSV
 */
function handleExportCsv() {
  const listToExport = filteredProducts.length > 0 ? filteredProducts : allProducts;
  if (listToExport.length === 0) {
    showToast("当前没有可导出的商品数据", "info");
    return;
  }

  // 表头定义
  const headers = [
    "ASIN",
    "商品标题",
    "站点",
    "币种",
    "抓取售价",
    "数值价格",
    "评分",
    "评价数",
    "品牌/店铺",
    "商品直达链接",
    "主图链接",
    "采集时间"
  ];

  // 辅助转义 CSV 特殊字符 (逗号、换行、双引号)
  const formatCell = (val) => {
    if (val === null || val === undefined) return '""';
    const str = String(val).replace(/"/g, '""');
    return `"${str}"`;
  };

  const rows = listToExport.map((item) => [
    formatCell(item.asin),
    formatCell(item.title),
    formatCell(item.site),
    formatCell(item.currency),
    formatCell(item.price),
    formatCell(item.numericPrice !== null ? item.numericPrice : ""),
    formatCell(item.rating),
    formatCell(item.reviews),
    formatCell(item.brand),
    formatCell(item.url),
    formatCell(item.mainImage),
    formatCell(item.collectedAt || "")
  ]);

  // UTF-8 BOM 标识 (\uFEFF) 防止 Excel 打开时中文乱码
  const csvContent = "\uFEFF" + [headers.map(h => `"${h}"`).join(","), ...rows.map(r => r.join(","))].join("\r\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
  const timeStr = String(now.getHours()).padStart(2, "0") + String(now.getMinutes()).padStart(2, "0");

  link.setAttribute("href", url);
  link.setAttribute("download", `Amazon_Products_${dateStr}_${timeStr}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  showToast(`成功导出 ${listToExport.length} 条商品数据为 CSV！`, "success");
}

/**
 * 删除单个商品
 */
function deleteSingleProduct(asin) {
  allProducts = allProducts.filter((item) => item.asin !== asin);
  if (isChromeExtension) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(allProducts)); (function() {
      showToast("商品已删除", "info");
      applyFilterAndRender();
      
    });
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(allProducts));
    showToast("商品已删除", "info");
    applyFilterAndRender();
  }
}

/**
 * 清空所有商品
 */
async function clearAllProducts() {
  allProducts = [];
  if (isChromeExtension) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEY]: [] }, () => {
        applyFilterAndRender();
        
        resolve();
      });
    });
  } else {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([]));
    applyFilterAndRender();
  }
}

/**
 * 弹出二次确认对话框
 */
function showConfirmModal(title, desc, onConfirm) {
  elements.modalTitle.textContent = title;
  elements.modalDesc.textContent = desc;
  elements.modalConfirm.classList.remove("hidden");

  const close = () => {
    elements.modalConfirm.classList.add("hidden");
    elements.modalCancelBtn.removeEventListener("click", onCancel);
    elements.modalConfirmBtn.removeEventListener("click", doConfirm);
  };

  const onCancel = () => close();
  const doConfirm = () => {
    close();
    if (typeof onConfirm === "function") onConfirm();
  };

  elements.modalCancelBtn.addEventListener("click", onCancel);
  elements.modalConfirmBtn.addEventListener("click", doConfirm);
}

/**
 * 现代轻量 Toast 提示
 */
let toastTimer = null;
function showToast(message, type = "info") {
  const el = elements.popupToast;
  el.textContent = message;
  el.classList.remove("hidden");

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.add("hidden");
  }, 2200);
}

/**
 * 复制文本到剪贴板
 */
function copyToClipboard(text, successMsg) {
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    showToast(successMsg || "复制成功！", "success");
  }).catch(() => {
    showToast("复制失败，请手动选择复制", "error");
  });
}

/**
 * HTML 转义防御 XSS
 */
function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
